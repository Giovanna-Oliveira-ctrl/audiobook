import { h } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { bookCard, bookRow, emptyState, pageHeader, segmented } from '../components.js';
import { plural } from '../utils.js';

export default function favorites(root) {
  const draw = () => {
    const books = repo.allBooks().filter((b) => b.favorite).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
    const view = state.settings.libraryView;
    root.replaceChildren(h('div', { class: 'page page-favorites' },
      pageHeader({
        title: 'Favoritos',
        subtitle: books.length ? plural(books.length, 'livro favorito', 'livros favoritos') : null,
        actions: books.length ? [segmented([{ value: 'grid', label: 'Grade', icon: 'grid' }, { value: 'list', label: 'Lista', icon: 'list' }], view, (v) => repo.updateSettings({ libraryView: v }), { label: 'Modo de visualização' })] : null,
      }),
      books.length
        ? view === 'list'
          ? h('div', { class: 'book-list' }, books.map((b) => bookRow(b)))
          : h('div', { class: 'book-grid' }, books.map((b) => bookCard(b)))
        : emptyState({
            icon: 'heart',
            title: 'Nenhum favorito ainda',
            text: 'Toque em “Adicionar aos favoritos” nos detalhes de um livro ou no coração do player.',
            actions: [h('a', { class: 'btn btn--primary', href: '#/biblioteca' }, icon('library', 20), h('span', {}, 'Abrir biblioteca'))],
          })));
  };
  draw();
  const offs = [bus.on('library', draw), bus.on('settings', draw)];
  return () => offs.forEach((o) => o());
}
