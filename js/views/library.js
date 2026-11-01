import { h, iconButton } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { navigate, replaceQuery } from '../router.js';
import { bookCard, bookRow, bookProgress, chip, emptyState, pageHeader, segmented } from '../components.js';
import { normalize, debounce, plural } from '../utils.js';
import { playlistsPanel } from './playlists.js';

const SORTS = [
  { value: 'added', label: 'Adicionados recentemente' },
  { value: 'recent', label: 'Ouvidos recentemente' },
  { value: 'title', label: 'Título (A–Z)' },
  { value: 'author', label: 'Autor (A–Z)' },
  { value: 'progress', label: 'Progresso' },
  { value: 'genre', label: 'Gênero' },
];
const STATUSES = [
  { value: 'all', label: 'Todos' },
  { value: 'progress', label: 'Em andamento' },
  { value: 'new', label: 'Não iniciados' },
  { value: 'done', label: 'Concluídos' },
];

export default function library(root, { query }) {
  const ui = {
    tab: query.aba === 'playlists' ? 'playlists' : 'books',
    q: query.q || '',
    status: query.status || 'all',
    genre: query.genero || '',
    sort: query.ordem || state.settings.librarySort || 'added',
  };
  const results = h('div', { class: 'library-results' });
  const searchInput = h('input', {
    class: 'input search-input', type: 'search', placeholder: 'Pesquisar por título, autor, narrador…', value: ui.q,
    'aria-label': 'Pesquisar audiolivros', enterkeyhint: 'search', autocomplete: 'off',
  });
  const filters = h('div', { class: 'library-filters' });
  let panelCleanup = null;

  const syncUrl = () =>
    replaceQuery({ q: ui.q, status: ui.status !== 'all' ? ui.status : '', genero: ui.genre, ordem: ui.sort !== state.settings.librarySort ? ui.sort : '', aba: ui.tab === 'playlists' ? 'playlists' : '' });

  const onSearch = debounce(() => {
    ui.q = searchInput.value;
    syncUrl();
    drawResults();
  }, 150);
  searchInput.addEventListener('input', onSearch);

  function drawFilters() {
    const books = repo.allBooks();
    const counts = { all: books.length, progress: 0, new: 0, done: 0 };
    books.forEach((b) => counts[bookProgress(b).status]++);
    const genres = repo.genres();
    filters.replaceChildren(
      h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filtrar por status' },
        STATUSES.map((s) => chip(s.label, { active: ui.status === s.value, count: counts[s.value], onClick: () => { ui.status = s.value; syncUrl(); drawFilters(); drawResults(); } }))),
      genres.length
        ? h('div', { class: 'chip-row chip-row--genres', role: 'group', 'aria-label': 'Filtrar por gênero' },
            chip('Todos os gêneros', { active: !ui.genre, onClick: () => { ui.genre = ''; syncUrl(); drawFilters(); drawResults(); } }),
            genres.map((g) => chip(g, { active: ui.genre === g, onClick: () => { ui.genre = ui.genre === g ? '' : g; syncUrl(); drawFilters(); drawResults(); } })))
        : null,
      h('div', { class: 'library-toolbar' },
        h('label', { class: 'select-wrap' }, icon('sort', 18),
          h('span', { class: 'sr-only' }, 'Ordenar por'),
          h('select', {
            class: 'select', 'aria-label': 'Ordenar por',
            onChange: (e) => { ui.sort = e.target.value; repo.updateSettings({ librarySort: ui.sort }); syncUrl(); drawResults(); },
          }, SORTS.map((s) => h('option', { value: s.value, selected: s.value === ui.sort }, s.label)))),
        segmented(
          [{ value: 'grid', label: 'Grade', icon: 'grid' }, { value: 'list', label: 'Lista', icon: 'list' }],
          state.settings.libraryView,
          (v) => repo.updateSettings({ libraryView: v }),
          { label: 'Modo de visualização' },
        )),
    );
  }

  function filtered() {
    const q = normalize(ui.q);
    let books = repo.allBooks();
    if (q) {
      const terms = q.split(/\s+/);
      books = books.filter((b) => {
        const hay = normalize([b.title, b.author, b.narrator, b.genre].join(' '));
        return terms.every((t) => hay.includes(t));
      });
    }
    if (ui.status !== 'all') books = books.filter((b) => bookProgress(b).status === ui.status);
    if (ui.genre) books = books.filter((b) => (b.genre || '') === ui.genre);
    const lp = (b) => state.progress.get(b.id)?.lastPlayedAt || 0;
    const by = {
      added: (a, b) => b.addedAt - a.addedAt,
      recent: (a, b) => lp(b) - lp(a) || b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true }),
      author: (a, b) => (a.author || '~').localeCompare(b.author || '~', 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR'),
      progress: (a, b) => bookProgress(b).fraction - bookProgress(a).fraction,
      genre: (a, b) => (a.genre || '~').localeCompare(b.genre || '~', 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR'),
    };
    return books.sort(by[ui.sort] || by.added);
  }

  function drawResults() {
    const all = repo.allBooks();
    if (!all.length) {
      results.replaceChildren(emptyState({
        icon: 'library', title: 'Sua biblioteca está vazia',
        text: 'Importe arquivos de áudio do dispositivo para começar. Eles ficarão disponíveis offline.',
        actions: [h('a', { class: 'btn btn--primary', href: '#/importar' }, icon('upload', 20), h('span', {}, 'Importar audiolivro'))],
      }));
      return;
    }
    const books = filtered();
    if (!books.length) {
      results.replaceChildren(emptyState({ icon: 'search', title: 'Nada encontrado', text: 'Tente outra busca ou remova os filtros.' }));
      return;
    }
    const view = state.settings.libraryView;
    const render = (list) =>
      view === 'list' ? h('div', { class: 'book-list' }, list.map((b) => bookRow(b))) : h('div', { class: 'book-grid' }, list.map((b) => bookCard(b)));
    const count = h('p', { class: 'results-count muted small' }, plural(books.length, 'audiolivro', 'audiolivros'));
    if (ui.sort === 'genre') {
      const groups = new Map();
      for (const b of books) {
        const g = b.genre || 'Sem gênero';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(b);
      }
      results.replaceChildren(count, ...[...groups].map(([g, list]) =>
        h('section', { class: 'genre-group' }, h('h2', { class: 'section-title' }, g, h('span', { class: 'section-count' }, list.length)), render(list))));
    } else results.replaceChildren(count, render(books));
  }

  function draw() {
    panelCleanup?.();
    panelCleanup = null;
    const tabs = segmented(
      [{ value: 'books', label: 'Livros', icon: 'library' }, { value: 'playlists', label: 'Playlists', icon: 'playlist' }],
      ui.tab,
      (v) => { ui.tab = v; syncUrl(); draw(); },
      { label: 'Seção da biblioteca' },
    );
    const header = pageHeader({
      title: 'Minha biblioteca',
      subtitle: plural(state.books.size, 'audiolivro', 'audiolivros'),
      actions: [iconButton('plus', 'Importar audiolivro', () => navigate('/importar'), { className: 'icon-btn--accent' })],
    });
    if (ui.tab === 'playlists') {
      const panel = playlistsPanel();
      panelCleanup = panel.cleanup;
      root.replaceChildren(h('div', { class: 'page page-library' }, header, h('div', { class: 'tabs-row' }, tabs), panel));
      return;
    }
    drawFilters();
    drawResults();
    root.replaceChildren(h('div', { class: 'page page-library' }, header, h('div', { class: 'tabs-row' }, tabs),
      h('div', { class: 'search-wrap' }, icon('search', 20), searchInput), filters, results));
  }

  draw();
  if (query.buscar) requestAnimationFrame(() => searchInput.focus());

  const offs = [
    bus.on('library', () => (ui.tab === 'books' ? (drawFilters(), drawResults()) : null)),
    bus.on('settings', () => ui.tab === 'books' && (drawFilters(), drawResults())),
  ];
  return () => {
    offs.forEach((o) => o());
    panelCleanup?.();
  };
}
