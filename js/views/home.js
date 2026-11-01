import { h, iconButton, button } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { navigate } from '../router.js';
import { coverEl, bookProgress, progressBar, shelf, bookCard, emptyState, sectionHeader, isPlayingBook } from '../components.js';
import { greeting, todayLong, formatDuration, dayKey } from '../utils.js';
import { createDemoBook } from './import.js';
import { isStandalone } from '../pwa.js';

export default function home(root) {
  const draw = () => root.replaceChildren(build());
  draw();
  const offs = ['library', 'player:book', 'player:chapter', 'settings', 'install:available', 'install:done', 'history', 'playlists'].map((e) => bus.on(e, draw));
  return () => offs.forEach((o) => o());
}

function lastPlayed(b) {
  return state.progress.get(b.id)?.lastPlayedAt || state.history.get(b.id)?.lastPlayedAt || 0;
}

function currentBook(books) {
  if (player.book) return player.book;
  const id = state.session.lastBookId;
  if (id && state.books.has(id)) return state.books.get(id);
  return books.filter((b) => bookProgress(b).status === 'progress').sort((a, b) => lastPlayed(b) - lastPlayed(a))[0] || null;
}

function build() {
  const books = repo.allBooks();
  const name = state.settings.name?.trim();
  const page = h('div', { class: 'page page-home' });

  page.append(
    h('header', { class: 'home-header' },
      h('div', { class: 'home-greet' },
        h('p', { class: 'eyebrow' }, todayLong()),
        h('h1', { class: 'display' }, `${greeting()}${name ? `, ${name}` : ''}`)),
      h('div', { class: 'header-actions' },
        iconButton('search', 'Pesquisar na biblioteca', () => navigate('/biblioteca?buscar=1')),
        iconButton('plus', 'Importar audiolivro', () => navigate('/importar'), { className: 'icon-btn--accent' }))),
  );

  if (state.installPrompt && !isStandalone() && !state.settings.installDismissed) page.append(installBanner());

  if (!books.length) {
    page.append(welcome());
    return page;
  }

  const current = currentBook(books);
  if (current) page.append(hero(current));

  page.append(quickStats(books));

  const inProgress = books.filter((b) => bookProgress(b).status === 'progress').sort((a, b) => lastPlayed(b) - lastPlayed(a));
  const favorites = books.filter((b) => b.favorite).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
  const recent = [...books].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
  const most = books
    .map((b) => ({ b, t: state.progress.get(b.id)?.listened || 0 }))
    .filter((x) => x.t > 30)
    .sort((a, b) => b.t - a.t)
    .slice(0, 12);
  const all = [...books].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')).slice(0, 14);

  page.append(
    ...[
      shelf('Continue ouvindo', inProgress, { href: '#/biblioteca?status=progress' }),
      shelf('Minha biblioteca', all, { href: '#/biblioteca' }),
      shelf('Favoritos', favorites, { href: '#/favoritos', empty: 'Toque no coração de um livro para vê-lo aqui.' }),
      shelf('Adicionados recentemente', recent, { href: '#/biblioteca?ordem=added' }),
      shelf('Mais ouvidos', most.map((x) => x.b), {
        render: (b) => bookCard(b, { meta: `${formatDuration(state.progress.get(b.id)?.listened || 0)} ouvidos` }),
        empty: 'Seus livros mais ouvidos aparecerão aqui.',
      }),
    ].filter(Boolean),
  );
  return page;
}

function hero(book) {
  const p = bookProgress(book);
  const prog = state.progress.get(book.id);
  const loaded = player.book?.id === book.id;
  const chapterLine = loaded
    ? `Capítulo ${player.index + 1} de ${player.chapters.length} · ${player.chapter?.title || ''}`
    : prog?.chapterTitle
      ? `Capítulo ${(prog.chapterIndex || 0) + 1} de ${book.chapterCount} · ${prog.chapterTitle}`
      : `${book.chapterCount} capítulos · ${formatDuration(book.totalDuration)}`;
  const label = p.status === 'new' ? 'Começar a ouvir' : p.status === 'done' ? 'Ouvir novamente' : 'Continuar ouvindo';
  const playBtn = h('button', {
    type: 'button',
    class: `btn btn--primary btn--lg hero-play${isPlayingBook(book.id) ? ' is-playing' : ''}`,
    'data-play-book': book.id,
    onClick: () => (player.book?.id === book.id && player.isActive() ? player.pause() : player.playBook(book.id)),
  }, icon('play', 20), icon('pause', 20), h('span', { class: 'when-paused' }, label), h('span', { class: 'when-playing' }, 'Pausar'));

  return h('section', { class: 'hero', 'data-book-id': book.id, style: { '--tint': book.coverColor || 'var(--accent)' }, 'aria-label': 'Ouvindo agora' },
    h('div', { class: 'hero-bg', 'aria-hidden': 'true' }),
    h('a', { class: 'hero-cover', href: `#/livro/${encodeURIComponent(book.id)}`, 'aria-label': `Detalhes de ${book.title}` }, coverEl(book, { size: 'lg' })),
    h('div', { class: 'hero-body' },
      h('p', { class: 'eyebrow hero-eyebrow' }, loaded && player.isActive() ? 'Tocando agora' : 'Ouvindo agora'),
      h('h2', { class: 'hero-title' }, book.title),
      h('p', { class: 'hero-author' }, book.author || 'Autor desconhecido'),
      h('p', { class: 'hero-chapter' }, chapterLine),
      progressBar(book, { showLabel: true, className: 'hero-progress' })),
    h('div', { class: 'hero-actions' },
      playBtn,
      h('a', { class: 'btn btn--ghost', href: `#/livro/${encodeURIComponent(book.id)}` }, icon('info', 18), h('span', {}, 'Detalhes'))));
}

function quickStats(books) {
  const listenedTotal = [...state.progress.values()].reduce((s, p) => s + (p.listened || 0), 0);
  const done = books.filter((b) => b.finished).length;
  const today = h('span', { class: 'stat-value', 'data-stat-today': '' }, '—');
  repo.getStats().then((s) => (today.textContent = formatDuration(s.get(dayKey())?.seconds || 0)));
  return h('a', { class: 'quick-stats', href: '#/estatisticas', 'aria-label': 'Ver estatísticas de audição' },
    h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Hoje'), today),
    h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Tempo total'), h('span', { class: 'stat-value' }, formatDuration(listenedTotal))),
    h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Concluídos'), h('span', { class: 'stat-value' }, String(done))),
    h('span', { class: 'quick-stats-go' }, icon('chart', 20)));
}

function welcome() {
  return h('section', { class: 'welcome' },
    h('div', { class: 'welcome-art', 'aria-hidden': 'true' }, icon('headphones', 44)),
    h('h2', {}, 'Sua biblioteca de audiolivros, no seu bolso'),
    h('p', {}, 'Importe arquivos de áudio do seu dispositivo. Eles ficam guardados aqui mesmo — dá para ouvir em modo avião, com a tela bloqueada e usando outros apps.'),
    h('div', { class: 'welcome-actions' },
      button('Importar audiolivro', { icon: 'upload', variant: 'primary', onClick: () => navigate('/importar') }),
      button('Criar livro de demonstração', { icon: 'sparkles', variant: 'ghost', onClick: (e) => createDemoBook(e.currentTarget) })),
    h('ul', { class: 'welcome-points' },
      h('li', {}, icon('wifiOff', 20), h('span', {}, h('strong', {}, 'Offline de verdade. '), 'Áudio e progresso ficam no armazenamento local do navegador.')),
      h('li', {}, icon('lock', 20), h('span', {}, h('strong', {}, 'Tela bloqueada. '), 'Controles do sistema na tela de bloqueio e notificações.')),
      h('li', {}, icon('bookmark', 20), h('span', {}, h('strong', {}, 'Retome de onde parou. '), 'Progresso salvo automaticamente, capítulo a capítulo.'))),
    sectionHeader('Primeira vez aqui?'),
    h('a', { class: 'link-card', href: '#/instalar' }, icon('phone', 22), h('span', {}, h('strong', {}, 'Instale o app'), h('small', {}, 'Veja como adicionar à tela inicial no Android, iPhone ou computador.')), icon('chevronRight', 18)));
}

function installBanner() {
  return h('div', { class: 'install-banner' },
    icon('download', 22),
    h('div', {}, h('strong', {}, 'Instale o AUDIOBOOK'), h('p', {}, 'Abra como app, em tela cheia, e use offline.')),
    h('a', { class: 'btn btn--primary btn--sm', href: '#/instalar' }, 'Instalar'),
    iconButton('x', 'Dispensar', () => repo.updateSettings({ installDismissed: true }), { size: 18 }));
}
