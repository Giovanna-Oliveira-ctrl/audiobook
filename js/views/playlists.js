import { h, iconButton, button, promptDialog, confirmDialog, toast, openModal, actionSheet } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { navigate, back } from '../router.js';
import { coverEl, emptyState, pageHeader, bookRow } from '../components.js';
import { formatDuration, plural } from '../utils.js';
import { enableSortable } from '../sortable.js';

const plDuration = (pl) => pl.bookIds.reduce((s, id) => s + (state.books.get(id)?.totalDuration || 0), 0);

function mosaic(pl) {
  const books = pl.bookIds.map((id) => state.books.get(id)).filter(Boolean).slice(0, 4);
  if (!books.length) return h('div', { class: 'mosaic mosaic--empty' }, icon('playlist', 30));
  return h('div', { class: `mosaic mosaic--${Math.min(books.length, 4)}` }, books.map((b) => coverEl(b, { size: 'sm' })));
}

export async function newPlaylist() {
  const name = await promptDialog({ title: 'Nova playlist', placeholder: 'Ex.: Clássicos para a estrada', confirmLabel: 'Criar' });
  if (name && name.trim()) {
    const pl = await repo.createPlaylist(name);
    navigate(`/playlist/${pl.id}`);
  }
}

export function playPlaylist(pl) {
  const ids = pl.bookIds.filter((id) => state.books.has(id));
  if (!ids.length) return toast('A playlist está vazia.');
  const first = ids.find((id) => !state.books.get(id).finished) || ids[0];
  player.playBook(first, { playlistId: pl.id });
}

/** Painel usado dentro da Biblioteca (aba Playlists). */
export function playlistsPanel() {
  const wrap = h('div', { class: 'playlists-panel' });
  const draw = () => {
    const lists = repo.allPlaylists();
    wrap.replaceChildren(
      h('div', { class: 'panel-actions' }, button('Nova playlist', { icon: 'plus', variant: 'primary', onClick: newPlaylist })),
      lists.length
        ? h('div', { class: 'playlist-grid' },
            lists.map((pl) =>
              h('a', { class: 'playlist-card', href: `#/playlist/${pl.id}` },
                mosaic(pl),
                h('div', { class: 'playlist-card-body' },
                  h('h3', {}, pl.name),
                  h('p', { class: 'muted small' }, `${plural(pl.bookIds.length, 'livro', 'livros')} · ${formatDuration(plDuration(pl))}`)))))
        : emptyState({ icon: 'playlist', title: 'Nenhuma playlist', text: 'Crie listas para organizar livros por tema, série ou ocasião. Ao terminar um livro, o próximo da playlist começa sozinho.' }),
    );
  };
  draw();
  const offs = [bus.on('playlists', draw), bus.on('library', draw)];
  wrap.cleanup = () => offs.forEach((o) => o());
  return wrap;
}

function openBookPicker(pl) {
  const selected = new Set(pl.bookIds);
  const books = repo.allBooks().sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const list = h('div', { class: 'picker-list' },
    books.map((b) =>
      h('label', { class: 'picker-item' },
        h('input', { type: 'checkbox', checked: selected.has(b.id), onChange: (e) => (e.target.checked ? selected.add(b.id) : selected.delete(b.id)) }),
        coverEl(b, { size: 'xs' }),
        h('span', { class: 'picker-text' }, h('strong', {}, b.title), h('small', {}, b.author || '')))));
  const m = openModal({
    title: 'Adicionar livros',
    className: 'sheet-tall',
    content: books.length ? list : h('p', { class: 'muted' }, 'Sua biblioteca está vazia.'),
    actions: [
      h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => m.close() }, 'Cancelar'),
      h('button', {
        type: 'button', class: 'btn btn--primary',
        onClick: async () => {
          const kept = pl.bookIds.filter((id) => selected.has(id));
          const added = [...selected].filter((id) => !pl.bookIds.includes(id));
          await repo.savePlaylist({ ...pl, bookIds: [...kept, ...added] });
          m.close();
        },
      }, 'Salvar'),
    ],
  });
}

/** Tela de detalhes da playlist (#/playlist/:id). */
export default function playlistView(root, { params }) {
  const draw = () => {
    const pl = state.playlists.get(params.id);
    if (!pl) {
      root.replaceChildren(h('div', { class: 'page' }, pageHeader({ title: 'Playlist', back: () => back('/biblioteca?aba=playlists') }),
        emptyState({ icon: 'playlist', title: 'Playlist não encontrada' })));
      return;
    }
    const books = pl.bookIds.map((id) => state.books.get(id)).filter(Boolean);
    const list = h('div', { class: 'book-list sortable' },
      books.map((b, i) =>
        h('div', { class: 'sortable-item', 'data-index': String(i) },
          h('span', { class: 'drag-handle', 'data-drag-handle': '', 'aria-hidden': 'true' }, icon('grip', 20)),
          bookRow(b, {
            meta: `${i + 1}º da playlist · ${formatDuration(b.totalDuration)}`,
            actions: iconButton('x', 'Remover da playlist', async () => {
              await repo.savePlaylist({ ...pl, bookIds: pl.bookIds.filter((x) => x !== b.id) });
              toast(`“${b.title}” removido da playlist.`);
            }),
          }))));
    enableSortable(list, async (from, to) => {
      const ids = books.map((b) => b.id);
      const [m] = ids.splice(from, 1);
      ids.splice(to, 0, m);
      await repo.savePlaylist({ ...pl, bookIds: ids });
    });

    root.replaceChildren(h('div', { class: 'page page-playlist' },
      pageHeader({
        eyebrow: 'Playlist',
        title: pl.name,
        subtitle: `${plural(books.length, 'livro', 'livros')} · ${formatDuration(plDuration(pl))}`,
        back: () => back('/biblioteca?aba=playlists'),
        actions: [iconButton('more', 'Mais opções', () => actionSheet({
          title: pl.name,
          actions: [
            { label: 'Renomear', icon: 'edit', onSelect: async () => {
              const name = await promptDialog({ title: 'Renomear playlist', value: pl.name });
              if (name && name.trim()) repo.savePlaylist({ ...pl, name: name.trim() });
            } },
            { label: 'Editar descrição', icon: 'note', onSelect: async () => {
              const d = await promptDialog({ title: 'Descrição', value: pl.description || '', multiline: true });
              if (d != null) repo.savePlaylist({ ...pl, description: d.trim() });
            } },
            { label: 'Excluir playlist', icon: 'trash', danger: true, onSelect: async () => {
              if (await confirmDialog({ title: 'Excluir playlist?', message: `“${pl.name}” será excluída. Os livros continuam na biblioteca.`, confirmLabel: 'Excluir', danger: true })) {
                await repo.deletePlaylist(pl.id);
                navigate('/biblioteca?aba=playlists', { replace: true });
              }
            } },
          ],
        }))],
      }),
      pl.description && h('p', { class: 'page-lead' }, pl.description),
      h('div', { class: 'action-bar' },
        button('Reproduzir playlist', { icon: 'play', variant: 'primary', onClick: () => playPlaylist(pl), attrs: { disabled: !books.length } }),
        button('Adicionar livros', { icon: 'plus', variant: 'ghost', onClick: () => openBookPicker(pl) })),
      books.length
        ? h('div', {}, h('p', { class: 'muted small hint' }, icon('grip', 16), 'Arraste para reordenar. Ao terminar um livro, o próximo começa automaticamente.'), list)
        : emptyState({ icon: 'library', title: 'Playlist vazia', text: 'Adicione livros da sua biblioteca.' })));
  };
  draw();
  const offs = [bus.on('playlists', draw), bus.on('library', draw)];
  return () => offs.forEach((o) => o());
}
