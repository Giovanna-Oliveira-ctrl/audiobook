/* Audiolivro de demonstração gerado no próprio dispositivo.
 * O áudio é sintetizado em JavaScript (acordes suaves + sinos que indicam o
 * número do capítulo). É conteúdo original, sem direitos autorais de terceiros,
 * e não depende de internet. Serve para testar capítulos, temporizador,
 * marcadores, tela de bloqueio e funcionamento offline sem precisar de arquivos. */

import { generateCover } from './covers.js';
import { uid } from './utils.js';

const SR = 16000;

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI -> Hz

const PROGRESSIONS = [
  [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]], // C  Am F  G
  [[62, 65, 69], [58, 62, 65], [60, 64, 67], [57, 61, 64]], // Dm Bb C  A
  [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]], // G  Em C  D
];

function synthChapter(number, seconds) {
  const total = Math.floor(seconds * SR);
  const out = new Float32Array(total);
  const prog = PROGRESSIONS[(number - 1) % PROGRESSIONS.length];
  const chordLen = 4;

  // 1) Sinos: N toques = capítulo N (fácil de reconhecer de olhos fechados)
  for (let k = 0; k < number; k++) {
    const t0 = 0.4 + k * 0.7;
    const f = NOTE(84);
    const start = Math.floor(t0 * SR);
    const len = Math.floor(1.6 * SR);
    for (let i = 0; i < len && start + i < total; i++) {
      const t = i / SR;
      const env = Math.exp(-t * 3.2);
      out[start + i] += 0.22 * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t));
    }
  }

  // 2) Pad de acordes + arpejo suave
  const padStart = 0.4 + number * 0.7 + 0.6;
  for (let i = Math.floor(padStart * SR); i < total; i++) {
    const t = i / SR;
    const tp = Math.max(0, t - padStart);
    const ci = Math.floor(tp / chordLen) % prog.length;
    const chord = prog[ci];
    const local = tp % chordLen;
    const env = Math.min(1, local / 0.8) * Math.min(1, (chordLen - local) / 0.8);
    let s = 0;
    for (const n of chord) {
      const f = NOTE(n - 12);
      s += Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * f * 2.001 * t);
    }
    s *= 0.05 * (0.6 + 0.4 * env);
    // arpejo (colcheias)
    const step = Math.floor(local / 0.5);
    const note = chord[step % 3] + (step >= 3 ? 12 : 0);
    const nt = local % 0.5;
    const af = NOTE(note + 12);
    s += 0.07 * Math.exp(-nt * 5) * Math.sin(2 * Math.PI * af * t);
    out[i] += s;
  }

  // 3) Fade in/out
  const fade = Math.floor(1.2 * SR);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[total - 1 - i] *= i / fade;
  }
  return encodeWav(out);
}

function encodeWav(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Retorna um rascunho pronto para repo.saveBookFromDraft(). */
export async function buildDemoDraft() {
  const chapters = [
    { title: 'Capítulo 1 — Boas-vindas', seconds: 45 },
    { title: 'Capítulo 2 — Entre as estantes', seconds: 60 },
    { title: 'Capítulo 3 — Até a próxima página', seconds: 40 },
  ];
  const files = new Map();
  const list = [];
  for (let i = 0; i < chapters.length; i++) {
    await new Promise((r) => setTimeout(r, 0)); // não travar a interface
    const blob = synthChapter(i + 1, chapters[i].seconds);
    const key = uid('f_');
    const name = `demo-capitulo-${i + 1}.wav`;
    files.set(key, { blob, name, size: blob.size, type: 'audio/wav' });
    list.push({ title: chapters[i].title, fileKey: key, start: 0, duration: chapters[i].seconds, fileName: name, fileSize: blob.size, type: 'audio/wav' });
  }
  const meta = {
    title: 'Sons da Biblioteca',
    author: 'AUDIOBOOK',
    narrator: 'Sintetizador do app',
    genre: 'Demonstração',
    year: String(new Date().getFullYear()),
    synopsis:
      'Audiolivro de demonstração criado no seu próprio dispositivo, sem internet. Cada capítulo começa com sinos — um toque para o capítulo 1, dois para o 2, três para o 3 — seguidos de acordes suaves. Use-o para testar a troca automática de capítulos, o temporizador, os marcadores, a velocidade e os controles na tela de bloqueio. O conteúdo é original e livre de direitos autorais.',
  };
  const cover = await generateCover({ title: meta.title, author: meta.author });
  return { meta, cover, chapters: list, files };
}
