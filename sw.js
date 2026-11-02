/* AUDIOBOOK — Service Worker
 *
 * Estratégia offline-first:
 *  - Instalação: pré-carrega TODA a interface (HTML, CSS, JS, ícones, manifest) num cache versionado.
 *  - Navegação: responde com o index.html do cache (o app abre sem internet).
 *  - Demais arquivos do app: cache primeiro, rede como alternativa.
 *  - Atualização: uma nova versão é instalada em paralelo e só assume quando o usuário
 *    toca em "Atualizar" (SKIP_WAITING). Caches antigos da interface são removidos na ativação.
 *
 * O áudio NÃO fica aqui: os audiolivros vivem no IndexedDB, que o Service Worker nunca apaga.
 * Assim, atualizar ou limpar o cache do app não afeta a biblioteca.
 *
 * As listas abaixo são geradas por `node tools/update-sw.mjs` (rode após editar arquivos).
 */

// @generated-start
const VERSION = '2026-11-02-499de565';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/player.css',
  './css/tokens.css',
  './css/views.css',
  './js/app.js',
  './js/audio-probe.js',
  './js/backup.js',
  './js/components.js',
  './js/conversion.js',
  './js/covers.js',
  './js/db.js',
  './js/demo.js',
  './js/ebook/parse.js',
  './js/ebook/zip.js',
  './js/icons.js',
  './js/metadata.js',
  './js/player.js',
  './js/pwa.js',
  './js/repo.js',
  './js/router.js',
  './js/sheets.js',
  './js/sortable.js',
  './js/state.js',
  './js/theme.js',
  './js/tts/engine.js',
  './js/tts/tts-worker.js',
  './js/ui.js',
  './js/utils.js',
  './js/views/convert.js',
  './js/views/details.js',
  './js/views/favorites.js',
  './js/views/history.js',
  './js/views/home.js',
  './js/views/import.js',
  './js/views/install.js',
  './js/views/library.js',
  './js/views/player-view.js',
  './js/views/playlists.js',
  './js/views/settings.js',
  './js/views/stats.js',
  './js/views/storage.js',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-32.png',
  './icons/icon-512.png',
  './icons/icon-96.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
];
// @generated-end

const SHELL_CACHE = `audiobook-shell-${VERSION}`;
const RUNTIME_CACHE = 'audiobook-runtime';
const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

async function fetchAll() {
  // Busca tudo antes de gravar: se algum arquivo falhar, nada é alterado.
  return Promise.all(
    ASSETS.map(async (path) => {
      const req = new Request(scoped(path), { cache: 'reload' });
      const res = await fetch(req);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return [req, res];
    }),
  );
}

async function precache() {
  const entries = await fetchAll();
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(entries.map(([req, res]) => cache.put(req, res)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('audiobook-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  const reply = (data) => event.ports?.[0]?.postMessage(data);
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'GET_VERSION') reply({ version: VERSION });
  else if (type === 'REBUILD_CACHE') {
    event.waitUntil(
      (async () => {
        try {
          // Baixa tudo primeiro; só então substitui. Offline => mantém o cache atual.
          const entries = await fetchAll();
          await caches.delete(RUNTIME_CACHE);
          const cache = await caches.open(SHELL_CACHE);
          for (const req of await cache.keys()) await cache.delete(req);
          await Promise.all(entries.map(([req, res]) => cache.put(req, res)));
          reply({ ok: true, version: VERSION });
        } catch (err) {
          reply({ ok: false, error: String(err?.message || err) });
        }
      })(),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Android: "Compartilhar > AUDIOBOOK" envia os arquivos via POST (Web Share Target).
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return; // mídia por streaming nunca passa por aqui (usamos blob: URLs)

  if (req.mode === 'navigate') {
    event.respondWith(appShell(req));
    return;
  }
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(engineFile(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});

async function appShell(req) {
  const cached = await caches.match(scoped('./index.html'), { cacheName: SHELL_CACHE });
  if (cached) return cached;
  try {
    return await fetch(req);
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AUDIOBOOK</title><body style="font-family:system-ui;padding:32px;background:#11100e;color:#ece6dc"><h1>Sem conexão</h1><p>Abra o app uma vez com internet para que ele seja instalado para uso offline.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

async function cacheFirst(req) {
  const hit = (await caches.match(req, { cacheName: SHELL_CACHE, ignoreSearch: true })) || (await caches.match(req, { cacheName: RUNTIME_CACHE }));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* Motor de voz e leitor de PDF (pasta vendor/): baixados sob demanda e guardados num cache
 * próprio, separado da interface — atualizações do app não os apagam. */
const ENGINE_CACHE = 'audiobook-engine-v1';
async function engineFile(req) {
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}

/* ---------------- Web Share Target ---------------- */

function inboxDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('audiobook-inbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('audio').filter((f) => f && typeof f === 'object');
    const db = await inboxDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      for (const f of files) store.add({ file: f, name: f.name, type: f.type, at: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error('[sw] share target', err);
  }
  return Response.redirect(scoped('./#/importar?compartilhado=1'), 303);
}
