/* Repositório: regras de negócio sobre o IndexedDB + caches do estado. */

import * as db from './db.js';
import { state, bus, DEFAULT_SETTINGS } from './state.js';
import { uid, dayKey } from './utils.js';
import { invalidateCover, invalidateAllCovers } from './covers.js';

export class StorageError extends Error {}

const isQuotaError = (e) =>
  !!e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota|space|disk/i.test(e.message || ''));

const quotaError = () =>
  new StorageError(
    'Espaço de armazenamento insuficiente. Libere espaço no dispositivo ou remova audiolivros em Configurações › Armazenamento.',
  );

/* Alguns motores antigos (Safari < 14, modo privado) não guardam Blob no IndexedDB.
 * Nesses casos guardamos ArrayBuffer e recriamos o Blob na leitura. */
let blobSupported = null;

/* ------------------------------------------------------------------ */
/* Carga inicial                                                       */
/* ------------------------------------------------------------------ */

export async function loadAll() {
  const [books, progress, history, playlists, settingsRec, sessionRec] = await Promise.all([
    db.getAll('books'),
    db.getAll('progress'),
    db.getAll('history'),
    db.getAll('playlists'),
    db.get('settings', 'app'),
    db.get('settings', 'session'),
  ]);
  state.books = new Map(books.map((b) => [b.id, b]));
  state.progress = new Map(progress.map((p) => [p.bookId, p]));
  state.history = new Map(history.map((h) => [h.bookId, h]));
  state.playlists = new Map(playlists.map((p) => [p.id, p]));
  state.settings = { ...DEFAULT_SETTINGS, ...(settingsRec?.value || {}) };
  state.session = sessionRec?.value || {};
  state.chapters.clear();
  statsCache = null;
}

/* ------------------------------------------------------------------ */
/* Configurações                                                        */
/* ------------------------------------------------------------------ */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.put('settings', { key: 'app', value: state.settings });
  bus.emit('settings', state.settings);
}

export async function resetSettings() {
  state.settings = { ...DEFAULT_SETTINGS, name: state.settings.name };
  await db.put('settings', { key: 'app', value: state.settings });
  bus.emit('settings', state.settings);
}

export async function setSession(patch) {
  state.session = { ...state.session, ...patch };
  await db.put('settings', { key: 'session', value: state.session });
}

/* ------------------------------------------------------------------ */
/* Livros                                                               */
/* ------------------------------------------------------------------ */

export const getBook = (id) => state.books.get(id);
export const allBooks = () => [...state.books.values()];

export async function updateBook(id, patch, { silent = false } = {}) {
  const book = state.books.get(id);
  if (!book) return null;
  const next = { ...book, ...patch, updatedAt: Date.now() };
  state.books.set(id, next);
  await db.put('books', next);
  if (!silent) bus.emit('library', { type: 'update', id });
  return next;
}

export function toggleFavorite(id) {
  const b = getBook(id);
  if (!b) return null;
  return updateBook(id, { favorite: !b.favorite, favoritedAt: b.favorite ? null : Date.now() });
}

export function setFinished(id, finished) {
  return updateBook(id, { finished, finishedAt: finished ? Date.now() : null });
}

export const genres = () =>
  [...new Set(allBooks().map((b) => (b.genre || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );

/* ------------------------------------------------------------------ */
/* Capítulos e áudio                                                    */
/* ------------------------------------------------------------------ */

export async function getChapters(bookId) {
  if (state.chapters.has(bookId)) return state.chapters.get(bookId);
  const book = getBook(bookId);
  const list = await db.getAllByIndex('chapters', 'bookId', bookId);
  const byId = new Map(list.map((c) => [c.id, c]));
  const ordered = [];
  for (const id of book?.chapterIds || []) {
    const c = byId.get(id);
    if (c) {
      ordered.push(c);
      byId.delete(id);
    }
  }
  ordered.push(...byId.values());
  state.chapters.set(bookId, ordered);
  return ordered;
}

/** Atualiza a duração real de um capítulo descoberta durante a reprodução. */
export async function updateChapterDuration(bookId, chapterId, duration) {
  const chapters = await getChapters(bookId);
  const c = chapters.find((x) => x.id === chapterId);
  if (!c || !(duration > 0) || Math.abs((c.duration || 0) - duration) < 0.5) return;
  c.duration = duration;
  await db.put('chapters', c);
  const total = chapters.reduce((s, x) => s + (x.duration || 0), 0);
  await updateBook(bookId, { totalDuration: total }, { silent: true });
}

export async function getAudioBlob(audioId) {
  if (!audioId) return null;
  const rec = await db.get('audio', audioId);
  if (!rec) return null;
  if (rec.blob instanceof Blob) return rec.blob;
  if (rec.buffer) return new Blob([rec.buffer], { type: rec.type || 'audio/mpeg' });
  return null;
}

async function storeAudio(rec, blob) {
  if (blobSupported !== false) {
    try {
      await db.put('audio', { ...rec, blob });
      blobSupported = true;
      return;
    } catch (err) {
      if (isQuotaError(err)) throw quotaError();
      console.warn('[repo] Blob não suportado no IndexedDB; usando ArrayBuffer', err);
      blobSupported = false;
    }
  }
  try {
    const buffer = await blob.arrayBuffer();
    await db.put('audio', { ...rec, buffer });
  } catch (err) {
    if (isQuotaError(err)) throw quotaError();
    throw err;
  }
}

async function coverRecord(bookId, cover) {
  const base = { id: bookId, size: cover.blob.size, type: cover.blob.type, generated: !!cover.generated };
  if (blobSupported === false) return { ...base, buffer: await cover.blob.arrayBuffer() };
  return { ...base, blob: cover.blob };
}

/** Verifica se todos os arquivos de áudio do livro estão realmente guardados no dispositivo. */
export async function verifyBookAudio(bookId) {
  const chapters = await getChapters(bookId);
  const ids = [...new Set(chapters.map((c) => c.audioId))];
  const missing = new Set();
  await Promise.all(
    ids.map(async (id) => {
      if (!id || !(await db.has('audio', id))) missing.add(id);
    }),
  );
  return {
    ok: missing.size === 0 && chapters.length > 0,
    missingChapterIds: chapters.filter((c) => missing.has(c.audioId)).map((c) => c.id),
  };
}

/**
 * Cria ou atualiza um livro a partir de um rascunho da tela de importação.
 * draft = {
 *   bookId?, meta: { title, author, narrator, genre, year, synopsis },
 *   cover?: { blob, color, generated }   (undefined = manter a atual)
 *   chapters: [{ id?, title, audioId? | fileKey?, start, duration, fileName, fileSize, type }],
 *   files: Map(fileKey -> { blob, name, size, type })
 * }
 */
export async function saveBookFromDraft(draft, onProgress = () => {}) {
  const isEdit = !!draft.bookId && state.books.has(draft.bookId);
  const bookId = draft.bookId || uid('b_');
  const prevBook = isEdit ? getBook(bookId) : null;
  const prevChapters = isEdit ? await getChapters(bookId) : [];

  const usedKeys = [...new Set(draft.chapters.filter((c) => c.fileKey).map((c) => c.fileKey))];
  const totalBytes = usedKeys.reduce((s, k) => s + (draft.files.get(k)?.size || 0), 0);
  const keyToAudio = new Map();
  const created = [];
  let bytes = 0;

  try {
    // 1) Grava cada arquivo de áudio novo (uma transação por arquivo).
    for (let i = 0; i < usedKeys.length; i++) {
      const f = draft.files.get(usedKeys[i]);
      onProgress({ phase: 'audio', index: i, total: usedKeys.length, name: f.name, bytes, totalBytes });
      const audioId = uid('a_');
      await storeAudio(
        { id: audioId, bookId, name: f.name, size: f.size, type: f.type, addedAt: Date.now() },
        f.blob,
      );
      created.push(audioId);
      keyToAudio.set(usedKeys[i], audioId);
      bytes += f.size;
    }
    onProgress({ phase: 'audio', index: usedKeys.length, total: usedKeys.length, bytes, totalBytes });

    // 2) Capítulos
    const chapters = draft.chapters.map((c, i) => ({
      id: c.id || uid('c_'),
      bookId,
      title: (c.title || '').trim() || `Capítulo ${i + 1}`,
      audioId: c.fileKey ? keyToAudio.get(c.fileKey) : c.audioId,
      start: c.start || 0,
      duration: c.duration || 0,
      fileName: c.fileName || '',
      fileSize: c.fileSize || 0,
      type: c.type || '',
    }));

    const ops = [];
    const keep = new Set(chapters.map((c) => c.id));
    for (const old of prevChapters) if (!keep.has(old.id)) ops.push({ store: 'chapters', type: 'delete', key: old.id });
    const usedAudio = new Set(chapters.map((c) => c.audioId));
    if (isEdit) {
      const oldAudio = await db.getKeysByIndex('audio', 'bookId', bookId);
      for (const k of oldAudio) if (!usedAudio.has(k)) ops.push({ store: 'audio', type: 'delete', key: k });
    }
    for (const c of chapters) ops.push({ store: 'chapters', type: 'put', value: c });

    // 3) Capa
    let coverSize = prevBook?.coverSize || 0;
    let coverColor = prevBook?.coverColor || null;
    let coverGenerated = prevBook?.coverGenerated ?? true;
    if (draft.cover) {
      ops.push({ store: 'covers', type: 'put', value: await coverRecord(bookId, draft.cover) });
      coverSize = draft.cover.blob.size;
      coverColor = draft.cover.color || null;
      coverGenerated = !!draft.cover.generated;
    }

    // 4) Livro
    const sizes = new Map();
    for (const c of chapters) if (!sizes.has(c.audioId)) sizes.set(c.audioId, c.fileSize || 0);
    const now = Date.now();
    const m = draft.meta || {};
    const book = {
      favorite: false,
      finished: false,
      notes: '',
      ...prevBook,
      title: (m.title || '').trim() || 'Sem título',
      author: (m.author || '').trim(),
      narrator: (m.narrator || '').trim(),
      genre: (m.genre || '').trim(),
      year: (m.year || '').toString().trim(),
      synopsis: (m.synopsis || '').trim(),
      id: bookId,
      chapterIds: chapters.map((c) => c.id),
      chapterCount: chapters.length,
      totalDuration: chapters.reduce((s, c) => s + (c.duration || 0), 0),
      audioSize: [...sizes.values()].reduce((s, n) => s + n, 0),
      coverSize,
      coverColor,
      coverGenerated,
      addedAt: prevBook?.addedAt || now,
      updatedAt: now,
    };
    ops.push({ store: 'books', type: 'put', value: book });

    onProgress({ phase: 'finalize' });
    try {
      await db.batch(ops);
    } catch (err) {
      if (isQuotaError(err)) throw quotaError();
      if (draft.cover && blobSupported !== false) {
        // Capa como Blob falhou neste motor: tenta com ArrayBuffer.
        blobSupported = false;
        const i = ops.findIndex((o) => o.store === 'covers');
        if (i >= 0) ops[i] = { store: 'covers', type: 'put', value: await coverRecord(bookId, draft.cover) };
        await db.batch(ops);
      } else throw err;
    }

    // 5) Verificação: o áudio está mesmo no dispositivo?
    onProgress({ phase: 'verify' });
    const missing = [];
    for (const id of usedAudio) if (!(await db.has('audio', id))) missing.push(id);
    if (missing.length) {
      throw new StorageError(
        `${missing.length} arquivo(s) de áudio não foram armazenados no dispositivo e não estarão disponíveis offline.`,
      );
    }

    state.books.set(bookId, book);
    state.chapters.set(bookId, chapters);
    if (draft.cover) invalidateCover(bookId);

    // 6) Ajusta o progresso salvo se a estrutura de capítulos mudou.
    const p = state.progress.get(bookId);
    if (p) {
      let idx = chapters.findIndex((c) => c.id === p.chapterId);
      let position = p.position;
      if (idx < 0) {
        idx = 0;
        position = 0;
      }
      const bookPosition = chapters.slice(0, idx).reduce((s, c) => s + (c.duration || 0), 0) + position;
      await saveProgress({ ...p, chapterId: chapters[idx]?.id, chapterIndex: idx, position, bookPosition });
    }

    bus.emit('library', { type: isEdit ? 'update' : 'add', id: bookId });
    bus.emit('book:structure', bookId);
    return book;
  } catch (err) {
    if (created.length) {
      await db.batch(created.map((id) => ({ store: 'audio', type: 'delete', key: id }))).catch(() => {});
    }
    if (isQuotaError(err)) throw quotaError();
    throw err;
  }
}

export async function deleteBook(id) {
  if (!getBook(id)) return;
  bus.emit('book:deleting', id);
  const [chapterKeys, audioKeys, bookmarkKeys] = await Promise.all([
    db.getKeysByIndex('chapters', 'bookId', id),
    db.getKeysByIndex('audio', 'bookId', id),
    db.getKeysByIndex('bookmarks', 'bookId', id),
  ]);
  const ops = [
    ...chapterKeys.map((key) => ({ store: 'chapters', type: 'delete', key })),
    ...audioKeys.map((key) => ({ store: 'audio', type: 'delete', key })),
    ...bookmarkKeys.map((key) => ({ store: 'bookmarks', type: 'delete', key })),
    { store: 'covers', type: 'delete', key: id },
    { store: 'progress', type: 'delete', key: id },
    { store: 'history', type: 'delete', key: id },
    { store: 'books', type: 'delete', key: id },
  ];
  const touched = [];
  for (const pl of state.playlists.values()) {
    if (pl.bookIds.includes(id)) {
      const next = { ...pl, bookIds: pl.bookIds.filter((b) => b !== id), updatedAt: Date.now() };
      ops.push({ store: 'playlists', type: 'put', value: next });
      touched.push(next);
    }
  }
  await db.batch(ops);
  touched.forEach((p) => state.playlists.set(p.id, p));
  state.books.delete(id);
  state.chapters.delete(id);
  state.progress.delete(id);
  state.history.delete(id);
  if (state.session.lastBookId === id) await setSession({ lastBookId: null });
  invalidateCover(id);
  bus.emit('library', { type: 'delete', id });
}

/* ------------------------------------------------------------------ */
/* Progresso e histórico                                                */
/* ------------------------------------------------------------------ */

export const getProgress = (bookId) => state.progress.get(bookId) || null;

export async function saveProgress(p) {
  const rec = { ...p, updatedAt: Date.now() };
  state.progress.set(rec.bookId, rec);
  await db.put('progress', rec);
  bus.emit('progress', rec.bookId);
  return rec;
}

export async function resetProgress(bookId) {
  const p = getProgress(bookId);
  if (!p) return;
  await saveProgress({ ...p, chapterIndex: 0, chapterId: null, position: 0, bookPosition: 0, completed: [] });
}

export async function touchHistory(bookId, data, { countPlay = false, silent = false } = {}) {
  const prev = state.history.get(bookId) || {};
  const rec = {
    ...prev,
    ...data,
    bookId,
    plays: (prev.plays || 0) + (countPlay ? 1 : 0),
    firstPlayedAt: prev.firstPlayedAt || Date.now(),
    lastPlayedAt: Date.now(),
  };
  state.history.set(bookId, rec);
  await db.put('history', rec);
  if (!silent) bus.emit('history', bookId);
}

export async function clearHistory() {
  await db.clear('history');
  state.history.clear();
  bus.emit('history');
  bus.emit('library', { type: 'history' });
}

/* ------------------------------------------------------------------ */
/* Marcadores                                                           */
/* ------------------------------------------------------------------ */

export async function getBookmarks(bookId) {
  const list = await db.getAllByIndex('bookmarks', 'bookId', bookId);
  const chapters = await getChapters(bookId);
  const order = new Map(chapters.map((c, i) => [c.id, i]));
  return list
    .map((b) => ({ ...b, chapterIndex: order.has(b.chapterId) ? order.get(b.chapterId) : b.chapterIndex }))
    .sort((a, b) => a.chapterIndex - b.chapterIndex || a.position - b.position);
}

export async function addBookmark({ bookId, chapterId, chapterIndex, chapterTitle, position, note = '' }) {
  const rec = { id: uid('m_'), bookId, chapterId, chapterIndex, chapterTitle, position, note, createdAt: Date.now() };
  await db.put('bookmarks', rec);
  bus.emit('bookmarks', bookId);
  return rec;
}

export async function updateBookmark(rec) {
  await db.put('bookmarks', rec);
  bus.emit('bookmarks', rec.bookId);
}

export async function deleteBookmark(rec) {
  await db.del('bookmarks', rec.id);
  bus.emit('bookmarks', rec.bookId);
}

/* ------------------------------------------------------------------ */
/* Playlists                                                            */
/* ------------------------------------------------------------------ */

export const allPlaylists = () =>
  [...state.playlists.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

export async function savePlaylist(pl) {
  const rec = { bookIds: [], description: '', createdAt: Date.now(), ...pl, updatedAt: Date.now() };
  state.playlists.set(rec.id, rec);
  await db.put('playlists', rec);
  bus.emit('playlists', rec.id);
  return rec;
}

export const createPlaylist = (name, bookIds = []) =>
  savePlaylist({ id: uid('p_'), name: name.trim() || 'Nova playlist', bookIds });

export async function deletePlaylist(id) {
  await db.del('playlists', id);
  state.playlists.delete(id);
  bus.emit('playlists', id);
}

export async function togglePlaylistBook(playlistId, bookId) {
  const pl = state.playlists.get(playlistId);
  if (!pl) return;
  const has = pl.bookIds.includes(bookId);
  return savePlaylist({ ...pl, bookIds: has ? pl.bookIds.filter((b) => b !== bookId) : [...pl.bookIds, bookId] });
}

/* ------------------------------------------------------------------ */
/* Estatísticas                                                         */
/* ------------------------------------------------------------------ */

let statsCache = null;

export async function getStats() {
  if (!statsCache) {
    const rows = await db.getAll('stats');
    statsCache = new Map(rows.map((r) => [r.date, r]));
  }
  return statsCache;
}

export async function addListening(bookId, seconds) {
  if (!(seconds > 0)) return;
  const stats = await getStats();
  const key = dayKey();
  const rec = stats.get(key) || { date: key, seconds: 0, books: {} };
  rec.seconds += seconds;
  rec.books[bookId] = (rec.books[bookId] || 0) + seconds;
  stats.set(key, rec);
  await db.put('stats', rec);
}

/* ------------------------------------------------------------------ */
/* Armazenamento                                                        */
/* ------------------------------------------------------------------ */

export function libraryUsage() {
  let audio = 0, covers = 0, chapters = 0;
  for (const b of state.books.values()) {
    audio += b.audioSize || 0;
    covers += b.coverSize || 0;
    chapters += b.chapterCount || 0;
  }
  return { audio, covers, chapters, books: state.books.size };
}

/* ------------------------------------------------------------------ */
/* Exportação / importação de dados                                     */
/* ------------------------------------------------------------------ */

export async function exportData() {
  const [books, chapters, progress, bookmarks, history, playlists, stats] = await Promise.all(
    ['books', 'chapters', 'progress', 'bookmarks', 'history', 'playlists', 'stats'].map((s) => db.getAll(s)),
  );
  return {
    app: 'AUDIOBOOK',
    format: 'audiobook-data',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    books,
    chapters,
    progress,
    bookmarks,
    history,
    playlists,
    stats,
  };
}

/**
 * Mescla dados exportados com a biblioteca atual (registros com o mesmo id são substituídos).
 * covers: Map(bookId -> Blob) opcional.
 */
export async function importData(data, { covers = new Map(), includeSettings = true } = {}) {
  if (!data || data.app !== 'AUDIOBOOK') throw new Error('Arquivo não reconhecido como backup do AUDIOBOOK.');
  const ops = [];
  const putAll = (store, rows) => (rows || []).forEach((value) => ops.push({ store, type: 'put', value }));
  putAll('books', data.books);
  putAll('chapters', data.chapters);
  putAll('progress', data.progress);
  putAll('bookmarks', data.bookmarks);
  putAll('history', data.history);
  putAll('playlists', data.playlists);
  putAll('stats', data.stats);
  if (includeSettings && data.settings) {
    ops.push({ store: 'settings', type: 'put', value: { key: 'app', value: { ...DEFAULT_SETTINGS, ...data.settings } } });
  }
  for (const [bookId, blob] of covers) {
    ops.push({ store: 'covers', type: 'put', value: await coverRecord(bookId, { blob, generated: false }) });
  }
  await db.batch(ops);
  invalidateAllCovers();
  await loadAll();
  bus.emit('settings', state.settings);
  bus.emit('library', { type: 'import' });
  let missing = 0;
  for (const b of data.books || []) {
    const v = await verifyBookAudio(b.id);
    if (!v.ok) missing++;
  }
  return { books: (data.books || []).length, missing };
}

export { storeAudio as storeAudioRecord };

export async function deleteAllData() {
  bus.emit('book:deleting', '*');
  await db.batch(db.ALL_STORES.map((store) => ({ store, type: 'clear' })));
  invalidateAllCovers();
  await loadAll();
  bus.emit('settings', state.settings);
  bus.emit('library', { type: 'reset' });
}
