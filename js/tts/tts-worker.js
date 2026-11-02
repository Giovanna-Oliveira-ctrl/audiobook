/* Worker de síntese de voz (texto -> fala), 100% no dispositivo.
 *
 *  1. Fonemização: espeak-ng compilado para WebAssembly (piper_phonemize), voz "pt-br".
 *  2. Inferência: modelo neural Piper (VITS) via ONNX Runtime Web (WASM, 1 thread).
 *  3. Codificação: MP3 com lamejs (arquivos ~20 MB por hora de áudio).
 *
 * Os arquivos do motor chegam como Object URLs (lidas do Cache Storage pela página),
 * então o worker funciona offline sem depender do Service Worker.
 * Worker "clássico" (importScripts) para máxima compatibilidade.
 */
/* global ort, createPiperPhonemize, lamejs */

let engineReady = false;
let phonemizer = null;
let phonemizerUrls = null;
let lastOutput = null;
let session = null;
let voice = null; // { id, config }
const cancelled = new Set();

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = async ({ data: msg }) => {
  const { id, type } = msg;
  try {
    if (type === 'load') {
      await loadEngine(msg.urls);
      await loadVoice(msg.voiceId, msg.model, msg.config);
      post({ id, type: 'loaded' });
    } else if (type === 'synth') {
      const result = await synthesize(msg);
      if (result) post({ id, type: 'done', ...result });
    } else if (type === 'cancel') {
      cancelled.add(msg.target);
    }
  } catch (err) {
    post({ id, type: 'error', message: (err && err.message) || String(err) });
  }
};

/* ------------------------------------------------------------------ */

async function loadEngine(urls) {
  if (engineReady) return;
  importScripts(urls.ort, urls.phonemizeJs, urls.lame);
  ort.env.wasm.numThreads = 1; // GitHub Pages não tem isolamento cross-origin: 1 thread
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs: urls.ortMjs, wasm: urls.ortWasm };
  ort.env.logLevel = 'error';
  phonemizerUrls = urls;
  phonemizer = await createPhonemizer();
  engineReady = true;
}

function createPhonemizer() {
  return createPiperPhonemize({
    print: (line) => {
      lastOutput = line;
    },
    printErr: () => {},
    locateFile: (file) => (file.endsWith('.wasm') ? phonemizerUrls.phonemizeWasm : file.endsWith('.data') ? phonemizerUrls.phonemizeData : file),
    noInitialRun: true,
  });
}

async function loadVoice(voiceId, model, config) {
  if (voice && voice.id === voiceId && session) return;
  if (session && session.release) await session.release();
  session = null;
  session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  voice = { id: voiceId, config, espeak: ((config.espeak && config.espeak.voice) || 'pt-br').toLowerCase(), remap: false };
  // Vozes treinadas com outras versões do Piper podem usar outro mapa de fonemas.
  // Confere com uma frase de teste: se o mapa do .json não bater com o embutido, usa o do .json.
  const map = config.phoneme_id_map;
  if (map && Object.keys(map).length) {
    const probe = await phonemize('ação coração pão ninguém xícara chá jóia lhe nhoque rato carro sol fim', voice.espeak);
    const rebuilt = idsFromPhonemes(probe.phonemes || [], map);
    voice.remap = rebuilt.length !== probe.phoneme_ids.length || rebuilt.some((v, i) => v !== probe.phoneme_ids[i]);
  }
}

/** Layout do Piper: início (^), pausa (_), [fonema, pausa]..., fim ($). */
function idsFromPhonemes(phonemes, map) {
  const one = (k, d) => (map[k] && map[k].length ? map[k] : [d]);
  const pad = one('_', 0);
  const ids = [...one('^', 1), ...pad];
  for (const p of phonemes) {
    const v = map[p];
    if (!v) continue;
    ids.push(...v, ...pad);
  }
  ids.push(...one('$', 2));
  return ids;
}

/* --------------------------- Texto -> fonemas --------------------------- */

async function phonemize(text, espeakVoice) {
  for (let attempt = 0; attempt < 2; attempt++) {
    lastOutput = null;
    try {
      phonemizer.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
      if (lastOutput) {
        const out = JSON.parse(lastOutput);
        return { phonemes: out.phonemes || [], phoneme_ids: out.phoneme_ids || [] };
      }
    } catch (err) {
      /* recria o módulo e tenta de novo */
    }
    phonemizer = await createPhonemizer();
  }
  throw new Error('Falha ao converter o texto em fonemas.');
}

/* --------------------------- Frases e pausas --------------------------- */

const MAX_CHUNK = 380;

function cleanText(s) {
  return s
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[_*#~^|<>{}\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLong(sentence) {
  if (sentence.length <= MAX_CHUNK) return [sentence];
  const out = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK) {
    let cut = Math.max(rest.lastIndexOf(', ', MAX_CHUNK), rest.lastIndexOf('; ', MAX_CHUNK), rest.lastIndexOf(': ', MAX_CHUNK));
    if (cut < MAX_CHUNK * 0.4) cut = rest.lastIndexOf(' ', MAX_CHUNK);
    if (cut <= 0) cut = MAX_CHUNK;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Divide parágrafos em trechos curtos (frases agrupadas), com a pausa após cada um. */
function toChunks(paragraphs) {
  const chunks = [];
  paragraphs.forEach((p, pi) => {
    const text = cleanText(p);
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    const sentences = text.split(/(?<=[.!?…»”"])\s+(?=[\p{Lu}\p{N}«“"—–(-])/u).flatMap(splitLong);
    let buf = '';
    const push = (last) => {
      if (buf) chunks.push({ text: buf, pause: last ? (pi === 0 ? 0.9 : 0.6) : 0.22 });
      buf = '';
    };
    sentences.forEach((s, i) => {
      if (buf && buf.length + s.length + 1 > MAX_CHUNK) push(false);
      buf = buf ? `${buf} ${s}` : s;
      if (i === sentences.length - 1) push(true);
    });
  });
  return chunks;
}

/* ------------------------------ Síntese ------------------------------ */

async function synthesize({ id, paragraphs, lengthScale = 1 }) {
  if (!session || !voice) throw new Error('Voz não carregada.');
  const cfg = voice.config || {};
  const sampleRate = (cfg.audio && cfg.audio.sample_rate) || 22050;
  const espeakVoice = voice.espeak;
  const inf = cfg.inference || {};
  const scales = Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) * lengthScale, inf.noise_w ?? 0.8]);
  const multiSpeaker = (cfg.num_speakers || 0) > 1;

  const chunks = toChunks(paragraphs);
  const totalChars = chunks.reduce((s, c) => s + c.text.length, 0) || 1;
  const kbps = sampleRate >= 22050 ? 48 : 32;
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const parts = [];
  let samples = 0;
  let doneChars = 0;
  let lastPost = 0;

  const encode = (int16) => {
    for (let i = 0; i < int16.length; i += 11520) {
      const out = encoder.encodeBuffer(int16.subarray(i, i + 11520));
      if (out.length) parts.push(new Uint8Array(out));
    }
    samples += int16.length;
  };

  for (const chunk of chunks) {
    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ id, type: 'cancelled' });
      return null;
    }
    const ph = await phonemize(chunk.text, espeakVoice);
    const ids = voice.remap ? idsFromPhonemes(ph.phonemes, cfg.phoneme_id_map) : ph.phoneme_ids;
    if (ids.length > 2) {
      const inputs = session.inputNames;
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      };
      if (inputs.includes('scales')) feeds.scales = new ort.Tensor('float32', scales, [3]);
      if (inputs.includes('sid') || multiSpeaker) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      const out = await session.run(feeds);
      const pcm = out[session.outputNames[0]].data;
      const int16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const v = Math.max(-1, Math.min(1, pcm[i] * 0.95));
        int16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      encode(int16);
    }
    encode(new Int16Array(Math.round(chunk.pause * sampleRate)));
    doneChars += chunk.text.length;
    const now = Date.now();
    if (now - lastPost > 400) {
      lastPost = now;
      post({ id, type: 'progress', done: doneChars, total: totalChars, seconds: samples / sampleRate });
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  const blob = new Blob(parts, { type: 'audio/mpeg' });
  return { blob, duration: samples / sampleRate, sampleRate, chars: totalChars };
}
