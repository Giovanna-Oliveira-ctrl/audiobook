/* Exportação/importação de dados.
 *  - JSON: metadados, progresso, marcadores, notas, histórico, playlists, estatísticas e capas (sem áudio).
 *  - Backup completo (.audiobook): tudo acima + arquivos de áudio. O arquivo é montado com
 *    Blobs encadeados (sem carregar todo o áudio na memória) e pode ser restaurado offline. */

import * as db from './db.js';
import * as repo from './repo.js';
import { downloadBlob, dayKey } from './utils.js';

const MAGIC = 'AUDIOBOOK-BACKUP-1\n';
const LEN_DIGITS = 12;

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

const dataURLToBlob = async (url) => (await fetch(url)).blob();

const recordBlob = (rec, fallbackType) =>
  rec?.blob instanceof Blob ? rec.blob : rec?.buffer ? new Blob([rec.buffer], { type: rec.type || fallbackType }) : null;

export async function exportJSON() {
  const data = await repo.exportData();
  data.covers = {};
  for (const b of data.books) {
    if (b.coverGenerated === false) {
      const blob = recordBlob(await db.get('covers', b.id), 'image/jpeg');
      if (blob) data.covers[b.id] = await blobToDataURL(blob);
    }
  }
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  downloadBlob(blob, `audiobook-dados-${dayKey()}.json`);
  return blob.size;
}

export async function exportFull(onProgress = () => {}) {
  const data = await repo.exportData();
  const files = [];
  const parts = [];
  let offset = 0;
  for (let i = 0; i < data.books.length; i++) {
    const book = data.books[i];
    onProgress({ index: i, total: data.books.length, title: book.title });
    for (const id of await db.getKeysByIndex('audio', 'bookId', book.id)) {
      const rec = await db.get('audio', id);
      const blob = recordBlob(rec, 'audio/mpeg');
      if (!blob) continue;
      files.push({ kind: 'audio', id, bookId: book.id, name: rec.name, type: rec.type || blob.type, size: blob.size, offset });
      parts.push(blob);
      offset += blob.size;
    }
    const cover = recordBlob(await db.get('covers', book.id), 'image/jpeg');
    if (cover) {
      files.push({ kind: 'cover', id: book.id, bookId: book.id, type: cover.type, size: cover.size, offset });
      parts.push(cover);
      offset += cover.size;
    }
  }
  const header = new TextEncoder().encode(JSON.stringify({ ...data, files }));
  const blob = new Blob([MAGIC, String(header.length).padStart(LEN_DIGITS, '0'), header, ...parts], { type: 'application/octet-stream' });
  downloadBlob(blob, `audiobook-backup-${dayKey()}.audiobook`);
  return blob.size;
}

/** Importa .json ou .audiobook. Retorna { books, missing }. */
export async function importBackup(file, onProgress = () => {}) {
  const head = await file.slice(0, MAGIC.length + LEN_DIGITS).text();
  if (head.startsWith(MAGIC)) {
    const len = Number(head.slice(MAGIC.length));
    const start = MAGIC.length + LEN_DIGITS;
    const data = JSON.parse(await file.slice(start, start + len).text());
    const base = start + len;
    const covers = new Map();
    const audioFiles = data.files.filter((f) => f.kind === 'audio');
    let n = 0;
    for (const f of data.files) {
      const blob = file.slice(base + f.offset, base + f.offset + f.size, f.type);
      if (f.kind === 'audio') {
        onProgress({ index: n++, total: audioFiles.length, name: f.name });
        await repo.storeAudioRecord({ id: f.id, bookId: f.bookId, name: f.name, size: f.size, type: f.type, addedAt: Date.now() }, blob);
      } else if (f.kind === 'cover') covers.set(f.bookId, blob);
    }
    delete data.files;
    return repo.importData(data, { covers });
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Arquivo inválido. Selecione um arquivo .json ou .audiobook exportado pelo AUDIOBOOK.');
  }
  const covers = new Map();
  for (const [bookId, url] of Object.entries(data.covers || {})) {
    try {
      covers.set(bookId, await dataURLToBlob(url));
    } catch {}
  }
  delete data.covers;
  return repo.importData(data, { covers });
}
