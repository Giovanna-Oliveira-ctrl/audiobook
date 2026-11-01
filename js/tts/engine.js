/* Motor de voz neural (Piper) no dispositivo: download único, cache offline e worker.
 *
 *  - Motor (ONNX Runtime + espeak-ng + lamejs ≈ 31 MB): servido pelo próprio app em /vendor
 *    e guardado no Cache Storage "audiobook-engine-v1".
 *  - Vozes (.onnx ≈ 60 MB + .json): baixadas do repositório oficial Piper (Hugging Face) uma vez,
 *    ou importadas de arquivo; guardadas em "audiobook-voices-v1".
 * Nenhum dos dois caches é apagado por atualizações do app nem por "limpar cache do app". */

import { bus } from '../state.js';

const ENGINE_CACHE = 'audiobook-engine-v1';
const VOICE_CACHE = 'audiobook-voices-v1';
const appBase = new URL('../../', import.meta.url).href;

const ENGINE_FILES = {
  ort: 'vendor/onnxruntime-1.20.1/ort.wasm.min.js',
  ortMjs: 'vendor/onnxruntime-1.20.1/ort-wasm-simd-threaded.mjs',
  ortWasm: 'vendor/onnxruntime-1.20.1/ort-wasm-simd-threaded.wasm',
  phonemizeJs: 'vendor/piper-phonemize-1.0.0/piper_phonemize.js',
  phonemizeWasm: 'vendor/piper-phonemize-1.0.0/piper_phonemize.wasm',
  phonemizeData: 'vendor/piper-phonemize-1.0.0/piper_phonemize.data',
  lame: 'vendor/lamejs-1.2.1/lame.min.js',
};
// Leitor de PDF: não vai para o worker, mas fica no mesmo cache offline.
const EXTRA_FILES = ['vendor/pdfjs-6.5.438/pdf.min.mjs', 'vendor/pdfjs-6.5.438/pdf.worker.min.mjs'];
const MIME = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', data: 'application/octet-stream' };
export const ENGINE_SIZE_MB = 33;

const HF = [
  'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/',
  'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/',
];

export const BUILTIN_VOICES = [
  {
    id: 'pt_BR-faber-medium',
    name: 'Faber',
    description: 'Voz masculina em português do Brasil, natural e clara. Recomendada.',
    path: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
    sizeMB: 63,
    quality: 'Média (22 kHz)',
  },
  {
    id: 'pt_BR-edresson-low',
    name: 'Edresson',
    description: 'Voz masculina em português do Brasil, mais leve. Boa opção para aparelhos mais lentos.',
    path: 'pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx',
    sizeMB: 63,
    quality: 'Baixa (16 kHz)',
  },
];

const voiceKey = (id, ext) => `${appBase}voices/${encodeURIComponent(id)}.${ext}`;
const INDEX_KEY = `${appBase}voices/index.json`;

/* ------------------------------ Motor ------------------------------ */

export async function engineStatus() {
  if (!('caches' in self)) return { cached: false, missing: [...Object.values(ENGINE_FILES), ...EXTRA_FILES] };
  const cache = await caches.open(ENGINE_CACHE);
  const missing = [];
  for (const path of [...Object.values(ENGINE_FILES), ...EXTRA_FILES]) if (!(await cache.match(appBase + path))) missing.push(path);
  return { cached: missing.length === 0, missing };
}

async function fetchWithProgress(url, onBytes, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url.split('/').pop()}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onBytes) return { blob: await res.blob(), total };
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(value.length, loaded, total);
  }
  return { blob: new Blob(chunks, { type: res.headers.get('content-type') || '' }), total };
}

/** Baixa (uma vez) os arquivos do motor para o cache offline. */
export async function prepareEngine(onProgress = () => {}, signal) {
  const status = await engineStatus();
  if (status.cached) return;
  if (!navigator.onLine) throw new Error(`Sem internet. O motor de voz precisa ser baixado uma vez (≈ ${ENGINE_SIZE_MB} MB).`);
  const cache = await caches.open(ENGINE_CACHE);
  const expected = ENGINE_SIZE_MB * 1024 * 1024;
  let loaded = 0;
  for (const path of status.missing) {
    const url = appBase + path;
    const { blob } = await fetchWithProgress(url, (n) => onProgress({ phase: 'engine', loaded: (loaded += n), total: expected }), signal);
    const type = MIME[url.split('.').pop()] || 'application/octet-stream';
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } }));
  }
}

async function engineUrls() {
  const cache = await caches.open(ENGINE_CACHE);
  const urls = {};
  for (const [k, path] of Object.entries(ENGINE_FILES)) {
    const res = await cache.match(appBase + path);
    if (!res) throw new Error('Motor de voz não está baixado.');
    const blob = await res.blob();
    const type = MIME[path.split('.').pop()] || 'application/octet-stream';
    urls[k] = URL.createObjectURL(new Blob([blob], { type }));
  }
  return urls;
}

/* ------------------------------ Vozes ------------------------------ */

async function readIndex() {
  const cache = await caches.open(VOICE_CACHE);
  const res = await cache.match(INDEX_KEY);
  return res ? res.json() : {};
}
async function writeIndex(index) {
  const cache = await caches.open(VOICE_CACHE);
  await cache.put(INDEX_KEY, new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }));
}

/** Lista vozes conhecidas (embutidas + importadas) com o estado de download. */
export async function listVoices() {
  const index = await readIndex().catch(() => ({}));
  const builtin = BUILTIN_VOICES.map((v) => ({ ...v, custom: false, downloaded: !!index[v.id], size: index[v.id]?.size || 0 }));
  const custom = Object.values(index)
    .filter((v) => v.custom)
    .map((v) => ({ ...v, downloaded: true }));
  return [...builtin, ...custom];
}

export async function isVoiceReady(id) {
  const index = await readIndex().catch(() => ({}));
  return !!index[id];
}

/** Baixa uma voz embutida (≈ 60 MB). */
export async function downloadVoice(id, onProgress = () => {}, signal) {
  const v = BUILTIN_VOICES.find((x) => x.id === id);
  if (!v) throw new Error('Voz desconhecida.');
  if (!navigator.onLine) throw new Error('Sem internet. A voz precisa ser baixada uma vez (≈ 60 MB).');
  let lastErr;
  for (const base of HF) {
    try {
      const cfg = await fetchWithProgress(base + v.path + '.json', null, signal);
      const config = JSON.parse(await cfg.blob.text());
      const model = await fetchWithProgress(base + v.path, (n, loaded, total) => onProgress({ phase: 'voice', loaded, total: total || v.sizeMB * 1048576 }), signal);
      await storeVoice({ id, name: v.name, description: v.description, custom: false }, model.blob, config);
      return;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw new Error(`Não foi possível baixar a voz (${lastErr?.message || 'erro de rede'}).`);
}

async function storeVoice(meta, modelBlob, config) {
  const cache = await caches.open(VOICE_CACHE);
  await cache.put(voiceKey(meta.id, 'onnx'), new Response(modelBlob, { headers: { 'Content-Type': 'application/octet-stream' } }));
  await cache.put(voiceKey(meta.id, 'json'), new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } }));
  const index = await readIndex();
  index[meta.id] = { ...meta, size: modelBlob.size, language: config.language?.name_native || config.espeak?.voice || '', addedAt: Date.now() };
  await writeIndex(index);
  bus.emit('voices');
}

/** Importa uma voz Piper a partir de arquivos (.onnx + .onnx.json) — útil sem internet. */
export async function importVoiceFiles(files) {
  const model = files.find((f) => /\.onnx$/i.test(f.name));
  const json = files.find((f) => /\.json$/i.test(f.name));
  if (!model || !json) throw new Error('Selecione os dois arquivos da voz: o modelo “.onnx” e o “.onnx.json”.');
  let config;
  try {
    config = JSON.parse(await json.text());
  } catch {
    throw new Error('O arquivo .json da voz é inválido.');
  }
  if (!config.audio?.sample_rate) throw new Error('O .json não parece ser de uma voz Piper (falta audio.sample_rate).');
  const id = model.name.replace(/\.onnx$/i, '');
  const name = id.replace(/^[a-z]{2}_[A-Z]{2}-/, '').replace(/[-_]/g, ' ');
  await storeVoice({ id, name, description: `Voz importada (${config.espeak?.voice || 'idioma desconhecido'})`, custom: true }, model, config);
  return id;
}

export async function deleteVoice(id) {
  const cache = await caches.open(VOICE_CACHE);
  await cache.delete(voiceKey(id, 'onnx'));
  await cache.delete(voiceKey(id, 'json'));
  const index = await readIndex();
  delete index[id];
  await writeIndex(index);
  if (tts.voiceId === id) tts.reset();
  bus.emit('voices');
}

export async function removeEngine() {
  await caches.delete(ENGINE_CACHE);
  tts.reset();
  bus.emit('voices');
}

export async function ttsStorage() {
  let engine = 0, voices = 0;
  if (!('caches' in self)) return { engine, voices };
  for (const [name, add] of [[ENGINE_CACHE, (n) => (engine += n)], [VOICE_CACHE, (n) => (voices += n)]]) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      add(Number(res.headers.get('content-length')) || (await res.clone().blob()).size);
    }
  }
  return { engine, voices };
}

/* ------------------------------ Worker ------------------------------ */

class TTS {
  constructor() {
    this.worker = null;
    this.voiceId = null;
    this.seq = 0;
    this.pending = new Map();
    this.loading = null;
  }

  reset() {
    this.worker?.terminate();
    this.worker = null;
    this.voiceId = null;
    this.loading = null;
    for (const p of this.pending.values()) p.reject(new Error('Motor reiniciado.'));
    this.pending.clear();
  }

  call(msg, transfer = [], onProgress) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  onMessage({ data }) {
    const p = this.pending.get(data.id);
    if (!p) return;
    if (data.type === 'progress') return p.onProgress?.(data);
    this.pending.delete(data.id);
    if (data.type === 'error') p.reject(new Error(data.message));
    else if (data.type === 'cancelled') p.resolve(null);
    else p.resolve(data);
  }

  /** Garante motor + voz carregados no worker. */
  async ensure(voiceId) {
    if (this.voiceId === voiceId && this.worker) return;
    if (this.loading?.voiceId === voiceId) return this.loading.promise;
    const promise = (async () => {
      const status = await engineStatus();
      if (!status.cached) throw new Error('O motor de voz ainda não foi baixado.');
      if (!this.worker) {
        this.worker = new Worker(new URL('./tts-worker.js', import.meta.url));
        this.worker.onmessage = (e) => this.onMessage(e);
        this.worker.onerror = (e) => {
          const err = new Error(e.message || 'Falha no motor de voz.');
          for (const p of this.pending.values()) p.reject(err);
          this.pending.clear();
        };
      }
      const cache = await caches.open(VOICE_CACHE);
      const [modelRes, cfgRes] = await Promise.all([cache.match(voiceKey(voiceId, 'onnx')), cache.match(voiceKey(voiceId, 'json'))]);
      if (!modelRes || !cfgRes) throw new Error('Esta voz não está baixada neste dispositivo.');
      const model = await modelRes.arrayBuffer();
      const config = await cfgRes.json();
      const urls = await engineUrls();
      try {
        await this.call({ type: 'load', voiceId, model, config, urls }, [model]);
      } finally {
        Object.values(urls).forEach((u) => setTimeout(() => URL.revokeObjectURL(u), 60000));
      }
      this.voiceId = voiceId;
    })();
    this.loading = { voiceId, promise };
    try {
      await promise;
    } catch (err) {
      this.reset();
      throw err;
    } finally {
      this.loading = null;
    }
  }

  /** Sintetiza parágrafos -> { blob (MP3), duration, chars } ou null se cancelado. */
  synth(paragraphs, { lengthScale = 1, onProgress } = {}) {
    if (!this.worker) return Promise.reject(new Error('Motor não carregado.'));
    const p = this.call({ type: 'synth', paragraphs, lengthScale }, [], onProgress);
    p.jobId = this.seq;
    return p;
  }

  cancel(jobId) {
    this.worker?.postMessage({ type: 'cancel', target: jobId });
  }
}

export const tts = new TTS();

/** Gera e toca uma amostra curta da voz. Retorna o elemento <audio> da amostra. */
export async function sampleVoice(voiceId, text, lengthScale = 1) {
  await tts.ensure(voiceId);
  const res = await tts.synth([text], { lengthScale });
  if (!res) return null;
  const url = URL.createObjectURL(res.blob);
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  return { audio, ...res };
}
