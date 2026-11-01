/* Folhas compartilhadas: velocidade, temporizador, capítulos, marcadores, playlists. */

import { h, openModal, promptDialog, confirmDialog, toast } from './ui.js';
import { icon } from './icons.js';
import { state, bus, SPEEDS, SLEEP_OPTIONS } from './state.js';
import * as repo from './repo.js';
import { player } from './player.js';
import { chapterList } from './components.js';
import { formatTime, formatDateTime } from './utils.js';
import { navigate } from './router.js';

const fmtRate = (r) => `${String(r).replace('.', ',')}x`;
export { fmtRate };

export function openSpeedSheet() {
  const grid = h('div', { class: 'speed-grid', role: 'radiogroup', 'aria-label': 'Velocidade de reprodução' });
  const draw = () => {
    grid.replaceChildren(
      ...SPEEDS.map((s) =>
        h('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(player.rate === s),
          class: `speed-opt ${player.rate === s ? 'is-active' : ''}`,
          onClick: () => {
            player.setRate(s);
            draw();
          },
        }, fmtRate(s)),
      ),
    );
  };
  draw();
  const setDefault = h('button', {
    type: 'button',
    class: 'btn btn--ghost btn--block',
    onClick: async () => {
      await repo.updateSettings({ defaultSpeed: player.rate });
      toast(`${fmtRate(player.rate)} definida como velocidade padrão.`);
    },
  }, icon('check', 18), 'Usar como velocidade padrão');
  openModal({
    title: 'Velocidade',
    content: h('div', { class: 'sheet-stack' },
      h('p', { class: 'muted small' }, 'A mudança é imediata, sem reiniciar o capítulo. A velocidade fica salva para este livro.'),
      grid,
      setDefault),
  });
}

export function openSleepSheet() {
  const body = h('div', { class: 'sheet-stack' });
  const draw = () => {
    const s = player.sleepInfo();
    const status = s.active
      ? h('div', { class: 'sleep-status' },
          icon('moon', 26),
          h('div', {},
            h('p', { class: 'sleep-label' }, s.mode === 'chapter' ? 'Pausará no final do capítulo' : 'Pausará em'),
            s.mode === 'time' && h('p', { class: 'sleep-time', 'data-sleep-remaining': '' }, formatTime(Math.ceil(s.remainingMs / 1000)))),
          h('div', { class: 'sleep-actions' },
            h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => { player.restartSleep(); draw(); } }, icon('rotate', 18), 'Reiniciar'),
            h('button', { type: 'button', class: 'btn btn--danger-ghost', onClick: () => { player.cancelSleep(); draw(); toast('Temporizador cancelado.'); } }, icon('x', 18), 'Cancelar')))
      : null;
    body.replaceChildren(
      ...[
        status,
        h('div', { class: 'menu-list' },
          SLEEP_OPTIONS.map((o) =>
            h('button', {
              type: 'button',
              class: `menu-item ${s.active && s.value === o.value ? 'is-active' : ''}`,
              onClick: () => {
                player.startSleep(o.value);
                toast(o.value === 'chapter' ? 'A reprodução pausará no final do capítulo.' : `Temporizador: ${o.label}.`);
                m.close();
              },
            }, icon(o.value === 'chapter' ? 'chapters' : 'clock', 20), h('span', {}, o.label)))),
      ].filter(Boolean),
    );
  };
  draw();
  const off = bus.on('player:sleep', (s) => {
    const el = body.querySelector('[data-sleep-remaining]');
    if (el && s.mode === 'time') el.textContent = formatTime(Math.ceil(s.remainingMs / 1000));
    else if (!s.active && body.querySelector('.sleep-status')) draw();
  });
  const m = openModal({ title: 'Temporizador de desligamento', content: body, onClose: off });
}

export function openChaptersSheet() {
  if (!player.book) return;
  const book = player.book;
  const list = chapterList(book, player.chapters, {
    onSelect: (i) => {
      if (i === player.index) player.toggle();
      else player.loadChapter(i, 0, true);
      m.close();
    },
  });
  const m = openModal({ title: `Capítulos · ${player.chapters.length}`, content: list, className: 'sheet-tall' });
  requestAnimationFrame(() => list.querySelector('.is-current')?.scrollIntoView({ block: 'center' }));
}

/** Adiciona marcador na posição atual. */
export async function quickBookmark() {
  if (!player.book || !player.chapter) return;
  const rec = await repo.addBookmark({
    bookId: player.book.id,
    chapterId: player.chapter.id,
    chapterIndex: player.index,
    chapterTitle: player.chapter.title,
    position: player.position,
  });
  toast(`Marcador em ${formatTime(rec.position)} adicionado.`, {
    action: {
      label: 'Adicionar nota',
      onClick: async () => {
        const note = await promptDialog({ title: 'Nota do marcador', value: '', placeholder: 'Ex.: frase favorita', multiline: true });
        if (note != null) await repo.updateBookmark({ ...rec, note: note.trim() });
      },
    },
  });
}

export function jumpToBookmark(b) {
  const go = () => {
    const idx = player.chapters.findIndex((c) => c.id === b.chapterId);
    player.loadChapter(idx >= 0 ? idx : b.chapterIndex || 0, b.position, true);
  };
  if (player.book?.id === b.bookId) go();
  else player.playBook(b.bookId, { chapterIndex: b.chapterIndex, position: b.position }).then(() => {
    const idx = player.chapters.findIndex((c) => c.id === b.chapterId);
    if (idx >= 0 && idx !== player.index) player.loadChapter(idx, b.position, true);
  });
}

export function bookmarkList(bookId, { onJump } = {}) {
  const wrap = h('div', { class: 'bookmark-list' });
  const draw = async () => {
    const list = await repo.getBookmarks(bookId);
    if (!list.length) {
      wrap.replaceChildren(h('p', { class: 'muted empty-inline' }, icon('bookmark', 20), 'Nenhum marcador ainda. Use o botão de marcador no player para salvar momentos.'));
      return;
    }
    wrap.replaceChildren(
      ...list.map((b) =>
        h('div', { class: 'bookmark-item' },
          h('button', { type: 'button', class: 'bookmark-main', onClick: () => { jumpToBookmark(b); onJump?.(b); } },
            h('span', { class: 'bookmark-time' }, formatTime(b.position)),
            h('span', { class: 'bookmark-text' },
              h('span', { class: 'bookmark-chapter' }, `Cap. ${b.chapterIndex + 1} · ${b.chapterTitle || ''}`),
              b.note && h('span', { class: 'bookmark-note' }, b.note),
              h('span', { class: 'bookmark-date' }, formatDateTime(b.createdAt)))),
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': 'Editar nota', title: 'Editar nota',
            onClick: async () => {
              const note = await promptDialog({ title: 'Nota do marcador', value: b.note || '', multiline: true });
              if (note != null) await repo.updateBookmark({ ...b, note: note.trim() });
            },
          }, icon('edit', 18)),
          h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': 'Excluir marcador', title: 'Excluir marcador',
            onClick: async () => {
              if (await confirmDialog({ title: 'Excluir marcador?', message: `Marcador em ${formatTime(b.position)} será removido.`, confirmLabel: 'Excluir', danger: true })) {
                await repo.deleteBookmark(b);
              }
            },
          }, icon('trash', 18)))),
    );
  };
  draw();
  const off = bus.on('bookmarks', (id) => id === bookId && draw());
  wrap.cleanup = off;
  return wrap;
}

export function openBookmarksSheet() {
  if (!player.book) return;
  const bookId = player.book.id;
  const list = bookmarkList(bookId, { onJump: () => m.close() });
  const add = h('button', { type: 'button', class: 'btn btn--primary btn--block', onClick: () => quickBookmark() },
    icon('bookmarkPlus', 20), `Adicionar marcador em ${formatTime(player.position)}`);
  const m = openModal({ title: 'Marcadores', content: h('div', { class: 'sheet-stack' }, add, list), className: 'sheet-tall', onClose: () => list.cleanup?.() });
}

export function openAddToPlaylistSheet(bookId) {
  const body = h('div', { class: 'sheet-stack' });
  const draw = () => {
    const lists = repo.allPlaylists();
    body.replaceChildren(
      h('button', {
        type: 'button', class: 'btn btn--ghost btn--block',
        onClick: async () => {
          const name = await promptDialog({ title: 'Nova playlist', placeholder: 'Ex.: Para viagens', confirmLabel: 'Criar' });
          if (name && name.trim()) {
            await repo.createPlaylist(name, [bookId]);
            toast(`Adicionado à playlist “${name.trim()}”.`);
            draw();
          }
        },
      }, icon('plus', 18), 'Nova playlist'),
      lists.length
        ? h('div', { class: 'menu-list' },
            lists.map((pl) => {
              const has = pl.bookIds.includes(bookId);
              return h('button', {
                type: 'button', class: `menu-item ${has ? 'is-active' : ''}`, role: 'menuitemcheckbox', 'aria-checked': String(has),
                onClick: async () => {
                  await repo.togglePlaylistBook(pl.id, bookId);
                  toast(has ? `Removido de “${pl.name}”.` : `Adicionado a “${pl.name}”.`);
                  draw();
                },
              }, icon('playlist', 20), h('span', {}, pl.name), h('span', { class: 'menu-trailing' }, has ? icon('checkCircleFill', 20) : h('span', { class: 'muted small' }, `${pl.bookIds.length}`)));
            }))
        : h('p', { class: 'muted small' }, 'Você ainda não tem playlists.'),
    );
  };
  draw();
  openModal({ title: 'Adicionar à playlist', content: body });
}

export function openBookDetailsFromPlayer() {
  if (player.book) navigate(`/livro/${encodeURIComponent(player.book.id)}`);
}

export { state };
