import { h, button, confirmDialog, toast, alertDialog } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { back } from '../router.js';
import { coverEl, pageHeader, emptyState } from '../components.js';
import { storageEstimate, isPersisted, requestPersistence, appCacheInfo, swMessage, platform } from '../pwa.js';
import { formatBytes, formatDuration, plural } from '../utils.js';

export default function storageView(root, { query }) {
  let estimate = null, persisted = null, cache = null;

  async function refresh() {
    [estimate, persisted, cache] = await Promise.all([storageEstimate(), isPersisted(), appCacheInfo().catch(() => null)]);
    draw();
  }

  function meter(label, bytes, total, cls) {
    const pct = total > 0 ? Math.max(0.5, (bytes / total) * 100) : 0;
    return h('span', { class: `meter-seg ${cls}`, style: { width: `${pct}%` }, title: `${label}: ${formatBytes(bytes)}` });
  }

  function draw() {
    const u = repo.libraryUsage();
    const quota = estimate?.quota || 0;
    const used = estimate?.usage || 0;
    const appBytes = cache?.bytes || 0;
    const others = Math.max(0, used - u.audio - u.covers - appBytes);
    const free = quota ? Math.max(0, quota - used) : null;
    const books = repo.allBooks().sort((a, b) => (b.audioSize || 0) - (a.audioSize || 0));
    const p = platform();

    const persistBox = h('div', { class: `notice ${persisted ? 'notice--ok' : 'notice--info'}` },
      icon(persisted ? 'lock' : 'info', 22),
      h('div', {},
        h('strong', {}, persisted ? 'Armazenamento persistente ativado' : persisted === false ? 'Armazenamento não persistente' : 'Persistência desconhecida neste navegador'),
        h('p', {}, persisted
          ? 'O navegador não apagará sua biblioteca automaticamente, mesmo com pouco espaço. Ela só sai daqui se você remover.'
          : p.iOS
            ? 'No iPhone/iPad, instale o app na Tela de Início: apps instalados não sofrem a limpeza automática de 7 dias do Safari. Faça backups completos periodicamente.'
            : 'Se o dispositivo ficar sem espaço, o navegador pode remover dados de sites. Solicite a persistência — instalar o app aumenta a chance de aprovação.')),
      !persisted && navigator.storage?.persist && button('Solicitar', {
        variant: 'primary', className: 'btn--sm',
        onClick: async () => {
          const ok = await requestPersistence({ force: true });
          toast(ok ? 'Armazenamento persistente concedido.' : 'O navegador não concedeu agora. Instale o app e use-o com frequência, depois tente de novo.');
          refresh();
        },
      }));

    const overview = h('section', { class: 'storage-card' },
      h('div', { class: 'storage-total' },
        h('div', {}, h('span', { class: 'storage-big' }, formatBytes(u.audio + u.covers)), h('span', { class: 'muted' }, ' usados pela biblioteca')),
        quota ? h('span', { class: 'muted small' }, `${formatBytes(free)} disponíveis (estimativa do navegador)`) : h('span', { class: 'muted small' }, 'Espaço disponível não informado por este navegador')),
      quota > 0 && h('div', { class: 'meter', role: 'img', 'aria-label': `Uso: ${formatBytes(used)} de ${formatBytes(quota)}` },
        meter('Áudio', u.audio, quota, 'seg-audio'),
        meter('Capas', u.covers, quota, 'seg-covers'),
        meter('App', appBytes, quota, 'seg-app'),
        meter('Outros', others, quota, 'seg-other')),
      h('dl', { class: 'storage-legend' },
        legend('seg-audio', 'Áudio dos livros', formatBytes(u.audio)),
        legend('seg-covers', 'Capas', formatBytes(u.covers)),
        legend('seg-app', 'Cache do app (interface)', cache ? `${formatBytes(appBytes)} · ${cache.files} arquivos` : '—'),
        quota > 0 && legend('seg-other', 'Dados e índices', formatBytes(others)),
        quota > 0 && legend('seg-free', 'Disponível', formatBytes(free))),
      h('div', { class: 'storage-counts' },
        h('div', {}, h('strong', {}, String(u.books)), h('span', {}, u.books === 1 ? 'audiolivro' : 'audiolivros')),
        h('div', {}, h('strong', {}, String(u.chapters)), h('span', {}, u.chapters === 1 ? 'capítulo' : 'capítulos')),
        h('div', {}, h('strong', {}, String(state.playlists.size)), h('span', {}, 'playlists'))));

    const cacheBox = h('section', { class: 'settings-group' },
      h('h2', { class: 'settings-title' }, 'Cache do aplicativo'),
      h('div', { class: 'settings-card pad' },
        h('p', { class: 'muted' }, 'O cache guarda apenas a interface (HTML, CSS, JavaScript, ícones) para o app abrir sem internet. Ele é separado da biblioteca: limpar o cache nunca apaga audiolivros.'),
        button('Limpar e recriar cache', {
          icon: 'refresh', variant: 'ghost',
          onClick: async () => {
            if (!navigator.onLine) return alertDialog({ title: 'Sem conexão', message: 'Para não deixar o app sem funcionar offline, o cache só é recriado com internet. Sua biblioteca não é afetada.' });
            try {
              const r = await swMessage({ type: 'REBUILD_CACHE' });
              if (r?.ok) toast('Cache do app recriado. Biblioteca intacta.', { tone: 'success' });
              else toast('Não foi possível baixar os arquivos agora; o cache anterior foi mantido.');
            } catch (err) {
              toast(err.message);
            }
            refresh();
          },
        })));

    const manage = h('section', { class: 'settings-group', id: 'gerenciar' },
      h('h2', { class: 'settings-title' }, 'Gerenciar biblioteca'),
      books.length
        ? h('div', { class: 'settings-card manage-list' },
            books.map((b) =>
              h('div', { class: 'manage-row' },
                coverEl(b, { size: 'xs' }),
                h('a', { class: 'manage-text', href: `#/livro/${encodeURIComponent(b.id)}` },
                  h('strong', {}, b.title),
                  h('span', { class: 'muted small' }, `${formatBytes((b.audioSize || 0) + (b.coverSize || 0))} · ${plural(b.chapterCount, 'capítulo', 'capítulos')} · ${formatDuration(b.totalDuration)}`)),
                h('button', {
                  type: 'button', class: 'icon-btn icon-btn--danger', 'aria-label': `Remover ${b.title}`, title: 'Remover',
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Remover audiolivro?',
                      message: `“${b.title}” (${formatBytes(b.audioSize)}) será apagado deste dispositivo, junto com progresso, marcadores e notas.`,
                      confirmLabel: 'Remover', danger: true,
                    });
                    if (ok) {
                      await repo.deleteBook(b.id);
                      toast('Audiolivro removido. Espaço liberado.');
                      refresh();
                    }
                  },
                }, icon('trash', 20)))))
        : emptyState({ icon: 'library', title: 'Biblioteca vazia', text: 'Nenhum audiolivro armazenado neste dispositivo.' }));

    root.replaceChildren(h('div', { class: 'page page-storage' },
      pageHeader({ title: 'Armazenamento', subtitle: 'Tudo fica no seu dispositivo (IndexedDB). Nada é apagado sem sua autorização.', back: () => back('/configuracoes') }),
      persistBox, overview, manage, cacheBox));
    if (query.gerenciar) requestAnimationFrame(() => document.getElementById('gerenciar')?.scrollIntoView({ block: 'start' }));
  }

  function legend(cls, label, value) {
    return h('div', { class: 'legend-item' }, h('dt', {}, h('span', { class: `dot ${cls}` }), label), h('dd', {}, value));
  }

  draw();
  refresh();
  const off = bus.on('library', () => draw());
  return () => off();
}

export { player };
