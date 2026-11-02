/* AUDIOBOOK — ponto de entrada. */

import { state, bus } from './state.js';
import { openDB } from './db.js';
import * as repo from './repo.js';
import { player } from './player.js';
import { route, startRouter, navigate } from './router.js';
import { h, toast, dismissAllModals, hasOpenModal } from './ui.js';
import { icon } from './icons.js';
import { applyTheme } from './theme.js';
import { registerServiceWorker, initInstallPrompt, initLaunchQueue } from './pwa.js';
import { syncProgressBars, syncPlayingIndicators, syncChapterLists } from './components.js';
import { initPlayerView, initMiniPlayer, openPlayer, closePlayer } from './views/player-view.js';
import { quickBookmark } from './sheets.js';
import { SPEEDS } from './state.js';

import home from './views/home.js';
import library from './views/library.js';
import details from './views/details.js';
import importView from './views/import.js';
import favorites from './views/favorites.js';
import historyView from './views/history.js';
import settings from './views/settings.js';
import storageView from './views/storage.js';
import statsView from './views/stats.js';
import installView from './views/install.js';
import playlistView from './views/playlists.js';
import convertView, { conversionsView } from './views/convert.js';
import { loadConversions } from './conversion.js';

route('/inicio', home, { nav: 'inicio' });
route('/biblioteca', library, { nav: 'biblioteca' });
route('/playlists', (root) => navigate('/biblioteca?aba=playlists', { replace: true }), { nav: 'biblioteca' });
route('/playlist/:id', playlistView, { nav: 'biblioteca' });
route('/livro/:id', details, { nav: 'biblioteca' });
route('/importar', importView, { nav: 'importar' });
route('/editar/:id', importView, { nav: 'biblioteca' });
route('/favoritos', favorites, { nav: 'favoritos' });
route('/historico', historyView, { nav: 'historico' });
route('/configuracoes', settings, { nav: 'configuracoes' });
route('/armazenamento', storageView, { nav: 'configuracoes' });
route('/estatisticas', statsView, { nav: 'estatisticas' });
route('/instalar', installView, { nav: 'configuracoes' });
route('/converter', convertView, { nav: 'converter' });
route('/conversoes', conversionsView, { nav: 'converter' });
route('/player', () => {}, { nav: 'player' });

const viewEl = document.getElementById('view');
let cleanup = null;
let currentKey = null;

function setNav(name) {
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function renderRoute(r, params, query, key, scrollY) {
  try {
    cleanup?.();
  } catch (err) {
    console.error(err);
  }
  cleanup = null;
  currentKey = key;
  viewEl.classList.remove('view-enter');
  viewEl.replaceChildren();
  void viewEl.offsetWidth; // reinicia a animação de entrada
  viewEl.classList.add('view-enter');
  try {
    cleanup = r.view(viewEl, { params, query }) || null;
  } catch (err) {
    console.error(err);
    viewEl.replaceChildren(h('div', { class: 'page' }, h('p', {}, 'Ocorreu um erro ao abrir esta tela.')));
  }
  setNav(r.meta.nav);
  requestAnimationFrame(() => window.scrollTo(0, scrollY || 0));
  syncPlayingIndicators();
}

function onRoute({ path, query, route: r, params, scrollY, raw }) {
  dismissAllModals();
  if (path === '/player') {
    if (!currentKey) {
      const homeRoute = { view: home, meta: { nav: 'inicio' } };
      renderRoute(homeRoute, {}, {}, '/inicio', 0);
    }
    openPlayer();
    return;
  }
  closePlayer();
  if (raw === currentKey) return; // voltando do player para a mesma tela: mantém estado e rolagem
  renderRoute(r, params, query, raw, scrollY);
}

function fatal(err) {
  console.error(err);
  document.getElementById('view').replaceChildren(
    h('div', { class: 'page fatal' },
      h('div', { class: 'empty-state' },
        h('div', { class: 'empty-icon' }, icon('alert', 34)),
        h('h2', {}, 'Armazenamento local indisponível'),
        h('p', {}, 'O AUDIOBOOK precisa do IndexedDB para guardar seus audiolivros no dispositivo. Ele pode estar bloqueado em janelas privativas/anônimas ou por configurações do navegador. Abra o app numa janela normal.'),
        h('p', { class: 'muted small' }, String(err?.message || err)))),
  );
}

function initGlobalSync() {
  bus.on('toast', ({ message, tone }) => toast(message, { tone }));
  bus.on('progress', (bookId) => syncProgressBars(bookId));
  bus.on('library', (e) => e?.id && syncProgressBars(e.id));
  for (const e of ['player:state', 'player:book']) bus.on(e, () => {
    syncPlayingIndicators();
    syncChapterLists();
  });
  bus.on('player:chapter', () => syncChapterLists());
  bus.on('app:before-reload', () => player.save({ force: true }));
}

function initConnectivity() {
  const update = () => {
    const off = !navigator.onLine;
    document.body.classList.toggle('is-offline', off);
    const el = document.getElementById('net-status');
    if (el) el.textContent = off ? 'Offline — tudo funcionando' : 'Biblioteca salva no dispositivo';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', () => {
    update();
    toast('Você está offline. Sua biblioteca continua disponível.');
  });
  update();
}

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || hasOpenModal()) return;
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (!player.book) return;
    const key = e.key;
    if ((key === ' ' && !t.closest('button, a')) || key === 'k') {
      e.preventDefault();
      player.toggle();
    } else if (key === 'ArrowLeft' && e.shiftKey) player.prevChapter();
    else if (key === 'ArrowRight' && e.shiftKey) player.nextChapter();
    else if (key === 'ArrowLeft' || key === 'j') player.skip(-(state.settings.skipBack || 15));
    else if (key === 'ArrowRight' || key === 'l') player.skip(state.settings.skipForward || 30);
    else if (key === '>' || key === '.') {
      const i = SPEEDS.indexOf(player.rate);
      player.setRate(SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + 1)]);
      toast(`Velocidade ${String(player.rate).replace('.', ',')}x`);
    } else if (key === '<' || key === ',') {
      const i = SPEEDS.indexOf(player.rate);
      player.setRate(SPEEDS[Math.max(0, (i < 0 ? 2 : i) - 1)]);
      toast(`Velocidade ${String(player.rate).replace('.', ',')}x`);
    } else if (key === 'b') quickBookmark();
    else if (key === 'f') location.hash.startsWith('#/player') ? history.back() : navigate('/player');
    else return;
  });
}

async function boot() {
  try {
    applyTheme(localStorage.getItem('audiobook:theme') || 'auto');
  } catch {
    applyTheme('auto');
  }
  try {
    await openDB();
    await repo.loadAll();
  } catch (err) {
    fatal(err);
    return;
  }
  applyTheme(state.settings.theme);
  bus.on('settings', (s) => applyTheme(s.theme));

  player.init(document.getElementById('audio'));
  initGlobalSync();
  initPlayerView();
  initMiniPlayer();
  initConnectivity();
  initShortcuts();
  initInstallPrompt();
  initLaunchQueue((files) => {
    state.pendingImportFiles = files;
    navigate(`/importar?t=${Date.now()}`);
  });

  // Ponto de inspeção para depuração e testes automatizados (DevTools: AUDIOBOOK.player.snapshot()).
  window.AUDIOBOOK = { player, state, repo };

  await player.restore().catch((err) => console.warn('[app] restaurar sessão', err));
  startRouter(onRoute);
  document.body.classList.add('ready');
  registerServiceWorker();
  loadConversions().catch((err) => console.warn('[app] conversões', err));
}

boot();
