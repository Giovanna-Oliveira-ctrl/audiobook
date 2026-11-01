/* Componentes reutilizáveis de interface. */

import { h, iconButton } from './ui.js';
import { icon } from './icons.js';
import { state } from './state.js';
import { cachedCoverURL, loadCoverURL, palette } from './covers.js';
import { clamp, formatDuration, formatTime } from './utils.js';
import { player } from './player.js';

const initials = (t = '') =>
  t.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪';

export function coverEl(book, { size = 'md', className = '' } = {}) {
  const pal = palette((book.title || '') + (book.author || ''));
  const el = h(
    'div',
    { class: `cover cover--${size} ${className}`, style: { '--c1': pal.a, '--c2': pal.b, '--ink': pal.ink } },
    h('div', { class: 'cover-fallback', 'aria-hidden': 'true' }, h('span', {}, initials(book.title))),
  );
  const img = h('img', { alt: '', decoding: 'async', draggable: 'false' });
  const show = (url) => {
    if (!url) return;
    img.onload = () => el.classList.add('has-img');
    img.src = url;
    el.append(img);
  };
  const cached = cachedCoverURL(book.id);
  if (cached) {
    el.classList.add('has-img');
    img.src = cached;
    el.append(img);
  } else loadCoverURL(book.id).then(show);
  return el;
}

/** Progresso consolidado de um livro (para cartões e listas). */
export function bookProgress(book) {
  const p = state.progress.get(book.id);
  const total = book.totalDuration || 0;
  const pos = p?.bookPosition || 0;
  const remaining = Math.max(0, total - pos);
  if (book.finished) return { fraction: 1, status: 'done', label: 'Concluído', remaining: 0, position: pos };
  if (!p || (pos < 1 && !(p.listened > 0))) return { fraction: 0, status: 'new', label: 'Não iniciado', remaining: total, position: 0 };
  const fraction = total ? clamp(pos / total, 0, 1) : 0;
  return {
    fraction,
    status: 'progress',
    label: `${Math.round(fraction * 100)}% · ${formatDuration(remaining)} restantes`,
    remaining,
    position: pos,
  };
}

export function progressBar(book, { showLabel = false, className = '' } = {}) {
  const p = bookProgress(book);
  return h(
    'div',
    { class: `book-progress ${className}`, 'data-progress-book': book.id, 'data-status': p.status },
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Progresso', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p.fraction * 100)) },
      h('span', { style: { width: `${p.fraction * 100}%` } })),
    showLabel && h('span', { class: 'book-progress-label' }, p.label),
  );
}

/** Atualiza barras de progresso já renderizadas (sem re-renderizar a tela). */
export function syncProgressBars(bookId) {
  const book = state.books.get(bookId);
  if (!book) return;
  const p = bookProgress(book);
  for (const el of document.querySelectorAll(`[data-progress-book="${CSS.escape(bookId)}"]`)) {
    el.dataset.status = p.status;
    const span = el.querySelector('.bar > span');
    if (span) span.style.width = `${p.fraction * 100}%`;
    el.querySelector('.bar')?.setAttribute('aria-valuenow', String(Math.round(p.fraction * 100)));
    const label = el.querySelector('.book-progress-label');
    if (label) label.textContent = p.label;
  }
}

function statusBadge(book) {
  const p = bookProgress(book);
  if (p.status === 'done') return h('span', { class: 'badge badge--done', title: 'Concluído' }, icon('check', 14), 'Concluído');
  if (p.status === 'new') return h('span', { class: 'badge badge--new' }, 'Novo');
  return null;
}

/** true se este livro está carregado e tocando (para o estado inicial dos botões). */
export const isPlayingBook = (bookId) => player.book?.id === bookId && player.isActive();

export function playToggle(book, { className = 'play-fab' } = {}) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: `${className}${isPlayingBook(book.id) ? ' is-playing' : ''}`,
      'data-play-book': book.id,
      'aria-label': `Ouvir ${book.title}`,
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (player.book?.id === book.id && player.isActive()) player.pause();
        else player.playBook(book.id);
      },
    },
    icon('play', 20),
    icon('pause', 20),
  );
  return btn;
}

/** Marca nos elementos visíveis qual livro está carregado/tocando. */
export function syncPlayingIndicators() {
  const id = player.book?.id;
  const active = player.isActive();
  for (const el of document.querySelectorAll('[data-play-book]')) {
    const mine = el.dataset.playBook === id;
    el.classList.toggle('is-playing', mine && active);
    el.setAttribute('aria-label', `${mine && active ? 'Pausar' : 'Ouvir'} ${state.books.get(el.dataset.playBook)?.title || ''}`);
  }
  for (const el of document.querySelectorAll('[data-book-id]')) {
    el.classList.toggle('is-current', el.dataset.bookId === id);
  }
}

export function bookCard(book, { meta } = {}) {
  const href = `#/livro/${encodeURIComponent(book.id)}`;
  return h(
    'article',
    { class: `book-card${player.book?.id === book.id ? ' is-current' : ''}`, 'data-book-id': book.id },
    h('div', { class: 'book-card-cover' },
      h('a', { class: 'book-card-link', href, 'aria-label': `${book.title}${book.author ? ', de ' + book.author : ''}` },
        coverEl(book, { size: 'md' }), statusBadge(book), book.favorite && h('span', { class: 'fav-dot', title: 'Favorito' }, icon('heartFill', 14))),
      playToggle(book)),
    h('div', { class: 'book-card-body' },
      h('a', { class: 'book-card-title', href, tabindex: '-1' }, book.title),
      h('p', { class: 'book-card-author' }, meta || book.author || 'Autor desconhecido'),
      progressBar(book)),
  );
}

export function bookRow(book, { meta, actions } = {}) {
  return h(
    'article',
    { class: `book-row${player.book?.id === book.id ? ' is-current' : ''}`, 'data-book-id': book.id },
    h('a', { class: 'book-row-link', href: `#/livro/${encodeURIComponent(book.id)}` },
      coverEl(book, { size: 'sm' }),
      h('div', { class: 'book-row-body' },
        h('h3', { class: 'book-row-title' }, book.title),
        h('p', { class: 'book-row-author' }, [book.author || 'Autor desconhecido', book.narrator && `Narração: ${book.narrator}`].filter(Boolean).join(' · ')),
        meta ? h('p', { class: 'book-row-meta' }, meta) : h('p', { class: 'book-row-meta' }, [book.genre, formatDuration(book.totalDuration), `${book.chapterCount} cap.`].filter(Boolean).join(' · ')),
        progressBar(book, { showLabel: true }),
      )),
    h('div', { class: 'book-row-actions' }, actions, playToggle(book, { className: 'play-fab play-fab--inline' })),
  );
}

export function sectionHeader(title, { href, linkLabel = 'Ver tudo', count } = {}) {
  return h('div', { class: 'section-header' },
    h('h2', { class: 'section-title' }, title, count != null && h('span', { class: 'section-count' }, count)),
    href && h('a', { class: 'section-link', href }, linkLabel, icon('chevronRight', 18)));
}

export function shelf(title, books, { href, render = (b) => bookCard(b), empty } = {}) {
  if (!books.length && !empty) return null;
  return h('section', { class: 'shelf' },
    sectionHeader(title, { href }),
    books.length ? h('div', { class: 'shelf-track' }, books.map(render)) : h('p', { class: 'muted shelf-empty' }, empty));
}

export function emptyState({ icon: ic = 'bookOpen', title, text, actions }) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-icon' }, icon(ic, 34)),
    h('h2', {}, title),
    text && h('p', {}, text),
    actions && h('div', { class: 'empty-actions' }, actions));
}

export function pageHeader({ title, subtitle, back, actions, eyebrow }) {
  return h('header', { class: 'page-header' },
    back && iconButton('chevronLeft', 'Voltar', back, { className: 'back-btn' }),
    h('div', { class: 'page-header-text' },
      eyebrow && h('p', { class: 'eyebrow' }, eyebrow),
      h('h1', { class: 'page-title' }, title),
      subtitle && h('p', { class: 'page-subtitle' }, subtitle)),
    actions && h('div', { class: 'page-header-actions' }, actions));
}

export function chip(label, { active = false, onClick, count } = {}) {
  return h('button', { type: 'button', class: `chip ${active ? 'is-active' : ''}`, 'aria-pressed': String(active), onClick },
    label, count != null && h('span', { class: 'chip-count' }, count));
}

export function segmented(options, value, onChange, { label } = {}) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    options.map((o) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(o.value === value),
        class: o.value === value ? 'is-active' : '',
        onClick: () => onChange(o.value),
      }, o.icon && icon(o.icon, 18), h('span', {}, o.label))));
}

export function switchRow({ label, description, checked, onChange, icon: ic }) {
  const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
  return h('label', { class: 'setting-row switch-row', for: id },
    ic && h('span', { class: 'setting-icon' }, icon(ic, 20)),
    h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), description && h('span', { class: 'setting-desc' }, description)),
    h('input', { type: 'checkbox', role: 'switch', class: 'switch', id, checked, onChange: (e) => onChange(e.target.checked) }));
}

export function linkRow({ label, description, href, onClick, icon: ic, danger, trailing }) {
  const tag = href ? 'a' : 'button';
  return h(tag, { class: `setting-row link-row ${danger ? 'is-danger' : ''}`, href, type: href ? null : 'button', onClick },
    ic && h('span', { class: 'setting-icon' }, icon(ic, 20)),
    h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), description && h('span', { class: 'setting-desc' }, description)),
    trailing ?? icon('chevronRight', 18));
}

export function equalizer() {
  return h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
}

/** Lista de capítulos com indicadores de atual e concluído. */
export function chapterList(book, chapters, { onSelect, missing = new Set() } = {}) {
  const prog = state.progress.get(book.id);
  const completed = player.book?.id === book.id ? player.completed : new Set(prog?.completed || []);
  const currentId = player.book?.id === book.id ? player.chapter?.id : prog?.chapterId;
  return h('ol', { class: 'chapter-list', 'data-chapters-of': book.id },
    chapters.map((c, i) => {
      const isCurrent = c.id === currentId;
      const done = completed.has(c.id) || book.finished;
      const isMissing = missing.has(c.id);
      return h('li', { class: `chapter-item ${isCurrent ? 'is-current' : ''} ${done ? 'is-done' : ''} ${isMissing ? 'is-missing' : ''}`, 'data-chapter-id': c.id },
        h('button', { type: 'button', class: 'chapter-btn', onClick: () => onSelect?.(i, c), 'aria-current': isCurrent ? 'true' : null },
          h('span', { class: 'chapter-num' }, h('span', { class: 'n' }, String(i + 1)), equalizer()),
          h('span', { class: 'chapter-text' },
            h('span', { class: 'chapter-title' }, c.title),
            h('span', { class: 'chapter-meta' },
              isMissing ? 'Áudio não armazenado — indisponível offline' : formatDuration(c.duration),
              isCurrent && !isMissing && prog && !book.finished && ` · parou em ${formatTime(prog.position)}`)),
          h('span', { class: 'chapter-state', 'aria-label': done ? 'Concluído' : isCurrent ? 'Capítulo atual' : '' },
            isMissing ? icon('alert', 20) : done ? icon('checkCircleFill', 22) : isCurrent ? icon('headphones', 20) : null)));
    }));
}

/** Atualiza destaque do capítulo atual nas listas visíveis. */
export function syncChapterLists() {
  const book = player.book;
  for (const list of document.querySelectorAll('[data-chapters-of]')) {
    if (!book || list.dataset.chaptersOf !== book.id) continue;
    for (const li of list.children) {
      const id = li.dataset.chapterId;
      li.classList.toggle('is-current', id === player.chapter?.id);
      li.classList.toggle('is-playing', id === player.chapter?.id && player.isActive());
      li.classList.toggle('is-done', player.completed.has(id) || !!book.finished);
    }
  }
}
