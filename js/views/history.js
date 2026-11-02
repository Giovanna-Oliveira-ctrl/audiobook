import { h, button, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { coverEl, emptyState, pageHeader, progressBar, playToggle } from '../components.js';
import { relativeDay, formatClock, formatTime, formatDateTime, plural } from '../utils.js';

export default function historyView(root) {
  const draw = () => {
    const entries = [...state.history.values()]
      .filter((e) => state.books.has(e.bookId))
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);

    const groups = new Map();
    for (const e of entries) {
      const label = relativeDay(e.lastPlayedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(e);
    }

    root.replaceChildren(h('div', { class: 'page page-history' },
      pageHeader({
        title: 'Histórico',
        subtitle: entries.length ? plural(entries.length, 'livro ouvido', 'livros ouvidos') : null,
        actions: entries.length
          ? [button('Limpar', {
              icon: 'trash', variant: 'ghost',
              onClick: async () => {
                if (await confirmDialog({ title: 'Limpar histórico?', message: 'A lista de livros ouvidos será apagada. O progresso de cada livro, marcadores e estatísticas são mantidos.', confirmLabel: 'Limpar histórico', danger: true })) {
                  await repo.clearHistory();
                  toast('Histórico limpo.');
                }
              },
            })]
          : null,
      }),
      entries.length
        ? [...groups].map(([label, list]) =>
            h('section', { class: 'history-group' },
              h('h2', { class: 'history-day' }, label),
              h('div', { class: 'history-list' }, list.map(entry))))
        : emptyState({ icon: 'history', title: 'Nada por aqui ainda', text: 'Os livros que você ouvir aparecerão aqui, com o último capítulo e a posição em que parou.' })));
  };

  function entry(e) {
    const book = state.books.get(e.bookId);
    const p = state.progress.get(e.bookId);
    const chapterIdx = p?.chapterIndex ?? e.chapterIndex ?? 0;
    const chapterTitle = p?.chapterTitle || e.chapterTitle || '';
    const position = p?.position ?? e.position ?? 0;
    return h('article', { class: 'history-item', 'data-book-id': book.id },
      h('a', { class: 'history-link', href: `#/livro/${encodeURIComponent(book.id)}` },
        coverEl(book, { size: 'sm' }),
        h('div', { class: 'history-body' },
          h('h3', {}, book.title),
          h('p', { class: 'muted small' }, book.author || 'Autor desconhecido'),
          h('p', { class: 'history-pos' }, icon('headphones', 15), `Cap. ${chapterIdx + 1}${chapterTitle ? ` · ${chapterTitle}` : ''} · ${formatTime(position)}`),
          h('p', { class: 'history-when muted small', title: formatDateTime(e.lastPlayedAt) }, `Última reprodução às ${formatClock(e.lastPlayedAt)} · ${plural(e.plays || 1, 'sessão', 'sessões')}`),
          progressBar(book))),
      playToggle(book, { className: 'play-fab play-fab--inline' }));
  }

  draw();
  const offs = [bus.on('history', draw), bus.on('library', draw)];
  return () => offs.forEach((o) => o());
}

export { player };
