/* Tela de importação e edição de audiolivros.
 * Lê metadados e duração localmente, permite organizar capítulos e grava tudo no IndexedDB. */

import { h, iconButton, button, toast, confirmDialog, alertDialog, openModal, pickFiles } from '../ui.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import * as repo from '../repo.js';
import { navigate, back } from '../router.js';
import { pageHeader, segmented } from '../components.js';
import { readTags } from '../metadata.js';
import { probeAudio } from '../audio-probe.js';
import { prepareCover, generateCover, loadCoverURL, palette } from '../covers.js';
import { buildDemoDraft } from '../demo.js';
import { enableSortable } from '../sortable.js';
import { requestPersistence, takeInboxFiles } from '../pwa.js';
import {
  uid, isAudioFile, isImageFile, guessMime, cleanTitle, commonPrefix, naturalCompare, mapLimit,
  formatDuration, formatBytes, formatTime, parseTimestampList, plural, AUDIO_EXTENSIONS,
} from '../utils.js';

const ACCEPT_AUDIO = ['audio/*', ...AUDIO_EXTENSIONS.map((e) => `.${e}`)].join(',');
const supportsDirectory = () => 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Cria o livro de demonstração (áudio sintetizado localmente). */
export async function createDemoBook(btn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-loading');
  }
  try {
    const draft = await buildDemoDraft();
    const book = await repo.saveBookFromDraft(draft);
    requestPersistence();
    toast('Livro de demonstração criado e salvo no dispositivo.', { tone: 'success' });
    navigate(`/livro/${encodeURIComponent(book.id)}`);
  } catch (err) {
    alertDialog({ title: 'Não foi possível criar a demonstração', message: err.message || String(err) });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }
}

export default function importView(root, { params, query }) {
  const editId = params.id || null;
  const draft = {
    mode: editId ? 'edit' : 'create',
    bookId: editId,
    meta: { title: '', author: '', narrator: '', genre: '', year: '', synopsis: '' },
    cover: null, // { blob, color, generated, url }
    coverChanged: false,
    existingCoverUrl: null,
    files: new Map(),
    chapters: [],
    dirty: false,
  };
  let analyzing = null; // { done, total }
  let destroyed = false;
  let anyFile = false;

  /* ----------------------------- Arquivos ----------------------------- */

  async function addFiles(fileList, { replaceRow } = {}) {
    const list = [...fileList];
    const audio = list.filter(isAudioFile);
    const images = list.filter((f) => !isAudioFile(f) && isImageFile(f));
    const ignored = list.length - audio.length - images.length;
    if (ignored > 0) toast(`${plural(ignored, 'arquivo ignorado', 'arquivos ignorados')} (não é áudio).`);

    if (images.length && !draft.cover && draft.mode === 'create') {
      const pick = images.find((f) => /cover|capa|folder|front/i.test(f.name)) || images[0];
      await setCover(pick);
    }
    if (!audio.length) {
      if (!images.length) toast('Nenhum arquivo de áudio selecionado.', { tone: 'error' });
      render();
      return;
    }
    audio.sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));

    analyzing = { done: 0, total: audio.length };
    render();
    const results = await mapLimit(audio, 3, async (f) => {
      const [tags, probe] = await Promise.all([readTags(f), probeAudio(f)]);
      analyzing.done++;
      updateAnalyzing();
      return { f, tags, probe };
    });
    analyzing = null;
    if (destroyed) return;

    const first = draft.chapters.length === 0 && draft.mode === 'create';
    if (first && results.length > 1 && results.every((r) => Number.isFinite(r.tags.track))) {
      results.sort((a, b) => (a.tags.disc || 0) - (b.tags.disc || 0) || a.tags.track - b.tags.track);
    }

    const newRows = [];
    for (const r of results) {
      const key = uid('f_');
      const type = guessMime(r.f.name, r.f.type);
      draft.files.set(key, { blob: r.f, name: r.f.name, size: r.f.size, type, duration: r.probe.duration, playable: r.probe.playable, tags: r.tags });
      const base = { fileKey: key, fileName: r.f.name, fileSize: r.f.size, type, playable: r.probe.playable };
      const embedded = r.tags.chapters || [];
      if (embedded.length >= 2 && r.probe.duration > 0) {
        embedded.forEach((c, i) => {
          const end = embedded[i + 1]?.start ?? (c.end > c.start ? c.end : r.probe.duration);
          newRows.push({ ...base, key: uid('r_'), title: c.title || `Capítulo ${i + 1}`, start: c.start, duration: Math.max(0, Math.min(end, r.probe.duration) - c.start) });
        });
        toast(`${embedded.length} capítulos detectados em “${r.f.name}”.`);
      } else {
        const title = results.length > 1 && r.tags.title && r.tags.title !== r.tags.album ? r.tags.title : cleanTitle(r.f.name);
        newRows.push({ ...base, key: uid('r_'), title, start: 0, duration: r.probe.duration });
      }
    }

    if (replaceRow) {
      // Reimportar (vincular) arquivo a capítulos sem áudio local
      const target = draft.chapters.find((c) => c.key === replaceRow);
      const fileKey = newRows[0]?.fileKey;
      const f = draft.files.get(fileKey);
      if (target && f) {
        const group = target.audioId ? draft.chapters.filter((c) => c.audioId === target.audioId) : [target];
        for (const c of group) {
          c.fileKey = fileKey;
          c.audioId = null;
          c.missing = false;
          c.fileName = f.name;
          c.fileSize = f.size;
          c.type = f.type;
          c.playable = f.playable;
          if (group.length === 1 && f.duration > 0) c.duration = f.duration;
        }
        toast('Arquivo vinculado. Salve para gravá-lo no dispositivo.');
      }
    } else draft.chapters.push(...newRows);

    if (first) await autofill(results);
    draft.dirty = true;
    anyFile = true;
    render();
  }

  async function autofill(results) {
    const t = results[0]?.tags || {};
    const folder = (results[0]?.f.webkitRelativePath || '').split('/').filter(Boolean);
    const folderName = folder.length > 1 ? folder[folder.length - 2] : '';
    const m = draft.meta;
    const prefix = results.length > 1 ? commonPrefix(results.map((r) => r.f.name.replace(/\.[^.]+$/, ''))) : '';
    m.title ||= t.album || (results.length === 1 ? t.title : '') || folderName || (prefix.length > 2 ? prefix : '') || cleanTitle(results[0].f.name);
    m.author ||= t.albumArtist || t.artist || '';
    const narr = t.narrator || (t.composer && t.composer !== m.author ? t.composer : '');
    m.narrator ||= narr || '';
    m.genre ||= t.genre || '';
    m.year ||= t.year || '';
    if (!m.synopsis && t.comment && t.comment.length > 30) m.synopsis = t.comment;
    if (!draft.cover) {
      const withPic = results.find((r) => r.tags.picture);
      if (withPic) {
        try {
          await setCover(new Blob([withPic.tags.picture.data], { type: withPic.tags.picture.mime }), { silent: true });
        } catch {}
      }
    }
  }

  async function setCover(blob, { silent = false } = {}) {
    try {
      const prepared = await prepareCover(blob);
      if (draft.cover?.url) URL.revokeObjectURL(draft.cover.url);
      draft.cover = { ...prepared, generated: false, url: URL.createObjectURL(prepared.blob) };
      draft.coverChanged = true;
      draft.dirty = true;
      render();
    } catch (err) {
      if (!silent) toast('Não foi possível usar essa imagem como capa.', { tone: 'error' });
    }
  }

  /* ---------------------------- Capítulos ---------------------------- */

  const move = (from, to) => {
    if (to < 0 || to >= draft.chapters.length) return;
    const [c] = draft.chapters.splice(from, 1);
    draft.chapters.splice(to, 0, c);
    draft.dirty = true;
    renderChapters();
  };

  const sorters = {
    name: () => draft.chapters.sort((a, b) => naturalCompare(a.fileName, b.fileName) || a.start - b.start),
    track: () =>
      draft.chapters.sort((a, b) => {
        const ta = draft.files.get(a.fileKey)?.tags?.track ?? Infinity;
        const tb = draft.files.get(b.fileKey)?.tags?.track ?? Infinity;
        return ta - tb || naturalCompare(a.fileName, b.fileName) || a.start - b.start;
      }),
    reverse: () => draft.chapters.reverse(),
    numbered: () => draft.chapters.forEach((c, i) => (c.title = `Capítulo ${i + 1}`)),
    filenames: () => draft.chapters.forEach((c) => c.start === 0 && (c.title = cleanTitle(c.fileName))),
  };

  function openSplit(row) {
    const total = row.duration;
    if (!(total > 0)) return toast('A duração deste arquivo é desconhecida; não é possível dividi-lo.', { tone: 'error' });
    let mode = 'marks';
    const minutes = h('input', { class: 'input', type: 'number', min: '1', max: '600', value: total > 3600 ? '30' : '10', inputmode: 'numeric' });
    const marks = h('textarea', { class: 'input mono', rows: '7', placeholder: '00:00 Introdução\n05:32 Capítulo 1\n1:02:10 Capítulo 2' });
    const preview = h('p', { class: 'muted small' });
    const body = h('div', { class: 'sheet-stack' });

    const compute = () => {
      if (mode === 'interval') {
        const step = Math.max(60, Number(minutes.value) * 60 || 600);
        const out = [];
        for (let s = 0, k = 1; s < total - 1; s += step, k++) out.push({ start: s, title: `${row.title} — Parte ${k}` });
        return out;
      }
      const list = parseTimestampList(marks.value).filter((m) => m.start < total);
      if (list.length && list[0].start > 0.5) list.unshift({ start: 0, title: 'Início' });
      return list.map((m, i) => ({ start: m.start, title: m.title || `Capítulo ${i + 1}` }));
    };
    const update = () => {
      const segs = compute();
      preview.textContent = segs.length > 1 ? `Resultado: ${segs.length} capítulos.` : 'Informe pelo menos duas marcações de tempo.';
    };
    const draw = () => {
      body.replaceChildren(
        h('p', { class: 'muted small' }, `${row.fileName} · ${formatTime(total)}. Divida um arquivo longo (como um .m4b ou .mp3 único) em capítulos.`),
        segmented([{ value: 'marks', label: 'Marcações de tempo' }, { value: 'interval', label: 'Intervalo fixo' }], mode, (v) => { mode = v; draw(); }),
        mode === 'interval'
          ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Duração de cada parte (minutos)'), minutes)
          : h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Uma linha por capítulo: tempo e título'), marks),
        preview,
      );
      update();
    };
    minutes.addEventListener('input', update);
    marks.addEventListener('input', update);
    draw();
    const m = openModal({
      title: 'Dividir em capítulos',
      content: body,
      actions: [
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => m.close() }, 'Cancelar'),
        h('button', {
          type: 'button', class: 'btn btn--primary',
          onClick: () => {
            const segs = compute();
            if (segs.length < 2) return toast('São necessárias pelo menos duas partes.', { tone: 'error' });
            const idx = draft.chapters.indexOf(row);
            const base = row.start || 0;
            const rows = segs.map((s, i) => ({
              ...row,
              key: uid('r_'),
              id: undefined,
              title: s.title,
              start: base + s.start,
              duration: (segs[i + 1]?.start ?? total) - s.start,
            }));
            draft.chapters.splice(idx, 1, ...rows);
            draft.dirty = true;
            m.close();
            renderChapters();
            toast(`Arquivo dividido em ${rows.length} capítulos.`);
          },
        }, icon('scissors', 18), 'Dividir'),
      ],
    });
  }

  /* ------------------------------ Render ------------------------------ */

  const chaptersEl = h('div', { class: 'chapter-editor' });
  const analyzingEl = h('div', { class: 'analyzing', role: 'status', 'aria-live': 'polite' });

  function updateAnalyzing() {
    if (!analyzing) return;
    const pct = Math.round((analyzing.done / analyzing.total) * 100);
    analyzingEl.replaceChildren(
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('div', { class: 'analyzing-text' },
        h('strong', {}, `Analisando arquivos… ${analyzing.done}/${analyzing.total}`),
        h('span', { class: 'muted small' }, 'Lendo duração, capítulos, tags e capa — tudo no dispositivo.'),
        h('div', { class: 'bar' }, h('span', { style: { width: `${pct}%` } }))),
    );
  }

  function renderChapters() {
    const rows = draft.chapters;
    const totalDur = rows.reduce((s, c) => s + (c.duration || 0), 0);
    const sizes = new Map();
    rows.forEach((c) => sizes.set(c.fileKey || c.audioId, c.fileSize || 0));
    const totalSize = [...sizes.values()].reduce((a, b) => a + b, 0);

    const list = h('ol', { class: 'editor-list sortable' },
      rows.map((c, i) => {
        const warn = c.missing
          ? h('span', { class: 'warn' }, icon('alert', 14), 'Áudio ausente neste dispositivo')
          : c.playable === false
            ? h('span', { class: 'warn' }, icon('alert', 14), 'Formato não suportado neste navegador')
            : c.fileKey && draft.mode === 'edit'
              ? h('span', { class: 'ok' }, 'Novo — será gravado ao salvar')
              : null;
        const titleInput = h('input', {
          class: 'input input--inline', type: 'text', value: c.title, 'aria-label': `Título do capítulo ${i + 1}`,
          onInput: (e) => { c.title = e.target.value; draft.dirty = true; },
        });
        return h('li', { class: `editor-row sortable-item ${c.missing ? 'is-missing' : ''}`, 'data-index': String(i) },
          h('span', { class: 'drag-handle', 'data-drag-handle': '', title: 'Arraste para reordenar' }, icon('grip', 20)),
          h('span', { class: 'editor-num' }, String(i + 1)),
          h('div', { class: 'editor-main' },
            titleInput,
            h('p', { class: 'editor-meta' },
              h('span', {}, c.duration > 0 ? formatDuration(c.duration) : 'duração desconhecida'),
              c.start > 0 && h('span', {}, `início ${formatTime(c.start)}`),
              h('span', { class: 'ellipsis', title: c.fileName }, c.fileName),
              c.fileSize > 0 && h('span', {}, formatBytes(c.fileSize)),
              warn)),
          h('div', { class: 'editor-actions' },
            c.missing && iconButton('upload', 'Vincular arquivo', async () => {
              const files = await pickFiles({ accept: anyFile ? '' : ACCEPT_AUDIO });
              if (files.length) addFiles(files.slice(0, 1), { replaceRow: c.key });
            }, { size: 18, className: 'icon-btn--accent' }),
            iconButton('arrowUp', 'Mover para cima', () => move(i, i - 1), { size: 18, attrs: { disabled: i === 0 } }),
            iconButton('arrowDown', 'Mover para baixo', () => move(i, i + 1), { size: 18, attrs: { disabled: i === rows.length - 1 } }),
            iconButton('scissors', 'Dividir em capítulos', () => openSplit(c), { size: 18 }),
            iconButton('x', 'Remover capítulo', () => {
              draft.chapters.splice(i, 1);
              draft.dirty = true;
              renderChapters();
            }, { size: 18 })));
      }));
    enableSortable(list, (from, to) => move(from, to));

    chaptersEl.replaceChildren(
      h('div', { class: 'section-header' },
        h('h2', { class: 'section-title' }, 'Capítulos', h('span', { class: 'section-count' }, rows.length)),
        h('span', { class: 'muted small' }, `${formatDuration(totalDur)} · ${formatBytes(totalSize)}`)),
      h('div', { class: 'editor-toolbar' },
        button('Adicionar arquivos', { icon: 'plus', variant: 'ghost', onClick: chooseAudio }),
        h('label', { class: 'select-wrap' }, icon('sort', 18),
          h('select', {
            class: 'select', 'aria-label': 'Organizar capítulos',
            onChange: (e) => {
              const v = e.target.value;
              e.target.value = '';
              if (sorters[v]) {
                sorters[v]();
                draft.dirty = true;
                renderChapters();
              }
            },
          },
          h('option', { value: '' }, 'Organizar…'),
          h('option', { value: 'name' }, 'Ordenar por nome do arquivo'),
          h('option', { value: 'track' }, 'Ordenar por nº da faixa (tags)'),
          h('option', { value: 'reverse' }, 'Inverter ordem'),
          h('option', { value: 'numbered' }, 'Renomear: Capítulo 1, 2, 3…'),
          h('option', { value: 'filenames' }, 'Usar nomes dos arquivos como títulos')))),
      rows.length
        ? list
        : h('p', { class: 'muted empty-inline' }, icon('music', 20), 'Nenhum capítulo. Adicione arquivos de áudio.'),
      rows.length > 0 && h('p', { class: 'muted small hint' }, icon('grip', 16), 'Arraste pela alça ou use as setas para definir a ordem. A tesoura divide um arquivo longo em vários capítulos.'),
    );
  }

  function field(label, key, { type = 'text', required, list, multiline, placeholder, inputmode } = {}) {
    const attrs = {
      class: 'input', placeholder, value: draft.meta[key], inputmode,
      onInput: (e) => { draft.meta[key] = e.target.value; draft.dirty = true; },
    };
    const input = multiline ? h('textarea', { ...attrs, rows: '5' }, draft.meta[key]) : h('input', { ...attrs, type, list, required, name: key });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), input);
  }

  function coverEditor() {
    const pal = palette(draft.meta.title + draft.meta.author);
    const url = draft.cover?.url || (!draft.coverChanged ? draft.existingCoverUrl : null);
    return h('div', { class: 'cover-editor' },
      h('div', { class: 'cover cover--lg', style: { '--c1': pal.a, '--c2': pal.b } },
        url ? h('img', { src: url, alt: 'Capa' }) : h('div', { class: 'cover-fallback cover-fallback--big' }, icon('image', 34), h('small', {}, 'Capa automática'))),
      h('div', { class: 'cover-editor-actions' },
        button(url ? 'Trocar capa' : 'Escolher capa', {
          icon: 'image', variant: 'ghost',
          onClick: async () => {
            const [f] = await pickFiles({ accept: 'image/*' });
            if (f) setCover(f);
          },
        }),
        url && button('Remover', {
          icon: 'x', variant: 'ghost',
          onClick: () => {
            if (draft.cover?.url) URL.revokeObjectURL(draft.cover.url);
            draft.cover = null;
            draft.coverChanged = true;
            draft.existingCoverUrl = null;
            draft.dirty = true;
            render();
          },
        }),
        h('p', { class: 'muted small' }, 'Sem imagem? Uma capa elegante é gerada com o título.')));
  }

  async function chooseAudio() {
    const files = await pickFiles({ accept: ACCEPT_AUDIO, multiple: true });
    if (files.length) addFiles(files);
  }
  async function chooseAnyFile() {
    const files = await pickFiles({ multiple: true });
    if (files.length) addFiles(files);
  }
  async function chooseFolder() {
    const files = await pickFiles({ directory: true, multiple: true });
    if (files.length) addFiles(files);
  }

  function dropzone() {
    const zone = h('div', { class: 'dropzone' },
      h('div', { class: 'dropzone-icon' }, icon('upload', 36)),
      h('h2', {}, 'Selecione os arquivos do audiolivro'),
      h('p', { class: 'muted' }, 'Escolha um ou vários arquivos de áudio (MP3, M4A, M4B, AAC, OGG, OPUS, WAV, FLAC…). Vários arquivos viram capítulos de um mesmo livro.'),
      h('div', { class: 'dropzone-actions' },
        button('Selecionar arquivos de áudio', { icon: 'music', variant: 'primary', onClick: chooseAudio }),
        supportsDirectory() && button('Selecionar pasta', { icon: 'folder', variant: 'ghost', onClick: chooseFolder })),
      h('p', { class: 'small muted' }, 'Arquivo não aparece na lista? ', h('button', { type: 'button', class: 'link-btn', onClick: chooseAnyFile }, 'Mostrar todos os arquivos')),
      h('p', { class: 'small muted desktop-only' }, 'Você também pode arrastar e soltar arquivos aqui.'));
    return zone;
  }

  function render() {
    if (destroyed) return;
    const isEdit = draft.mode === 'edit';
    const header = pageHeader({
      eyebrow: isEdit ? 'Editar' : 'Importar',
      title: isEdit ? draft.meta.title || 'Audiolivro' : 'Novo audiolivro',
      subtitle: isEdit ? 'Altere informações, capa e capítulos.' : 'Os arquivos são copiados para o armazenamento local e funcionam offline.',
      back: () => cancel(),
    });

    if (analyzing) {
      updateAnalyzing();
      root.replaceChildren(h('div', { class: 'page page-import' }, header, analyzingEl));
      return;
    }

    if (!isEdit && !draft.chapters.length) {
      root.replaceChildren(h('div', { class: 'page page-import' }, header,
        h('a', { class: 'link-card link-card--accent', href: '#/converter' },
          icon('bookOpen', 26),
          h('span', {}, h('strong', {}, 'Tem um ebook? Transforme em audiolivro'), h('small', {}, 'EPUB, PDF ou TXT lidos por uma voz neural em português, gravados no aparelho.')),
          icon('chevronRight', 18)),
        dropzone(),
        h('section', { class: 'import-help' },
          h('h2', { class: 'section-title' }, 'Sem arquivos para testar?'),
          h('p', { class: 'muted' }, 'Crie um audiolivro de demonstração gerado no próprio dispositivo (áudio sintetizado, livre de direitos autorais) para testar capítulos, temporizador e reprodução com a tela bloqueada.'),
          button('Criar livro de demonstração', { icon: 'sparkles', variant: 'ghost', onClick: (e) => createDemoBook(e.currentTarget) })),
        h('section', { class: 'import-help' },
          h('h2', { class: 'section-title' }, 'Dicas'),
          h('ul', { class: 'tips' },
            h('li', {}, 'Audiolivros em domínio público (ex.: LibriVox) podem ser baixados e importados aqui.'),
            h('li', {}, 'No iPhone, os arquivos vêm do app Arquivos. Salve-os lá antes (iCloud Drive ou “No meu iPhone”).'),
            h('li', {}, 'No Android instalado, você pode usar “Compartilhar › AUDIOBOOK” a partir do gerenciador de arquivos.'),
            h('li', {}, 'Arquivos únicos longos (.m4b) com capítulos embutidos são divididos automaticamente.')))));
      return;
    }

    renderChapters();
    const genres = repo.genres();
    root.replaceChildren(h('div', { class: 'page page-import' },
      header,
      h('form', { class: 'import-form', onSubmit: (e) => { e.preventDefault(); save(); } },
        h('div', { class: 'import-grid' },
          h('section', { class: 'import-meta' },
            coverEditor(),
            h('div', { class: 'fields' },
              field('Título', 'title', { required: true, placeholder: 'Título do livro' }),
              field('Autor', 'author', { placeholder: 'Nome do autor' }),
              field('Narrador', 'narrator', { placeholder: 'Quem lê o livro' }),
              h('div', { class: 'field-row' },
                field('Gênero', 'genre', { list: 'genre-list', placeholder: 'Ex.: Romance' }),
                field('Ano', 'year', { inputmode: 'numeric', placeholder: 'Ex.: 1899' })),
              h('datalist', { id: 'genre-list' }, [...new Set([...genres, 'Romance', 'Fantasia', 'Ficção científica', 'Suspense', 'Biografia', 'História', 'Autoajuda', 'Negócios', 'Poesia', 'Infantil', 'Clássicos', 'Não ficção'])].map((g) => h('option', { value: g }))),
              field('Sinopse', 'synopsis', { multiline: true, placeholder: 'Sobre o que é o livro?' }))),
          h('section', { class: 'import-chapters' }, chaptersEl)),
        h('div', { class: 'form-footer' },
          h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => cancel() }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn btn--primary btn--lg' }, icon('download', 20), h('span', {}, isEdit ? 'Salvar alterações' : 'Salvar na biblioteca'))))));
  }

  async function cancel() {
    if (draft.dirty && !(await confirmDialog({ title: 'Descartar alterações?', message: 'As alterações feitas nesta tela serão perdidas.', confirmLabel: 'Descartar', danger: true }))) return;
    draft.dirty = false;
    back(editId ? `/livro/${encodeURIComponent(editId)}` : '/inicio');
  }

  async function save() {
    if (!draft.chapters.length) return toast('Adicione pelo menos um arquivo de áudio.', { tone: 'error' });
    const title = draft.meta.title.trim();
    if (!title) {
      root.querySelector('input[name="title"]')?.focus();
      return toast('Informe o título do livro.', { tone: 'error' });
    }
    const missing = draft.chapters.filter((c) => c.missing);
    if (missing.length && !(await confirmDialog({ title: 'Há capítulos sem áudio', message: `${plural(missing.length, 'capítulo continua', 'capítulos continuam')} sem arquivo neste dispositivo e não tocarão offline. Salvar mesmo assim?`, confirmLabel: 'Salvar' }))) return;
    const unsupported = draft.chapters.filter((c) => c.playable === false);
    if (unsupported.length && !(await confirmDialog({ title: 'Formato não suportado', message: `${plural(unsupported.length, 'arquivo parece', 'arquivos parecem')} não ser reproduzível neste navegador. Eles serão salvos, mas podem não tocar aqui. Continuar?`, confirmLabel: 'Salvar mesmo assim' }))) return;

    const book = draft.bookId ? repo.getBook(draft.bookId) : null;
    let cover;
    if (draft.coverChanged && draft.cover) cover = draft.cover;
    else if (!book || (draft.coverChanged && !draft.cover) || (book.coverGenerated && (book.title !== title || book.author !== draft.meta.author.trim()))) {
      cover = await generateCover({ title, author: draft.meta.author.trim() });
    }

    const overlay = h('div', { class: 'busy-overlay', role: 'alertdialog', 'aria-live': 'assertive', 'aria-label': 'Salvando' });
    const text = h('p', {}, 'Preparando…');
    const bar = h('span', { style: { width: '0%' } });
    overlay.append(h('div', { class: 'busy-card' }, h('div', { class: 'spinner' }), h('h2', {}, 'Salvando no dispositivo'), text, h('div', { class: 'bar' }, bar),
      h('p', { class: 'muted small' }, 'Não feche o app até terminar. Arquivos grandes podem levar alguns instantes.')));
    document.body.append(overlay);
    try {
      const saved = await repo.saveBookFromDraft(
        {
          bookId: draft.bookId,
          meta: draft.meta,
          cover,
          files: draft.files,
          chapters: draft.chapters.map((c) => ({
            id: c.id, title: c.title, audioId: c.fileKey ? null : c.audioId, fileKey: c.fileKey, start: c.start, duration: c.duration,
            fileName: c.fileName, fileSize: c.fileSize, type: c.type,
          })),
        },
        (p) => {
          if (p.phase === 'audio') {
            const pct = p.totalBytes ? (p.bytes / p.totalBytes) * 100 : 100;
            bar.style.width = `${pct}%`;
            text.textContent = p.index < p.total ? `Gravando arquivo ${p.index + 1} de ${p.total}: ${p.name}` : 'Arquivos gravados.';
          } else if (p.phase === 'finalize') text.textContent = 'Organizando capítulos…';
          else if (p.phase === 'verify') text.textContent = 'Verificando disponibilidade offline…';
        },
      );
      draft.dirty = false;
      requestPersistence();
      toast(`“${saved.title}” salvo no dispositivo — disponível offline.`, { tone: 'success' });
      navigate(`/livro/${encodeURIComponent(saved.id)}`, { replace: true });
    } catch (err) {
      console.error(err);
      alertDialog({ title: 'Não foi possível salvar', message: err.message || String(err) });
    } finally {
      overlay.remove();
    }
  }

  /* --------------------------- Inicialização --------------------------- */

  async function init() {
    if (editId) {
      const book = repo.getBook(editId);
      if (!book) {
        navigate('/biblioteca', { replace: true });
        return;
      }
      draft.meta = { title: book.title, author: book.author || '', narrator: book.narrator || '', genre: book.genre || '', year: book.year || '', synopsis: book.synopsis || '' };
      const [chapters, v, coverUrl] = await Promise.all([repo.getChapters(editId), repo.verifyBookAudio(editId), loadCoverURL(editId)]);
      const missing = new Set(v.missingChapterIds);
      draft.existingCoverUrl = book.coverGenerated ? null : coverUrl;
      draft.chapters = chapters.map((c) => ({
        key: uid('r_'), id: c.id, title: c.title, audioId: c.audioId, start: c.start || 0, duration: c.duration || 0,
        fileName: c.fileName, fileSize: c.fileSize, type: c.type, missing: missing.has(c.id),
      }));
    }
    render();
    const pending = state.pendingImportFiles;
    state.pendingImportFiles = null;
    if (pending?.length) addFiles(pending);
    else if (query.compartilhado) {
      const files = await takeInboxFiles();
      if (files.length) addFiles(files);
    }
  }

  // Arrastar e soltar (computador)
  const onDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      root.classList.add('is-dragover');
    }
  };
  const onDragLeave = (e) => {
    if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('is-dragover');
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    root.classList.remove('is-dragover');
    addFiles(e.dataTransfer.files);
  };
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  const onBeforeUnload = (e) => {
    if (draft.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  init();
  return () => {
    destroyed = true;
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
    root.classList.remove('is-dragover');
    window.removeEventListener('beforeunload', onBeforeUnload);
    if (draft.cover?.url) URL.revokeObjectURL(draft.cover.url);
  };
}
