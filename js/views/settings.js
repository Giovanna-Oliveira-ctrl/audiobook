import { h, toast, confirmDialog, alertDialog, promptDialog, pickFiles } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus, SPEEDS, SLEEP_OPTIONS } from '../state.js';
import * as repo from '../repo.js';
import { pageHeader, segmented, switchRow, linkRow } from '../components.js';
import { exportJSON, exportFull, importBackup } from '../backup.js';
import { checkForUpdate, appVersion, applyUpdate, isStandalone } from '../pwa.js';
import { applyTheme } from '../theme.js';
import { formatBytes, plural } from '../utils.js';
import { fmtRate } from '../sheets.js';
import { navigate } from '../router.js';

function selectRow({ label, description, icon: ic, value, options, onChange }) {
  return h('label', { class: 'setting-row select-row' },
    ic && h('span', { class: 'setting-icon' }, icon(ic, 20)),
    h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, label), description && h('span', { class: 'setting-desc' }, description)),
    h('select', { class: 'select select--compact', 'aria-label': label, onChange: (e) => onChange(e.target.value) },
      options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label))));
}

function group(title, ...rows) {
  return h('section', { class: 'settings-group' }, h('h2', { class: 'settings-title' }, title), h('div', { class: 'settings-card' }, rows.filter(Boolean)));
}

function busy(label) {
  const overlay = h('div', { class: 'busy-overlay', role: 'alertdialog', 'aria-label': label });
  const text = h('p', {}, label);
  overlay.append(h('div', { class: 'busy-card' }, h('div', { class: 'spinner' }), text));
  document.body.append(overlay);
  return { set: (t) => (text.textContent = t), close: () => overlay.remove() };
}

export default function settings(root) {
  let version = null;
  appVersion().then((v) => {
    version = v;
    const el = root.querySelector('[data-version]');
    if (el) el.textContent = v || 'sem Service Worker';
  });

  const draw = () => {
    const s = state.settings;
    const usage = repo.libraryUsage();
    root.replaceChildren(h('div', { class: 'page page-settings' },
      pageHeader({ title: 'Configurações' }),

      group('Perfil',
        linkRow({
          label: 'Seu nome', description: s.name || 'Usado na saudação da tela inicial', icon: 'user',
          onClick: async () => {
            const name = await promptDialog({ title: 'Como devemos chamar você?', value: s.name, placeholder: 'Seu nome', maxLength: 40 });
            if (name != null) repo.updateSettings({ name: name.trim() });
          },
        })),

      group('Aparência',
        h('div', { class: 'setting-row setting-row--stack' },
          h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, 'Tema'), h('span', { class: 'setting-desc' }, 'O tema escuro usa tons quentes e baixo brilho para leitura noturna.')),
          segmented(
            [{ value: 'light', label: 'Claro', icon: 'sun' }, { value: 'dark', label: 'Escuro', icon: 'moon' }, { value: 'auto', label: 'Automático', icon: 'auto' }],
            s.theme,
            (v) => { repo.updateSettings({ theme: v }); applyTheme(v); },
            { label: 'Tema' },
          ))),

      group('Reprodução',
        selectRow({
          label: 'Velocidade padrão', description: 'Usada em livros que você ainda não ouviu', icon: 'speed', value: s.defaultSpeed,
          options: SPEEDS.map((v) => ({ value: v, label: fmtRate(v) })), onChange: (v) => repo.updateSettings({ defaultSpeed: Number(v) }),
        }),
        selectRow({
          label: 'Temporizador padrão', description: 'Ativado automaticamente ao iniciar a reprodução', icon: 'moon', value: s.defaultSleep,
          options: [{ value: 0, label: 'Desligado' }, ...SLEEP_OPTIONS],
          onChange: (v) => repo.updateSettings({ defaultSleep: v === 'chapter' ? 'chapter' : Number(v) }),
        }),
        switchRow({ label: 'Salvar progresso automaticamente', description: 'A cada 5 segundos durante a reprodução. Desligado: salva só ao pausar, trocar de capítulo ou sair.', icon: 'checkCircle', checked: s.autosave, onChange: (v) => repo.updateSettings({ autosave: v }) }),
        switchRow({ label: 'Próximo capítulo automático', description: 'Ao terminar um capítulo, o seguinte começa sozinho', icon: 'next', checked: s.autoplayNext, onChange: (v) => repo.updateSettings({ autoplayNext: v }) }),
        switchRow({ label: 'Retrocesso inteligente', description: 'Volta alguns segundos ao retomar após uma pausa longa', icon: 'back15', checked: s.smartRewind, onChange: (v) => repo.updateSettings({ smartRewind: v }) }),
        switchRow({ label: 'Retomar último livro ao abrir', description: 'Carrega o player pausado no ponto onde você parou', icon: 'headphones', checked: s.autoResume, onChange: (v) => repo.updateSettings({ autoResume: v }) })),

      group('Biblioteca e armazenamento',
        linkRow({ label: 'Armazenamento', description: `${formatBytes(usage.audio + usage.covers)} em ${plural(usage.books, 'livro', 'livros')} · espaço disponível e cache`, icon: 'storage', href: '#/armazenamento' }),
        linkRow({ label: 'Gerenciar biblioteca', description: 'Remover audiolivros e liberar espaço', icon: 'library', href: '#/armazenamento?gerenciar=1' }),
        linkRow({ label: 'Playlists', icon: 'playlist', href: '#/biblioteca?aba=playlists' }),
        linkRow({ label: 'Estatísticas de audição', icon: 'chart', href: '#/estatisticas' })),

      group('Backup e dados',
        linkRow({
          label: 'Exportar dados (JSON)', description: 'Progresso, marcadores, notas, playlists e capas — sem os áudios', icon: 'download',
          onClick: async () => {
            try {
              const size = await exportJSON();
              toast(`Dados exportados (${formatBytes(size)}).`);
            } catch (err) {
              alertDialog({ title: 'Falha ao exportar', message: err.message });
            }
          },
        }),
        linkRow({
          label: 'Backup completo (com áudio)', description: `Um único arquivo .audiobook com tudo (≈ ${formatBytes(usage.audio + usage.covers)})`, icon: 'layers',
          onClick: async () => {
            if (!usage.books) return toast('Sua biblioteca está vazia.');
            const b = busy('Montando backup…');
            try {
              const size = await exportFull((p) => b.set(`Preparando ${p.index + 1}/${p.total}: ${p.title}`));
              b.close();
              toast(`Backup gerado (${formatBytes(size)}). Guarde-o em local seguro.`, { tone: 'success' });
            } catch (err) {
              b.close();
              alertDialog({ title: 'Falha no backup', message: err.message });
            }
          },
        }),
        linkRow({
          label: 'Importar dados ou backup', description: 'Arquivo .json ou .audiobook — mescla com a biblioteca atual', icon: 'upload',
          onClick: async () => {
            const [file] = await pickFiles({ accept: '.json,.audiobook,application/json,application/octet-stream' });
            if (!file) return;
            if (!(await confirmDialog({ title: 'Importar dados?', message: `“${file.name}” será mesclado com sua biblioteca. Itens com o mesmo identificador serão substituídos pelos do arquivo.`, confirmLabel: 'Importar' }))) return;
            const b = busy('Importando…');
            let r;
            try {
              r = await importBackup(file, (p) => b.set(`Gravando áudio ${p.index + 1}/${p.total}…`));
            } catch (err) {
              b.close();
              return alertDialog({ title: 'Falha ao importar', message: err.message });
            }
            b.close();
            await alertDialog({
              title: 'Importação concluída',
              message: `${plural(r.books, 'livro importado', 'livros importados')}.${r.missing ? ` ${plural(r.missing, 'livro está', 'livros estão')} sem áudio neste dispositivo — abra o livro e use “Reimportar” para adicionar os arquivos.` : ''}`,
            });
          },
        }),
        linkRow({
          label: 'Limpar histórico', description: 'Mantém progresso, marcadores e estatísticas', icon: 'history',
          onClick: async () => {
            if (await confirmDialog({ title: 'Limpar histórico?', message: 'A lista de livros ouvidos será apagada.', confirmLabel: 'Limpar', danger: true })) {
              await repo.clearHistory();
              toast('Histórico limpo.');
            }
          },
        }),
        linkRow({
          label: 'Restaurar configurações', description: 'Volta tema, velocidade e preferências ao padrão (a biblioteca não é afetada)', icon: 'rotate',
          onClick: async () => {
            if (await confirmDialog({ title: 'Restaurar configurações?', message: 'Todas as preferências voltarão ao padrão. Seus livros, progresso e marcadores são mantidos.', confirmLabel: 'Restaurar' })) {
              await repo.resetSettings();
              applyTheme(state.settings.theme);
              toast('Configurações restauradas.');
            }
          },
        }),
        linkRow({
          label: 'Apagar todos os dados', description: 'Remove livros, áudios, progresso e configurações deste dispositivo', icon: 'trash', danger: true,
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Apagar TODOS os dados?', message: `Isso remove ${plural(usage.books, 'audiolivro', 'audiolivros')} (${formatBytes(usage.audio)}), progresso, marcadores, notas, playlists e estatísticas deste dispositivo. Não pode ser desfeito.`, confirmLabel: 'Continuar', danger: true }))) return;
            const typed = await promptDialog({ title: 'Confirme digitando APAGAR', placeholder: 'APAGAR', confirmLabel: 'Apagar tudo' });
            if (typed?.trim().toUpperCase() !== 'APAGAR') return toast('Nada foi apagado.');
            await repo.deleteAllData();
            applyTheme(state.settings.theme);
            toast('Todos os dados foram apagados.');
            navigate('/inicio', { replace: true });
          },
        })),

      group('Aplicativo',
        linkRow({ label: isStandalone() ? 'App instalado' : 'Instalar app', description: 'Instruções para Android, iPhone/iPad e computador, e limitações de cada sistema', icon: 'phone', href: '#/instalar' }),
        linkRow({
          label: 'Verificar atualização', description: 'Atualizações nunca apagam sua biblioteca', icon: 'refresh',
          onClick: async () => {
            const r = await checkForUpdate().catch(() => 'error');
            if (r === 'available') toast('Nova versão encontrada.', { action: { label: 'Atualizar', onClick: () => applyUpdate() }, duration: 15000 });
            else if (r === 'current') toast('Você está na versão mais recente.');
            else if (r === 'offline') toast('Sem conexão. Tudo continua funcionando offline; verifique depois.');
            else toast('Não foi possível verificar agora.');
          },
        }),
        h('div', { class: 'setting-row' },
          h('span', { class: 'setting-icon' }, icon('info', 20)),
          h('span', { class: 'setting-text' }, h('span', { class: 'setting-label' }, 'Versão'), h('span', { class: 'setting-desc', 'data-version': '' }, version || '…'))))));
  };
  draw();
  const offs = [bus.on('settings', draw), bus.on('library', draw)];
  return () => offs.forEach((o) => o());
}
