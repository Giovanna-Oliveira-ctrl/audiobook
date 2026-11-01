import { h, iconButton, button, actionSheet, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { navigate, back } from '../router.js';
import { coverEl, bookProgress, progressBar, chapterList, emptyState, segmented, syncChapterLists, isPlayingBook } from '../components.js';
import { bookmarkList, openAddToPlaylistSheet } from '../sheets.js';
import { formatDuration, formatDate, formatBytes, debounce, plural } from '../utils.js';

export default function details(root, { params, query }) {
  const id = params.id;
  let tab = query.aba || 'chapters';
  let chapters = [];
  let missing = new Set();
  let cleanups = [];

  const runCleanups = () => {
    cleanups.forEach((c) => c?.());
    cleanups = [];
  };

  async function load() {
    if (!state.books.has(id)) return draw();
    chapters = await repo.getChapters(id);
    const v = await repo.verifyBookAudio(id);
    missing = new Set(v.missingChapterIds);
    draw();
  }

  function draw() {
    runCleanups();
    const book = state.books.get(id);
    if (!book) {
      root.replaceChildren(h('div', { class: 'page' },
        h('div', { class: 'page-header' }, iconButton('chevronLeft', 'Voltar', () => back('/biblioteca'), { className: 'back-btn' })),
        emptyState({ icon: 'bookOpen', title: 'Livro não encontrado', text: 'Ele pode ter sido removido da biblioteca.', actions: [h('a', { class: 'btn btn--primary', href: '#/biblioteca' }, 'Ir para a biblioteca')] })));
      return;
    }
    const p = bookProgress(book);
    const loaded = player.book?.id === id;
    const listenLabel = p.status === 'new' ? 'Ouvir agora' : p.status === 'done' ? 'Ouvir novamente' : 'Continuar';

    const playBtn = h('button', {
      type: 'button', class: `btn btn--primary btn--lg${isPlayingBook(id) ? ' is-playing' : ''}`, 'data-play-book': id,
      disabled: missing.size === chapters.length && chapters.length > 0,
      onClick: () => (loaded && player.isActive() ? player.pause() : player.playBook(id)),
    }, icon('play', 20), icon('pause', 20), h('span', { class: 'when-paused' }, listenLabel), h('span', { class: 'when-playing' }, 'Pausar'));

    const favBtn = h('button', {
      type: 'button', class: `btn btn--ghost ${book.favorite ? 'is-fav' : ''}`, 'aria-pressed': String(!!book.favorite),
      onClick: async () => {
        await repo.toggleFavorite(id);
        toast(book.favorite ? 'Removido dos favoritos.' : 'Adicionado aos favoritos.');
      },
    }, icon(book.favorite ? 'heartFill' : 'heart', 20), h('span', {}, book.favorite ? 'Favorito' : 'Adicionar aos favoritos'));

    const doneBtn = h('button', {
      type: 'button', class: `btn btn--ghost ${book.finished ? 'is-done' : ''}`, 'aria-pressed': String(!!book.finished),
      onClick: async () => {
        await repo.setFinished(id, !book.finished);
        toast(book.finished ? 'Marcado como não concluído.' : 'Marcado como concluído.');
      },
    }, icon(book.finished ? 'checkCircleFill' : 'checkCircle', 20), h('span', {}, book.finished ? 'Concluído' : 'Marcar como concluído'));

    const offline = missing.size
      ? h('div', { class: 'notice notice--warning', role: 'status' }, icon('alert', 22),
          h('div', {}, h('strong', {}, `${plural(missing.size, 'capítulo não está', 'capítulos não estão')} armazenados neste dispositivo`),
            h('p', {}, 'Esses capítulos não podem ser reproduzidos offline. Reimporte os arquivos para corrigir.')),
          h('a', { class: 'btn btn--sm btn--ghost', href: `#/editar/${encodeURIComponent(id)}` }, 'Reimportar'))
      : chapters.length
        ? h('p', { class: 'offline-ok' }, icon('checkCircle', 18), `Disponível offline · ${formatBytes(book.audioSize)} no dispositivo`)
        : null;

    const synopsis = book.synopsis
      ? (() => {
          const text = h('p', { class: 'synopsis-text clamp' }, book.synopsis);
          const more = h('button', { type: 'button', class: 'link-btn', onClick: () => { text.classList.toggle('clamp'); more.textContent = text.classList.contains('clamp') ? 'Ler mais' : 'Ler menos'; } }, 'Ler mais');
          return h('section', { class: 'detail-section' }, h('h2', { class: 'section-title' }, 'Sinopse'), text, book.synopsis.length > 220 && more);
        })()
      : null;

    const tabBody = h('div', { class: 'tab-body' });
    const renderTab = () => {
      tabBody.querySelector('.bookmark-list')?.cleanup?.();
      if (tab === 'chapters') {
        tabBody.replaceChildren(chapterList(book, chapters, {
          missing,
          onSelect: (i, c) => {
            if (missing.has(c.id)) return toast('Este capítulo não está armazenado no dispositivo. Reimporte o arquivo.', { tone: 'error' });
            if (loaded && i === player.index) player.toggle();
            else player.playBook(id, { chapterIndex: i, position: 0 });
          },
        }));
        syncChapterLists();
      } else if (tab === 'bookmarks') {
        const list = bookmarkList(id);
        cleanups.push(list.cleanup);
        tabBody.replaceChildren(list);
      } else {
        const save = debounce((v) => repo.updateBook(id, { notes: v }, { silent: true }).then(() => (saved.textContent = 'Salvo no dispositivo')), 500);
        const saved = h('span', { class: 'muted small notes-status' }, book.notes ? 'Salvo no dispositivo' : '');
        const ta = h('textarea', {
          class: 'input notes-input', rows: '8', placeholder: 'Escreva suas impressões, citações, personagens…',
          'aria-label': 'Notas pessoais',
          onInput: (e) => { saved.textContent = 'Salvando…'; save(e.target.value); },
          onBlur: (e) => save.flush(e.target.value),
        }, book.notes || '');
        cleanups.push(() => save.flush(ta.value));
        tabBody.replaceChildren(ta, saved);
      }
    };
    let tabsEl = buildTabs();
    function buildTabs() {
      return segmented(
        [{ value: 'chapters', label: `Capítulos (${chapters.length})` }, { value: 'bookmarks', label: 'Marcadores' }, { value: 'notes', label: 'Notas' }],
        tab,
        (v) => { tab = v; tabsEl.replaceWith((tabsEl = buildTabs())); renderTab(); },
        { label: 'Seções do livro' },
      );
    }
    renderTab();

    const info = [
      ['Autor', book.author],
      ['Narrador', book.narrator],
      ['Gênero', book.genre],
      ['Ano', book.year],
      ['Duração total', formatDuration(book.totalDuration)],
      ['Capítulos', String(book.chapterCount)],
      ['Progresso', p.status === 'done' ? 'Concluído' : p.status === 'new' ? 'Não iniciado' : `${Math.round(p.fraction * 100)}%`],
      ['Tempo restante', p.status === 'done' ? '—' : formatDuration(p.remaining)],
      ['Adicionado em', formatDate(book.addedAt)],
      book.finishedAt && ['Concluído em', formatDate(book.finishedAt)],
      ['Tamanho', formatBytes((book.audioSize || 0) + (book.coverSize || 0))],
    ].filter((r) => r && r[1]);

    root.replaceChildren(h('div', { class: 'page page-details', style: { '--tint': book.coverColor || 'var(--accent)' } },
      h('div', { class: 'details-bg', 'aria-hidden': 'true' }),
      h('div', { class: 'details-topbar' },
        iconButton('chevronLeft', 'Voltar', () => back('/biblioteca'), { className: 'back-btn' }),
        iconButton('more', 'Mais opções', () => moreMenu(book))),
      h('section', { class: 'details-hero', 'data-book-id': id },
        coverEl(book, { size: 'xl' }),
        h('div', { class: 'details-head' },
          book.genre && h('a', { class: 'genre-pill', href: `#/biblioteca?genero=${encodeURIComponent(book.genre)}` }, icon('tag', 14), book.genre),
          h('h1', { class: 'details-title' }, book.title),
          h('p', { class: 'details-author' }, book.author || 'Autor desconhecido'),
          book.narrator && h('p', { class: 'details-narrator' }, `Narração: ${book.narrator}`),
          h('p', { class: 'details-meta' }, `${formatDuration(book.totalDuration)} · ${plural(book.chapterCount, 'capítulo', 'capítulos')}`),
          progressBar(book, { showLabel: true, className: 'details-progress' }),
          h('div', { class: 'details-actions' }, playBtn, favBtn, doneBtn),
          offline)),
      synopsis,
      h('section', { class: 'detail-section' }, h('div', { class: 'tabs-row' }, tabsEl), tabBody),
      h('section', { class: 'detail-section' }, h('h2', { class: 'section-title' }, 'Informações'),
        h('dl', { class: 'info-grid' }, info.map(([k, v]) => h('div', { class: 'info-item' }, h('dt', {}, k), h('dd', {}, v)))))));
  }

  function moreMenu(book) {
    actionSheet({
      title: book.title,
      actions: [
        { label: 'Editar informações e capítulos', icon: 'edit', onSelect: () => navigate(`/editar/${encodeURIComponent(book.id)}`) },
        { label: 'Adicionar à playlist', icon: 'playlist', onSelect: () => openAddToPlaylistSheet(book.id) },
        { label: book.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos', icon: 'heart', onSelect: () => repo.toggleFavorite(book.id) },
        { label: book.finished ? 'Marcar como não concluído' : 'Marcar como concluído', icon: 'checkCircle', onSelect: () => repo.setFinished(book.id, !book.finished) },
        state.progress.get(book.id) && {
          label: 'Reiniciar progresso', icon: 'rotate',
          onSelect: async () => {
            if (await confirmDialog({ title: 'Reiniciar progresso?', message: 'O livro voltará para o início do primeiro capítulo. Marcadores e notas são mantidos.', confirmLabel: 'Reiniciar' })) {
              if (player.book?.id === book.id) {
                player.completed.clear();
                await player.loadChapter(0, 0, false);
              }
              await repo.resetProgress(book.id);
              await repo.setFinished(book.id, false);
              toast('Progresso reiniciado.');
            }
          },
        },
        {
          label: 'Remover audiolivro', icon: 'trash', danger: true,
          onSelect: async () => {
            const ok = await confirmDialog({
              title: 'Remover audiolivro?',
              message: `“${book.title}” e seus ${formatBytes(book.audioSize)} de áudio serão apagados deste dispositivo, junto com progresso, marcadores e notas. Esta ação não pode ser desfeita.`,
              confirmLabel: 'Remover', danger: true,
            });
            if (ok) {
              await repo.deleteBook(book.id);
              toast('Audiolivro removido.');
              navigate('/biblioteca', { replace: true });
            }
          },
        },
      ],
    });
  }

  load();
  const offs = [
    bus.on('library', (e) => {
      if (!e || e.id === id || e.type === 'import' || e.type === 'reset') load();
    }),
    bus.on('player:durations', () => player.book?.id === id && load()),
    bus.on('player:completed', () => syncChapterLists()),
  ];
  return () => {
    offs.forEach((o) => o());
    runCleanups();
  };
}
