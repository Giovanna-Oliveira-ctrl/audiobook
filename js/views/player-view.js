/* Player completo (sobreposição) e mini player. Ambos são criados uma única vez e
 * apenas atualizados — por isso a navegação nunca interrompe a reprodução. */

import { h, iconButton, actionSheet, toast } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { back, navigate } from '../router.js';
import { coverEl, emptyState } from '../components.js';
import { openSpeedSheet, openSleepSheet, openChaptersSheet, openBookmarksSheet, quickBookmark, openAddToPlaylistSheet, fmtRate } from '../sheets.js';
import { formatTime, formatDuration, clamp } from '../utils.js';

/* ------------------------------------------------------------------ */
/* Barra de busca (seek) compartilhada                                  */
/* ------------------------------------------------------------------ */

function seekBar(className, onPreview) {
  let dragging = false;
  const input = h('input', {
    type: 'range', class: `seek ${className}`, min: '0', max: '1', step: 'any', value: '0',
    'aria-label': 'Posição no capítulo',
  });
  const setFill = () => {
    const max = Number(input.max) || 1;
    input.style.setProperty('--pct', `${(Number(input.value) / max) * 100}%`);
  };
  input.addEventListener('input', () => {
    dragging = true;
    setFill();
    onPreview?.(Number(input.value));
  });
  input.addEventListener('change', () => {
    player.seek(Number(input.value));
    dragging = false;
  });
  input.addEventListener('pointerup', () => setTimeout(() => (dragging = false), 50));
  return {
    el: input,
    update(pos, dur) {
      if (dragging) return;
      input.max = String(dur > 0 ? dur : 1);
      input.value = String(clamp(pos, 0, dur || 0));
      input.disabled = !(dur > 0);
      input.setAttribute('aria-valuetext', `${formatTime(pos)} de ${formatTime(dur)}`);
      setFill();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Player completo                                                      */
/* ------------------------------------------------------------------ */

const playerEl = () => document.getElementById('player');
let refs = null;
let renderedBookId = null;

export function initPlayerView() {
  const el = playerEl();
  const times = { cur: h('span', { class: 'time-cur' }, '0:00'), rem: h('span', { class: 'time-rem' }, '-0:00') };
  const seek = seekBar('seek--lg', (v) => {
    times.cur.textContent = formatTime(v);
    times.rem.textContent = `-${formatTime(Math.max(0, player.chapterDuration() - v))}`;
  });
  const playBtn = h('button', { type: 'button', class: 'ctrl ctrl--play', 'aria-label': 'Reproduzir', onClick: () => player.toggle() },
    icon('play', 34), icon('pause', 34), h('span', { class: 'spinner spinner--btn', 'aria-hidden': 'true' }));
  const ctrl = (name, label, fn, cls = '') => h('button', { type: 'button', class: `ctrl ${cls}`, 'aria-label': label, title: label, onClick: fn }, icon(name, cls.includes('skip') ? 30 : 26));
  const pill = (ic, label, fn) => {
    const text = h('span', { class: 'pill-text' }, label);
    const b = h('button', { type: 'button', class: 'pill', onClick: fn }, icon(ic, 20), text);
    b.text = text;
    return b;
  };
  const speedPill = pill('speed', '1x', openSpeedSheet);
  const sleepPill = pill('moon', 'Timer', openSleepSheet);
  const markPill = pill('bookmarkPlus', 'Marcar', () => quickBookmark());
  const chaptersPill = pill('chapters', 'Capítulos', openChaptersSheet);
  const favBtn = h('button', { type: 'button', class: 'icon-btn fav-btn', 'aria-label': 'Favorito', onClick: async () => {
    if (!player.book) return;
    const b = await repo.toggleFavorite(player.book.id);
    toast(b.favorite ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
  } }, icon('heart', 24), icon('heartFill', 24));

  refs = {
    art: h('div', { class: 'player-art' }),
    eyebrow: h('p', { class: 'player-eyebrow' }),
    title: h('h2', { class: 'player-title' }),
    author: h('p', { class: 'player-author' }),
    chapter: h('p', { class: 'player-chapter' }),
    bookInfo: h('p', { class: 'player-book-info' }),
    seek, times, playBtn, speedPill, sleepPill, markPill, chaptersPill, favBtn,
  };

  const top = h('header', { class: 'player-top' },
    iconButton('chevronDown', 'Fechar player', () => closePlayerRoute(), { className: 'player-close', size: 26 }),
    h('div', { class: 'player-top-title' }, refs.eyebrow),
    iconButton('more', 'Mais opções', () => moreMenu(), { size: 24 }));

  const body = h('div', { class: 'player-main' },
    refs.art,
    h('div', { class: 'player-panel' },
      h('div', { class: 'player-heading' },
        h('div', { class: 'player-titles' }, refs.title, refs.author, refs.chapter),
        favBtn),
      h('div', { class: 'player-seek' }, seek.el, h('div', { class: 'times' }, times.cur, times.rem)),
      refs.bookInfo,
      h('div', { class: 'player-controls' },
        ctrl('prev', 'Capítulo anterior', () => player.prevChapter()),
        ctrl('back15', 'Voltar 15 segundos', () => player.skip(-(state.settings.skipBack || 15)), 'ctrl--skip'),
        playBtn,
        ctrl('fwd30', 'Avançar 30 segundos', () => player.skip(state.settings.skipForward || 30), 'ctrl--skip'),
        ctrl('next', 'Próximo capítulo', () => player.nextChapter())),
      h('div', { class: 'player-pills' }, speedPill, sleepPill, markPill, chaptersPill)));

  const empty = h('div', { class: 'player-empty' }, emptyState({
    icon: 'headphones', title: 'Nada tocando agora', text: 'Escolha um audiolivro na biblioteca para começar.',
    actions: [h('button', { type: 'button', class: 'btn btn--primary', onClick: () => leavePlayerTo('/biblioteca') }, 'Abrir biblioteca')],
  }));

  el.replaceChildren(h('div', { class: 'player-bg', 'aria-hidden': 'true' }), h('div', { class: 'player-inner' }, top, body, empty));
  enableSwipeDown(el, top, refs.art);

  bus.on('player:book', () => renderPlayer(true));
  bus.on('player:chapter', () => renderPlayer());
  bus.on('player:state', () => renderPlayer());
  bus.on('player:rate', () => renderPlayer());
  bus.on('player:sleep', (s) => updateSleep(s));
  bus.on('player:time', (s) => updateTime(s));
  bus.on('library', () => renderPlayer(true));
  renderPlayer(true);
}

function updateTime(s) {
  if (!refs || !s.book) return;
  refs.seek.update(s.position, s.duration);
  refs.times.cur.textContent = formatTime(s.position);
  refs.times.rem.textContent = `-${formatTime(Math.max(0, s.duration - s.position))}`;
  const left = Math.max(0, s.bookDuration - s.bookPosition);
  const pct = s.bookDuration ? Math.round((s.bookPosition / s.bookDuration) * 100) : 0;
  refs.bookInfo.textContent = `Livro: ${pct}% · restam ${formatDuration(left)}${s.rate !== 1 ? ` (≈ ${formatDuration(left / s.rate)} a ${fmtRate(s.rate)})` : ''}`;
}

function updateSleep(s) {
  if (!refs) return;
  refs.sleepPill.classList.toggle('is-active', !!s.active);
  refs.sleepPill.text.textContent = !s.active ? 'Timer' : s.mode === 'chapter' ? 'Fim do cap.' : formatTime(Math.ceil(s.remainingMs / 1000));
  const mini = document.querySelector('.mini-sleep');
  if (mini) {
    mini.classList.toggle('is-active', !!s.active);
    mini.querySelector('.pill-text').textContent = !s.active ? '' : s.mode === 'chapter' ? 'cap.' : formatTime(Math.ceil(s.remainingMs / 1000));
  }
}

function renderPlayer(full = false) {
  if (!refs) return;
  const s = player.snapshot();
  const el = playerEl();
  el.classList.toggle('is-empty', !s.book);
  if (!s.book) {
    renderedBookId = null;
    return;
  }
  const book = s.book;
  if (full || renderedBookId !== book.id) {
    renderedBookId = book.id;
    refs.art.replaceChildren(coverEl(book, { size: 'hero' }));
    el.style.setProperty('--tint', book.coverColor || 'var(--accent)');
  }
  refs.eyebrow.textContent = player.playlist ? `Playlist · ${state.playlists.get(player.playlist.id)?.name || ''}` : 'Tocando agora';
  refs.title.textContent = book.title;
  refs.author.textContent = [book.author || 'Autor desconhecido', book.narrator && `narração de ${book.narrator}`].filter(Boolean).join(' · ');
  refs.chapter.textContent = s.chapter ? `Capítulo ${s.index + 1} de ${s.count} · ${s.chapter.title}` : '';
  refs.favBtn.classList.toggle('is-fav', !!book.favorite);
  refs.favBtn.setAttribute('aria-pressed', String(!!book.favorite));
  refs.favBtn.setAttribute('aria-label', book.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
  const active = player.isActive();
  refs.playBtn.classList.toggle('is-playing', active);
  refs.playBtn.classList.toggle('is-buffering', !!s.buffering);
  refs.playBtn.setAttribute('aria-label', active ? 'Pausar' : 'Reproduzir');
  refs.speedPill.text.textContent = fmtRate(s.rate);
  refs.speedPill.classList.toggle('is-active', s.rate !== 1);
  updateSleep(s.sleep);
  updateTime(s);
}

function moreMenu() {
  const b = player.book;
  if (!b) return;
  actionSheet({
    title: b.title,
    actions: [
      { label: 'Ver detalhes do livro', icon: 'info', onSelect: () => leavePlayerTo(`/livro/${encodeURIComponent(b.id)}`) },
      { label: 'Capítulos', icon: 'chapters', onSelect: openChaptersSheet },
      { label: 'Marcadores', icon: 'bookmark', onSelect: openBookmarksSheet },
      { label: 'Adicionar à playlist', icon: 'playlist', onSelect: () => openAddToPlaylistSheet(b.id) },
      { label: 'Velocidade', icon: 'speed', onSelect: openSpeedSheet },
      { label: 'Temporizador', icon: 'moon', onSelect: openSleepSheet },
    ],
  });
}

/** Arrastar para baixo fecha o player (celular). */
function enableSwipeDown(el, ...handles) {
  const inner = el.querySelector('.player-inner');
  let startY = null, dy = 0;
  for (const hnd of handles) {
    hnd.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      startY = e.clientY;
      dy = 0;
    });
    hnd.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      if (dy > 6) {
        inner.style.transition = 'none';
        inner.style.transform = `translateY(${dy}px)`;
      }
    });
    const end = () => {
      if (startY == null) return;
      startY = null;
      inner.style.transition = '';
      inner.style.transform = '';
      if (dy > 110) closePlayerRoute();
    };
    hnd.addEventListener('pointerup', end);
    hnd.addEventListener('pointercancel', end);
  }
}

export function openPlayer() {
  const el = playerEl();
  if (!el.hidden && el.classList.contains('open')) return;
  el.hidden = false;
  document.body.classList.add('player-open');
  renderPlayer(true);
  requestAnimationFrame(() => {
    el.classList.add('open');
    el.querySelector('.player-close')?.focus({ preventScroll: true });
  });
}

export function closePlayer() {
  const el = playerEl();
  if (el.hidden) return;
  el.classList.remove('open');
  document.body.classList.remove('player-open');
  setTimeout(() => {
    if (!el.classList.contains('open')) el.hidden = true;
  }, 320);
}

export const isPlayerOpen = () => !playerEl().hidden && playerEl().classList.contains('open');

/** Sai do player para outra tela substituindo a entrada #/player do histórico. */
export function leavePlayerTo(path) {
  const onPlayerRoute = location.hash.startsWith('#/player');
  if (!onPlayerRoute) closePlayer();
  navigate(path, { replace: onPlayerRoute });
}

function closePlayerRoute() {
  if (location.hash.startsWith('#/player')) back('/inicio');
  else closePlayer();
}

/* ------------------------------------------------------------------ */
/* Mini player                                                          */
/* ------------------------------------------------------------------ */

let mini = null;
let miniBookId = null;

export function initMiniPlayer() {
  const el = document.getElementById('mini-player');
  const seek = seekBar('seek--mini');
  const playBtn = h('button', { type: 'button', class: 'mini-play', 'aria-label': 'Reproduzir', onClick: (e) => { e.stopPropagation(); player.toggle(); } },
    icon('play', 26), icon('pause', 26), h('span', { class: 'spinner spinner--btn', 'aria-hidden': 'true' }));
  const btn = (name, label, fn, cls = '') => h('button', { type: 'button', class: `mini-btn ${cls}`, 'aria-label': label, title: label, onClick: (e) => { e.stopPropagation(); fn(); } }, icon(name, 22));
  const speed = h('button', { type: 'button', class: 'mini-btn mini-speed desktop-only', 'aria-label': 'Velocidade', title: 'Velocidade', onClick: openSpeedSheet }, h('span', { class: 'pill-text' }, '1x'));
  const sleep = h('button', { type: 'button', class: 'mini-btn mini-sleep desktop-only', 'aria-label': 'Temporizador', title: 'Temporizador', onClick: openSleepSheet }, icon('moon', 20), h('span', { class: 'pill-text' }, ''));

  mini = {
    el,
    cover: h('div', { class: 'mini-cover' }),
    title: h('span', { class: 'mini-title' }),
    sub: h('span', { class: 'mini-sub' }),
    bar: h('span', {}),
    time: h('span', { class: 'mini-time desktop-only' }),
    seek, playBtn, speed,
  };

  const open = h('button', { type: 'button', class: 'mini-open', 'aria-label': 'Abrir player completo', onClick: () => navigate('/player') },
    mini.cover, h('span', { class: 'mini-text' }, mini.title, mini.sub));

  el.replaceChildren(h('div', { class: 'mini-inner' },
    h('div', { class: 'mini-progress', 'aria-hidden': 'true' }, mini.bar),
    open,
    h('div', { class: 'mini-center' },
      h('div', { class: 'mini-controls' },
        btn('prev', 'Capítulo anterior', () => player.prevChapter(), 'desktop-only'),
        btn('back15', 'Voltar 15 segundos', () => player.skip(-(state.settings.skipBack || 15)), 'desktop-only'),
        playBtn,
        btn('fwd30', 'Avançar 30 segundos', () => player.skip(state.settings.skipForward || 30), 'desktop-only'),
        btn('next', 'Próximo capítulo', () => player.nextChapter(), 'desktop-only')),
      h('div', { class: 'mini-seek desktop-only' }, seek.el, mini.time)),
    h('div', { class: 'mini-right' },
      speed, sleep,
      btn('chapters', 'Capítulos', openChaptersSheet, 'desktop-only'),
      btn('chevronUp', 'Abrir player completo', () => navigate('/player'), 'mini-expand'))));

  const update = (full) => {
    const s = player.snapshot();
    const show = !!s.book;
    el.hidden = !show;
    document.body.classList.toggle('has-mini', show);
    if (!show) {
      miniBookId = null;
      return;
    }
    if (full || miniBookId !== s.book.id) {
      miniBookId = s.book.id;
      mini.cover.replaceChildren(coverEl(s.book, { size: 'xs' }));
    }
    mini.title.textContent = s.book.title;
    mini.sub.textContent = s.chapter ? `Cap. ${s.index + 1} · ${s.chapter.title}` : '';
    const active = player.isActive();
    playBtn.classList.toggle('is-playing', active);
    playBtn.classList.toggle('is-buffering', !!s.buffering);
    playBtn.setAttribute('aria-label', active ? 'Pausar' : 'Reproduzir');
    speed.querySelector('.pill-text').textContent = fmtRate(s.rate);
    updateMiniTime(s);
  };
  bus.on('player:book', () => update(true));
  bus.on('player:state', () => update());
  bus.on('player:chapter', () => update());
  bus.on('player:rate', () => update());
  bus.on('player:time', (s) => updateMiniTime(s));
  bus.on('library', () => update(true));
  update(true);
}

function updateMiniTime(s) {
  if (!mini || !s.book) return;
  const pct = s.duration > 0 ? (s.position / s.duration) * 100 : 0;
  mini.bar.style.width = `${clamp(pct, 0, 100)}%`;
  mini.seek.update(s.position, s.duration);
  mini.time.textContent = `${formatTime(s.position)} / ${formatTime(s.duration)}`;
}
