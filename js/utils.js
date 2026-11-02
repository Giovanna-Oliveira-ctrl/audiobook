/* Utilitários gerais (sem dependências de DOM, exceto downloadBlob). */

export const uid = (prefix = '') =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const pad = (n) => String(n).padStart(2, '0');

/** 3725 -> "1:02:05"; 65 -> "1:05" */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 18720 -> "5 h 12 min" */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0 min';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${sec} s`;
}

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${i === 0 ? Math.round(v) : nf1.format(v)} ${units[i]}`;
}

export const formatNumber = (n) => new Intl.NumberFormat('pt-BR').format(n);

const dfDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const dfTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dfWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const dfLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDate = (ts) => (ts ? dfDate.format(new Date(ts)) : '—');
export const formatClock = (ts) => dfTime.format(new Date(ts));
export const formatDateTime = (ts) => `${formatDate(ts)} às ${formatClock(ts)}`;
export const todayLong = () => capitalize(dfLong.format(new Date()));

export function relativeDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7) return capitalize(dfWeekday.format(d));
  return formatDate(ts);
}

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a, b) => collator.compare(a || '', b || '');

export const normalize = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Hash FNV-1a de 32 bits (para cores determinísticas). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "1:02:03" | "62:03" | "45" -> segundos */
export function parseClock(str) {
  const parts = String(str).trim().replace(',', '.').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Converte linhas do tipo "00:00 Introdução" / "1:02:03 - Capítulo 2"
 * em [{ start, title }], ordenado.
 */
export function parseTimestampList(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[?(\d{1,3}(?::\d{1,2}){1,2}(?:[.,]\d+)?)\]?\s*[-–—:|]?\s*(.*)$/);
    if (!m) continue;
    const start = parseClock(m[1]);
    if (Number.isFinite(start)) out.push({ start, title: m[2].trim() });
  }
  return out.sort((a, b) => a.start - b.start);
}

export const AUDIO_EXTENSIONS = [
  'mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'webm', 'weba', 'mp4', 'caf', 'aif', 'aiff', '3gp', 'amr', 'mka',
];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];

export const fileExt = (name = '') => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};

export const isAudioFile = (f) =>
  (f.type && f.type.startsWith('audio/')) || AUDIO_EXTENSIONS.includes(fileExt(f.name));
export const isImageFile = (f) =>
  (f.type && f.type.startsWith('image/')) || IMAGE_EXTENSIONS.includes(fileExt(f.name));

const MIME_BY_EXT = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  webm: 'audio/webm', weba: 'audio/webm', caf: 'audio/x-caf', aif: 'audio/aiff', aiff: 'audio/aiff',
  '3gp': 'audio/3gpp', amr: 'audio/amr', mka: 'audio/x-matroska',
};

/** Tipo MIME normalizado (alguns sistemas informam m4b como audio/x-m4b ou vazio). */
export function guessMime(name, type) {
  const t = (type || '').toLowerCase();
  if (t === 'audio/x-m4b' || t === 'audio/x-m4a' || t === 'audio/m4b') return 'audio/mp4';
  if (t && t !== 'application/octet-stream') return t;
  return MIME_BY_EXT[fileExt(name)] || 'audio/mpeg';
}

/** "01 - Capitulo_01.mp3" -> "Capitulo 01" */
export function cleanTitle(fileName = '') {
  let s = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = s.replace(/^\d{1,4}\s*[-.)_:]\s*/, '').trim();
  if (stripped) s = stripped;
  return s || fileName;
}

/** Maior prefixo comum entre nomes (para sugerir título do livro). */
export function commonPrefix(names) {
  if (!names.length) return '';
  let p = names[0];
  for (const n of names.slice(1)) {
    while (p && !n.startsWith(p)) p = p.slice(0, -1);
  }
  return p.replace(/[\s\-_.(\[]*(cap(itulo|ítulo)?|chapter|parte|part|faixa|track|disc|cd)?[\s\-_.]*\d*$/i, '').trim();
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`;
