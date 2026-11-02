/* Integração PWA: Service Worker, atualização, instalação, armazenamento persistente
 * e arquivos recebidos pelo sistema (Compartilhar / Abrir com). */

import { state, bus } from './state.js';
import { toast } from './ui.js';

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;

export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const firefox = /Firefox|FxiOS/i.test(ua);
  const edge = /Edg\//i.test(ua);
  const samsung = /SamsungBrowser/i.test(ua);
  const chrome = /Chrome|CriOS/i.test(ua) && !edge && !samsung;
  const safari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\//i.test(ua);
  const mac = /Macintosh/i.test(ua) && !iOS;
  return { iOS, android, firefox, edge, samsung, chrome, safari, mac, desktop: !iOS && !android };
}

let userRequestedUpdate = false;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    console.warn('[pwa] Service Worker requer HTTPS (ou localhost).');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    state.swRegistration = reg;

    const announce = (worker) => {
      bus.emit('sw:update', worker);
      toast('Nova versão do app disponível. Sua biblioteca não será afetada.', {
        duration: 20000,
        action: { label: 'Atualizar', onClick: () => applyUpdate(worker) },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (userRequestedUpdate) location.reload();
    });
    // Verifica atualizações ao voltar ao app (apenas quando online).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    });
    return reg;
  } catch (err) {
    console.error('[pwa] falha ao registrar Service Worker', err);
    return null;
  }
}

export function applyUpdate(worker = state.swRegistration?.waiting) {
  if (!worker) return;
  userRequestedUpdate = true;
  bus.emit('app:before-reload');
  worker.postMessage({ type: 'SKIP_WAITING' });
}

export async function checkForUpdate() {
  const reg = state.swRegistration;
  if (!reg) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  await reg.update();
  if (reg.waiting || reg.installing) return 'available';
  return 'current';
}

/** Envia mensagem ao Service Worker e aguarda a resposta. */
export function swMessage(msg, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const ctrl = navigator.serviceWorker?.controller;
    if (!ctrl) return reject(new Error('O Service Worker ainda não está ativo. Recarregue o app.'));
    const ch = new MessageChannel();
    const t = setTimeout(() => reject(new Error('Tempo esgotado')), timeout);
    ch.port1.onmessage = (e) => {
      clearTimeout(t);
      resolve(e.data);
    };
    ctrl.postMessage(msg, [ch.port2]);
  });
}

export async function appVersion() {
  try {
    return (await swMessage({ type: 'GET_VERSION' }, 3000)).version;
  } catch {
    return null;
  }
}

/* --------------------------- Instalação --------------------------- */

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    bus.emit('install:available');
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    toast('AUDIOBOOK instalado! Abra pelo ícone na tela inicial.', { tone: 'success' });
    bus.emit('install:done');
  });
}

export async function promptInstall() {
  const e = state.installPrompt;
  if (!e) return false;
  e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  state.installPrompt = null;
  bus.emit('install:done');
  return choice.outcome === 'accepted';
}

/* ------------------------ Armazenamento ------------------------ */

export async function storageEstimate() {
  try {
    return navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch {
    return null;
  }
}

export async function isPersisted() {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

let persistAsked = false;
/** Solicita armazenamento persistente (o navegador não apagará dados sob pressão de espaço). */
export async function requestPersistence({ force = false } = {}) {
  if (!navigator.storage?.persist) return null;
  if (persistAsked && !force) return null;
  persistAsked = true;
  try {
    if (await navigator.storage.persisted()) return true;
    const ok = await navigator.storage.persist();
    bus.emit('storage:persist', ok);
    return ok;
  } catch {
    return null;
  }
}

export async function appCacheInfo() {
  if (!('caches' in self)) return null;
  let bytes = 0, files = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith('audiobook-') || /engine|voices/.test(name)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const len = Number(res.headers.get('content-length'));
      bytes += Number.isFinite(len) && len > 0 ? len : (await res.clone().blob()).size;
      files++;
    }
  }
  return { bytes, files };
}

/* ---------------- Arquivos recebidos (share target) ---------------- */

function inboxDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('audiobook-inbox', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Lê e remove os arquivos que o Service Worker recebeu via "Compartilhar". */
export async function takeInboxFiles() {
  try {
    const db = await inboxDB();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const req = store.getAll();
      req.onsuccess = () => {
        store.clear();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return rows.map((r) => (r.file instanceof File ? r.file : new File([r.file], r.name || 'audio', { type: r.type || '' })));
  } catch (err) {
    console.warn('[pwa] inbox', err);
    return [];
  }
}

/** "Abrir com" (File Handling API — Chrome/Edge no computador, app instalado). */
export function initLaunchQueue(onFiles) {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((fh) => fh.getFile()));
    onFiles(files);
  });
}
