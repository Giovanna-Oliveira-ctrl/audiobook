/* Capas: carregamento do IndexedDB como Object URL (com cache e revogação),
 * redimensionamento de imagens importadas, geração de capas automáticas
 * e arte para a Media Session (data URL, aceita por todos os navegadores). */

import * as db from './db.js';
import { hashString } from './utils.js';

const urls = new Map(); // bookId -> objectURL
const inflight = new Map();
const artwork = new Map(); // bookId -> dataURL

const recordToBlob = (rec) =>
  rec?.blob instanceof Blob
    ? rec.blob
    : rec?.buffer
      ? new Blob([rec.buffer], { type: rec.type || 'image/jpeg' })
      : null;

export const cachedCoverURL = (id) => urls.get(id) || null;

export function loadCoverURL(id) {
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (inflight.has(id)) return inflight.get(id);
  const p = db
    .get('covers', id)
    .then((rec) => {
      inflight.delete(id);
      const blob = recordToBlob(rec);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      return url;
    })
    .catch(() => {
      inflight.delete(id);
      return null;
    });
  inflight.set(id, p);
  return p;
}

/** Libera a Object URL da capa (evita vazamento de memória). */
export function invalidateCover(id) {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  artwork.delete(id);
}

export function invalidateAllCovers() {
  for (const id of [...urls.keys()]) invalidateCover(id);
  artwork.clear();
}

/** Paleta determinística para placeholders e capas geradas. */
export function palette(seed = '') {
  const hue = hashString(seed) % 360;
  return {
    hue,
    a: `hsl(${hue} 38% 34%)`,
    b: `hsl(${(hue + 32) % 360} 44% 17%)`,
    ink: `hsl(${(hue + 18) % 360} 70% 80%)`,
  };
}

async function decodeImage(blob) {
  if ('createImageBitmap' in self) {
    try {
      return await createImageBitmap(blob);
    } catch {}
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

const toBlob = (canvas, type = 'image/jpeg', q = 0.86) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, q));

function averageColor(source) {
  const c = document.createElement('canvas');
  c.width = c.height = 10;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, 10, 10);
  const { data } = ctx.getImageData(0, 0, 10, 10);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    const w = 1 + (max - min) / 64; // pondera cores mais saturadas
    r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; n += w;
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Redimensiona a imagem escolhida pelo usuário (máx. 800 px) e extrai a cor dominante. */
export async function prepareCover(blob, max = 800) {
  const img = await decodeImage(blob);
  const w = img.width, h = img.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const color = averageColor(canvas);
  img.close?.();
  const out = await toBlob(canvas);
  return { blob: out || blob, color };
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Gera uma capa tipográfica elegante quando o livro não tem imagem. */
export async function generateCover({ title = 'Sem título', author = '' }) {
  const S = 800;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const { hue } = palette(title + author);

  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, `hsl(${hue} 36% 32%)`);
  g.addColorStop(1, `hsl(${(hue + 30) % 360} 42% 13%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // Textura sutil: círculos concêntricos (ondas sonoras)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let r = 120; r < 900; r += 46) {
    ctx.beginPath();
    ctx.arc(S * 0.88, S * 0.1, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Lombada
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 26, S);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(26, 0, 3, S);

  const ink = `hsl(${(hue + 18) % 360} 72% 80%)`;
  const pad = 88;

  ctx.fillStyle = ink;
  ctx.font = '600 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('A U D I O L I V R O', pad, pad);
  ctx.fillRect(pad, pad + 48, 64, 4);

  let size = 96;
  let lines;
  do {
    ctx.font = `700 ${size}px Georgia, "Iowan Old Style", "Times New Roman", serif`;
    lines = wrapLines(ctx, title, S - pad * 2);
    size -= 6;
  } while ((lines.length > 5 || lines.some((l) => ctx.measureText(l).width > S - pad * 2)) && size > 40);
  size += 6;
  const lh = size * 1.12;
  const blockH = lines.length * lh;
  let y = Math.max(pad + 110, S * 0.52 - blockH / 2);
  ctx.fillStyle = '#fbf4e8';
  ctx.textBaseline = 'alphabetic';
  for (const l of lines) {
    y += lh;
    ctx.fillText(l, pad, y - lh * 0.22);
  }

  if (author) {
    ctx.fillStyle = ink;
    ctx.font = '500 34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const a = wrapLines(ctx, author.toUpperCase(), S - pad * 2)[0];
    ctx.fillText(a, pad, S - pad);
  }

  const blob = await toBlob(canvas, 'image/jpeg', 0.9);
  return { blob, color: `hsl(${hue} 36% 30%)`, generated: true };
}

/** Arte 512×512 em data URL para a Media Session (tela de bloqueio / notificação). */
export async function artworkDataURL(id) {
  if (artwork.has(id)) return artwork.get(id);
  try {
    const rec = await db.get('covers', id);
    const blob = recordToBlob(rec);
    if (!blob) return null;
    const img = await decodeImage(blob);
    const S = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(S / img.width, S / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    img.close?.();
    const url = canvas.toDataURL('image/jpeg', 0.85);
    artwork.set(id, url);
    return url;
  } catch {
    return null;
  }
}
