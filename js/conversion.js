/* Conversões de ebook em audiolivro.
 * Cada conversão é salva no IndexedDB com o texto dos capítulos e o estado de cada um.
 * Os capítulos são gerados um a um; assim que um fica pronto ele entra no livro da
 * biblioteca e já pode ser ouvido. Se o app for fechado, a conversão continua de onde
 * parou ao reabrir (o capítulo interrompido é refeito). */

import * as db from './db.js';
import * as repo from './repo.js';
import { bus, state } from './state.js';
import { tts, isVoiceReady } from './tts/engine.js';
import { generateCover, prepareCover } from './covers.js';
import { uid } from './utils.js';

export const jobs = new Map();
let active = null; // { job, synthId }
let wakeLock = null;

const emit = (job) => bus.emit('conversion', job?.id);
const save = (job) => {
  job.updatedAt = Date.now();
  return db.put('conversions', stripRuntime(job));
};
const stripRuntime = (job) => {
  const { live, ...rest } = job;
  return rest;
};

export const allJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
export const activeJob = () => active?.job || null;

export function jobStats(job) {
  const included = job.chapters.filter((c) => c.include);
  const done = included.filter((c) => c.state === 'done');
  const totalChars = included.reduce((s, c) => s + c.chars, 0) || 1;
  const doneChars = done.reduce((s, c) => s + c.chars, 0) + (job.live?.done || 0);
  const fraction = Math.min(1, doneChars / totalChars);
  // Velocidade medida: ms de processamento por caractere
  const msPerChar = job.processedChars > 200 ? job.processingMs / job.processedChars : null;
  const etaSeconds = msPerChar ? ((totalChars - doneChars) * msPerChar) / 1000 : null;
  return { total: included.length, done: done.length, fraction, etaSeconds, audioSeconds: done.reduce((s, c) => s + (c.duration || 0), 0) };
}

/* ------------------------------------------------------------------ */

export async function loadConversions() {
  const rows = await db.getAll('conversions').catch(() => []);
  for (const job of rows) {
    // Conversões interrompidas (app fechado no meio) voltam para a fila.
    if (job.status === 'running') job.status = 'queued';
    job.chapters.forEach((c) => c.state === 'running' && (c.state = 'pending'));
    jobs.set(job.id, job);
  }
  // Só retoma automaticamente se a voz já estiver no aparelho (não depende de internet).
  for (const job of jobs.values()) {
    if (job.status === 'queued' && !(await isVoiceReady(job.voiceId))) job.status = 'paused';
  }
  emit();
  pump();
}

export async function createConversion({ meta, cover, chapters, voiceId, voiceName, lengthScale = 1, sourceName = '' }) {
  const job = {
    id: uid('cv_'),
    status: 'queued',
    meta,
    cover: cover || null,
    voiceId,
    voiceName,
    lengthScale,
    sourceName,
    bookId: null,
    chapters: chapters.map((c, i) => ({ index: i, title: c.title, paragraphs: c.paragraphs, chars: c.chars, words: c.words, include: c.include !== false, state: 'pending' })),
    processingMs: 0,
    processedChars: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
  };
  jobs.set(job.id, job);
  await save(job);
  emit(job);
  pump();
  return job;
}

export async function pauseConversion(id) {
  const job = jobs.get(id);
  if (!job || !['running', 'queued'].includes(job.status)) return;
  job.status = 'paused';
  if (active?.job === job && active.synthId) tts.cancel(active.synthId);
  await save(job);
  emit(job);
}

export async function resumeConversion(id) {
  const job = jobs.get(id);
  if (!job || !['paused', 'error'].includes(job.status)) return;
  job.status = 'queued';
  job.error = null;
  await save(job);
  emit(job);
  pump();
}

export async function cancelConversion(id) {
  const job = jobs.get(id);
  if (!job) return;
  const wasActive = active?.job === job;
  job.status = 'canceled';
  if (wasActive && active.synthId) tts.cancel(active.synthId);
  await save(job);
  if (job.bookId && repo.getBook(job.bookId)) await repo.updateBook(job.bookId, { conversion: null });
  emit(job);
}

export async function removeConversion(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (['running', 'queued'].includes(job.status)) await cancelConversion(id);
  jobs.delete(id);
  await db.del('conversions', id);
  emit();
}

/* ------------------------------------------------------------------ */

async function pump() {
  if (active) return;
  const next = allJobs().reverse().find((j) => j.status === 'queued');
  if (!next) {
    releaseWakeLock();
    return;
  }
  active = { job: next, synthId: null };
  try {
    await run(next);
  } finally {
    active = null;
    setTimeout(pump, 0);
  }
}

async function run(job) {
  job.status = 'running';
  await save(job);
  emit(job);
  acquireWakeLock();
  try {
    job.live = { phase: 'loading' };
    emit(job);
    await tts.ensure(job.voiceId);
    for (const ch of job.chapters) {
      if (!ch.include || ch.state === 'done') continue;
      if (job.status !== 'running') return;
      ch.state = 'running';
      job.live = { chapter: ch.index, done: 0, total: ch.chars, phase: 'synth' };
      emit(job);
      const t0 = performance.now();
      const p = tts.synth(ch.paragraphs, {
        lengthScale: job.lengthScale,
        onProgress: (prog) => {
          job.live = { chapter: ch.index, done: Math.round((prog.done / prog.total) * ch.chars), total: ch.chars, phase: 'synth' };
          emit(job);
        },
      });
      active.synthId = p.jobId;
      const res = await p;
      active.synthId = null;
      if (!res) {
        ch.state = 'pending';
        return; // pausado/cancelado
      }
      job.processingMs += performance.now() - t0;
      job.processedChars += ch.chars;
      job.live = { chapter: ch.index, done: ch.chars, total: ch.chars, phase: 'saving' };
      emit(job);
      await addChapterToBook(job, ch, res);
      ch.state = 'done';
      ch.duration = res.duration;
      ch.size = res.blob.size;
      await save(job);
      emit(job);
    }
    job.live = null;
    if (job.status === 'running') {
      job.status = 'done';
      job.finishedAt = Date.now();
      await save(job);
      if (job.bookId) await repo.updateBook(job.bookId, { conversion: null });
      bus.emit('toast', { message: `“${job.meta.title}” foi convertido em audiolivro.`, tone: 'success' });
    }
  } catch (err) {
    console.error('[conversão]', err);
    job.live = null;
    job.status = 'error';
    job.error = err.message || String(err);
    job.chapters.forEach((c) => c.state === 'running' && (c.state = 'pending'));
    await save(job);
    bus.emit('toast', { message: `Conversão interrompida: ${job.error}`, tone: 'error' });
  } finally {
    job.live = null;
    emit(job);
  }
}

async function addChapterToBook(job, ch, res) {
  const included = job.chapters.filter((c) => c.include);
  const number = included.indexOf(ch) + 1;
  const fileKey = uid('f_');
  const fileName = `${(job.meta.title || 'livro').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}-${String(number).padStart(3, '0')}.mp3`;
  const files = new Map([[fileKey, { blob: res.blob, name: fileName, size: res.blob.size, type: 'audio/mpeg' }]]);
  const newChapter = { title: ch.title, fileKey, start: 0, duration: res.duration, fileName, fileSize: res.blob.size, type: 'audio/mpeg' };
  const doneCount = included.filter((c) => c.state === 'done').length + 1;
  const conversion = { jobId: job.id, done: doneCount, total: included.length };

  let book = job.bookId ? repo.getBook(job.bookId) : null;
  if (!book) {
    let cover;
    if (job.cover) cover = await prepareCover(job.cover).then((c) => ({ ...c, generated: false })).catch(() => null);
    if (!cover) cover = await generateCover({ title: job.meta.title, author: job.meta.author });
    book = await repo.saveBookFromDraft({
      meta: { ...job.meta, narrator: job.meta.narrator || `Voz sintética ${job.voiceName || ''}`.trim() },
      cover,
      chapters: [newChapter],
      files,
    });
    job.bookId = book.id;
    await repo.updateBook(book.id, { conversion, generatedFrom: { jobId: job.id, voiceId: job.voiceId, source: job.sourceName } });
    return;
  }
  const existing = await repo.getChapters(book.id);
  await repo.saveBookFromDraft({
    bookId: book.id,
    meta: { title: book.title, author: book.author, narrator: book.narrator, genre: book.genre, year: book.year, synopsis: book.synopsis },
    chapters: [
      ...existing.map((c) => ({ id: c.id, title: c.title, audioId: c.audioId, start: c.start, duration: c.duration, fileName: c.fileName, fileSize: c.fileSize, type: c.type })),
      newChapter,
    ],
    files,
  });
  await repo.updateBook(book.id, { conversion: job.status === 'running' && doneCount < included.length ? conversion : null });
}

/* -------------------- Manter a tela ligada durante a conversão -------------------- */

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible' || !active) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {}
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && active) acquireWakeLock();
});

export { state };
