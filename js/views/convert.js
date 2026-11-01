/* Converter ebook em audiolivro (#/converter) e acompanhar conversões (#/conversoes). */

import { h, button, iconButton, toast, confirmDialog, alertDialog, pickFiles } from '../ui.js';
import { icon } from '../icons.js';
import { state, bus } from '../state.js';
import * as repo from '../repo.js';
import { player } from '../player.js';
import { navigate, back } from '../router.js';
import { pageHeader, emptyState, segmented, coverEl } from '../components.js';
import { parseEbook, EBOOK_ACCEPT, estimateSeconds } from '../ebook/parse.js';
import { listVoices, engineStatus, prepareEngine, downloadVoice, importVoiceFiles, sampleVoice, ENGINE_SIZE_MB } from '../tts/engine.js';
import { createConversion, allJobs, jobStats, pauseConversion, resumeConversion, cancelConversion, removeConversion } from '../conversion.js';
import { palette } from '../covers.js';
import { formatDuration, formatBytes, plural, debounce } from '../utils.js';

const SPEEDS = [
  { value: 1.15, label: 'Calma' },
  { value: 1, label: 'Normal' },
  { value: 0.88, label: 'Ágil' },
];

function progressOverlay(title) {
  const ctrl = new AbortController();
  const text = h('p', {}, 'Preparando…');
  const bar = h('span', { style: { width: '0%' } });
  const el = h('div', { class: 'busy-overlay', role: 'alertdialog', 'aria-label': title },
    h('div', { class: 'busy-card' },
      h('div', { class: 'spinner' }),
      h('h2', {}, title),
      text,
      h('div', { class: 'bar' }, bar),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => ctrl.abort() }, 'Cancelar')));
  document.body.append(el);
  return {
    signal: ctrl.signal,
    set(msg, fraction) {
      text.textContent = msg;
      if (fraction != null) bar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    },
    close: () => el.remove(),
  };
}

/** Garante motor + voz no aparelho (baixa o que faltar, com progresso). */
export async function ensureVoiceDownloaded(voice) {
  const eng = await engineStatus();
  if (eng.cached && voice.downloaded) return true;
  if (voice.custom && !voice.downloaded) throw new Error('Voz importada não encontrada.');
  const sizes = [];
  if (!eng.cached) sizes.push(`motor de voz (≈ ${ENGINE_SIZE_MB} MB)`);
  if (!voice.downloaded) sizes.push(`voz ${voice.name} (≈ ${voice.sizeMB} MB)`);
  const ok = await confirmDialog({
    title: 'Baixar a voz para o aparelho?',
    message: `Uma única vez será necessário baixar: ${sizes.join(' e ')}. Depois disso, a conversão funciona offline, inclusive em modo avião. Use Wi-Fi se possível.`,
    confirmLabel: 'Baixar agora',
  });
  if (!ok) return false;
  const ov = progressOverlay('Baixando a voz');
  try {
    if (!eng.cached) {
      await prepareEngine((p) => ov.set(`Motor de voz: ${formatBytes(p.loaded)} de ≈ ${formatBytes(p.total)}`, p.loaded / p.total), ov.signal);
    }
    if (!voice.downloaded) {
      await downloadVoice(voice.id, (p) => ov.set(`Voz ${voice.name}: ${formatBytes(p.loaded)} de ${formatBytes(p.total)}`, p.loaded / p.total), ov.signal);
    }
    toast('Voz pronta e disponível offline.', { tone: 'success' });
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') alertDialog({ title: 'Não foi possível baixar', message: err.message });
    return false;
  } finally {
    ov.close();
  }
}

/* ===================================================================== */
/* #/converter                                                            */
/* ===================================================================== */

export default function convertView(root) {
  let stage = 'pick';
  let parsed = null;
  let sourceName = '';
  let coverUrl = null;
  let voices = [];
  let engineReady = false;
  let voiceId = state.settings.ttsVoice || 'pt_BR-faber-medium';
  let lengthScale = state.settings.ttsLengthScale || 1;
  let destroyed = false;
  let sampleAudio = null;

  async function refreshVoices() {
    [voices, engineReady] = await Promise.all([listVoices().catch(() => []), engineStatus().then((s) => s.cached).catch(() => false)]);
    if (!voices.some((v) => v.id === voiceId)) voiceId = voices[0]?.id;
  }

  async function choose() {
    const [file] = await pickFiles({ accept: EBOOK_ACCEPT });
    if (file) load(file);
  }

  async function load(file) {
    stage = 'parsing';
    sourceName = file.name;
    render();
    try {
      parsed = await parseEbook(file, (f) => {
        const el = root.querySelector('[data-parse-progress]');
        if (el) el.style.width = `${Math.round(f * 100)}%`;
      });
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverUrl = parsed.cover ? URL.createObjectURL(parsed.cover) : null;
      await refreshVoices();
      stage = 'setup';
    } catch (err) {
      console.error(err);
      stage = 'pick';
      alertDialog({ title: 'Não foi possível ler o ebook', message: err.message || String(err) });
    }
    render();
  }

  const selected = () => parsed.chapters.filter((c) => c.include);

  function summary() {
    const sel = selected();
    const chars = sel.reduce((s, c) => s + c.chars, 0);
    return `${plural(sel.length, 'capítulo', 'capítulos')} selecionados · ≈ ${formatDuration(estimateSeconds(chars, lengthScale))} de áudio`;
  }

  async function playSample() {
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice) return;
    if (!(await ensureVoiceDownloaded(voice))) return;
    await refreshVoices();
    const first = selected()[0] || parsed.chapters[0];
    const text = first.paragraphs.join(' ').slice(0, 260).replace(/\s\S*$/, '') + '.';
    const ov = progressOverlay('Gerando amostra');
    ov.set('Carregando a voz no aparelho… (a primeira vez leva alguns segundos)', null);
    try {
      if (player.isActive()) player.pause();
      sampleAudio?.audio.pause();
      sampleAudio = await sampleVoice(voiceId, text, lengthScale);
      ov.close();
      sampleAudio?.audio.play();
    } catch (err) {
      ov.close();
      alertDialog({ title: 'Não foi possível gerar a amostra', message: err.message });
    }
    render();
  }

  async function start() {
    const sel = selected();
    if (!sel.length) return toast('Selecione pelo menos um capítulo.', { tone: 'error' });
    const voice = voices.find((v) => v.id === voiceId);
    if (!voice) return toast('Escolha uma voz.', { tone: 'error' });
    if (!parsed.meta.title.trim()) return toast('Informe o título do livro.', { tone: 'error' });
    if (!(await ensureVoiceDownloaded(voice))) return;
    await repo.updateSettings({ ttsVoice: voiceId, ttsLengthScale: lengthScale });
    sampleAudio?.audio.pause();
    await createConversion({
      meta: { title: parsed.meta.title.trim(), author: parsed.meta.author.trim(), genre: parsed.meta.genre || '', year: parsed.meta.year || '', synopsis: parsed.meta.description || '' },
      cover: parsed.cover,
      chapters: parsed.chapters,
      voiceId,
      voiceName: voice.name,
      lengthScale,
      sourceName,
    });
    toast('Conversão iniciada. Os capítulos aparecem na biblioteca conforme ficam prontos.');
    navigate('/conversoes', { replace: true });
  }

  /* ------------------------------ Render ------------------------------ */

  function voicePicker() {
    const list = h('div', { class: 'voice-list', role: 'radiogroup', 'aria-label': 'Voz' },
      voices.map((v) =>
        h('label', { class: `voice-card ${v.id === voiceId ? 'is-active' : ''}` },
          h('input', { type: 'radio', name: 'voice', value: v.id, checked: v.id === voiceId, onChange: () => { voiceId = v.id; render(); } }),
          h('span', { class: 'voice-icon' }, icon('headphones', 22)),
          h('span', { class: 'voice-text' },
            h('strong', {}, v.name, v.quality && h('small', {}, ` · ${v.quality}`)),
            h('span', { class: 'muted small' }, v.description)),
          h('span', { class: `voice-status ${v.downloaded ? 'is-ready' : ''}` },
            v.downloaded ? [icon('checkCircle', 16), 'No aparelho'] : [icon('download', 16), `≈ ${v.sizeMB} MB`]))));
    return h('section', { class: 'convert-section' },
      h('div', { class: 'section-header' }, h('h2', { class: 'section-title' }, 'Voz e ritmo')),
      list,
      h('div', { class: 'voice-tools' },
        segmented(SPEEDS, lengthScale, (v) => { lengthScale = v; render(); }, { label: 'Ritmo da fala' }),
        button(sampleAudio && !sampleAudio.audio.paused ? 'Tocando amostra…' : 'Ouvir amostra', { icon: 'play', variant: 'ghost', onClick: playSample })),
      h('p', { class: 'muted small' },
        engineReady ? 'Motor de voz no aparelho. ' : `Primeiro uso: o motor de voz (≈ ${ENGINE_SIZE_MB} MB) e a voz escolhida são baixados uma única vez. `,
        'Tem os arquivos de uma voz Piper (.onnx + .onnx.json)? ',
        h('button', {
          type: 'button', class: 'link-btn',
          onClick: async () => {
            const files = await pickFiles({ multiple: true });
            if (!files.length) return;
            try {
              voiceId = await importVoiceFiles(files);
              await refreshVoices();
              toast('Voz importada.', { tone: 'success' });
              render();
            } catch (err) {
              alertDialog({ title: 'Voz inválida', message: err.message });
            }
          },
        }, 'Importar voz de arquivo')));
  }

  function chapterPicker() {
    const sumEl = h('p', { class: 'muted small' }, summary());
    const updateSummary = () => (sumEl.textContent = summary());
    const rows = parsed.chapters.map((c, i) => {
      const cb = h('input', { type: 'checkbox', checked: c.include, 'aria-label': `Incluir ${c.title}`, onChange: (e) => { c.include = e.target.checked; row.classList.toggle('is-off', !c.include); updateSummary(); } });
      const row = h('li', { class: `cv-chapter ${c.include ? '' : 'is-off'}` },
        cb,
        h('span', { class: 'editor-num' }, String(i + 1)),
        h('div', { class: 'cv-chapter-main' },
          h('input', { class: 'input input--inline', value: c.title, 'aria-label': `Título do capítulo ${i + 1}`, onInput: (e) => (c.title = e.target.value) }),
          h('p', { class: 'editor-meta' }, `${plural(c.words, 'palavra', 'palavras')} · ≈ ${formatDuration(estimateSeconds(c.chars, lengthScale))}`, h('span', { class: 'ellipsis cv-preview' }, c.paragraphs.slice(0, 2).join(' ').slice(0, 140)))));
      return row;
    });
    const setAll = (v) => {
      parsed.chapters.forEach((c) => (c.include = v));
      render();
    };
    return h('section', { class: 'convert-section' },
      h('div', { class: 'section-header' },
        h('h2', { class: 'section-title' }, 'Capítulos', h('span', { class: 'section-count' }, parsed.chapters.length)),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'link-btn', onClick: () => setAll(true) }, 'Todos'),
          h('button', { type: 'button', class: 'link-btn', onClick: () => setAll(false) }, 'Nenhum'))),
      sumEl,
      h('p', { class: 'muted small' }, 'Desmarque partes que não quer ouvir (sumário, direitos autorais, notas). Os títulos podem ser editados.'),
      h('ol', { class: 'cv-chapters' }, rows));
  }

  function render() {
    if (destroyed) return;
    const header = pageHeader({
      eyebrow: 'Ebook → audiolivro',
      title: 'Converter ebook',
      subtitle: 'Uma voz neural em português lê o livro e grava o áudio no seu aparelho.',
      back: () => back('/importar'),
      actions: allJobs().length ? [h('a', { class: 'btn btn--ghost btn--sm', href: '#/conversoes' }, icon('layers', 18), h('span', {}, 'Conversões'))] : null,
    });

    if (stage === 'parsing') {
      root.replaceChildren(h('div', { class: 'page page-convert' }, header,
        h('div', { class: 'analyzing' }, h('div', { class: 'spinner' }),
          h('div', { class: 'analyzing-text' }, h('strong', {}, `Lendo “${sourceName}”…`), h('span', { class: 'muted small' }, 'Separando capítulos, título, autor e capa — no próprio aparelho.'),
            h('div', { class: 'bar' }, h('span', { 'data-parse-progress': '', style: { width: '0%' } }))))));
      return;
    }

    if (stage === 'pick') {
      root.replaceChildren(h('div', { class: 'page page-convert' }, header,
        h('div', { class: 'dropzone' },
          h('div', { class: 'dropzone-icon' }, icon('bookOpen', 36)),
          h('h2', {}, 'Escolha o ebook'),
          h('p', { class: 'muted' }, 'EPUB, PDF (com texto), TXT, Markdown ou HTML. Capítulos, título, autor e capa são detectados automaticamente.'),
          h('div', { class: 'dropzone-actions' }, button('Selecionar ebook', { icon: 'upload', variant: 'primary', onClick: choose })),
          h('p', { class: 'small muted desktop-only' }, 'Você também pode arrastar e soltar o arquivo aqui.')),
        h('section', { class: 'import-help' },
          h('h2', { class: 'section-title' }, 'Como funciona'),
          h('ol', { class: 'tips' },
            h('li', {}, 'O texto é lido do arquivo e dividido em capítulos.'),
            h('li', {}, 'Uma voz neural (Piper, português do Brasil) fala cada capítulo e o áudio é salvo em MP3 no aparelho.'),
            h('li', {}, 'Cada capítulo pronto entra na biblioteca na hora: dá para começar a ouvir enquanto o resto é convertido.'),
            h('li', {}, 'Na primeira vez, o motor e a voz (≈ 100 MB) são baixados. Depois, tudo funciona sem internet.')),
          h('p', { class: 'muted small' }, 'A conversão usa o processador do aparelho: em celulares pode levar desde alguns minutos até horas, dependendo do tamanho do livro. No computador é bem mais rápido — você pode converter lá e levar para o celular com “Backup completo”. PDFs escaneados (só imagem) não têm texto para ler.'))));
      return;
    }

    const pal = palette(parsed.meta.title + parsed.meta.author);
    const field = (label, key, attrs = {}) =>
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
        h('input', { class: 'input', value: parsed.meta[key] || '', onInput: debounce((e) => { parsed.meta[key] = e.target.value; }, 50), ...attrs }));
    root.replaceChildren(h('div', { class: 'page page-convert' },
      header,
      h('section', { class: 'convert-book' },
        h('div', { class: 'cover cover--lg has-img', style: { '--c1': pal.a, '--c2': pal.b } },
          coverUrl ? h('img', { src: coverUrl, alt: 'Capa', style: { opacity: '1' } }) : h('div', { class: 'cover-fallback cover-fallback--big' }, icon('image', 30), h('small', {}, 'Capa automática'))),
        h('div', { class: 'fields' },
          field('Título', 'title', { name: 'title' }),
          field('Autor', 'author'),
          h('p', { class: 'muted small' }, `Arquivo: ${sourceName} · formato ${parsed.format.toUpperCase()}`))),
      voicePicker(),
      chapterPicker(),
      h('div', { class: 'form-footer' },
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => { stage = 'pick'; parsed = null; render(); } }, 'Trocar'),
        h('button', { type: 'button', class: 'btn btn--primary btn--lg', onClick: start }, icon('sparkles', 20), h('span', {}, 'Converter em audiolivro')))));
  }

  // Arrastar e soltar
  const onDragOver = (e) => {
    if (stage === 'pick' && e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      root.classList.add('is-dragover');
    }
  };
  const onDrop = (e) => {
    if (stage !== 'pick' || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    root.classList.remove('is-dragover');
    load(e.dataTransfer.files[0]);
  };
  const onDragLeave = () => root.classList.remove('is-dragover');
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragleave', onDragLeave);
  const offVoices = bus.on('voices', () => refreshVoices().then(() => stage === 'setup' && render()));

  render();
  return () => {
    destroyed = true;
    sampleAudio?.audio.pause();
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('drop', onDrop);
    root.removeEventListener('dragleave', onDragLeave);
    root.classList.remove('is-dragover');
    offVoices();
  };
}

/* ===================================================================== */
/* #/conversoes                                                           */
/* ===================================================================== */

const STATUS = {
  queued: 'Na fila',
  running: 'Convertendo',
  paused: 'Pausada',
  done: 'Concluída',
  error: 'Erro',
  canceled: 'Cancelada',
};

export function conversionsView(root) {
  let raf = 0;
  const draw = () => {
    raf = 0;
    const list = allJobs();
    root.replaceChildren(h('div', { class: 'page page-conversions' },
      pageHeader({
        title: 'Conversões',
        subtitle: 'Ebooks sendo transformados em audiolivros no seu aparelho.',
        back: () => back('/importar'),
        actions: [iconButton('plus', 'Converter outro ebook', () => navigate('/converter'), { className: 'icon-btn--accent' })],
      }),
      list.some((j) => j.status === 'running')
        ? h('div', { class: 'notice notice--info' }, icon('info', 22),
            h('div', {}, h('strong', {}, 'Mantenha o app aberto'),
              h('p', {}, 'A tela fica ligada durante a conversão. Se você sair do app, o sistema pode pausá-la — ela continua de onde parou quando você voltar. Você pode ouvir os capítulos prontos enquanto isso.')))
        : null,
      list.length
        ? h('div', { class: 'conversion-list' }, list.map(card))
        : emptyState({
            icon: 'bookOpen', title: 'Nenhuma conversão',
            text: 'Transforme um ebook (EPUB, PDF, TXT) em audiolivro com uma voz neural em português.',
            actions: [h('a', { class: 'btn btn--primary', href: '#/converter' }, icon('sparkles', 20), h('span', {}, 'Converter ebook'))],
          })));
  };

  function card(job) {
    const st = jobStats(job);
    const book = job.bookId ? state.books.get(job.bookId) : null;
    const live = job.live;
    const liveCh = live?.chapter != null ? job.chapters[live.chapter] : null;
    const pal = palette(job.meta.title + job.meta.author);
    const art = book ? coverEl(book, { size: 'sm' }) : h('div', { class: 'cover cover--sm', style: { '--c1': pal.a, '--c2': pal.b } }, h('div', { class: 'cover-fallback' }, icon('bookOpen', 22)));
    let detail = '';
    if (job.status === 'running') {
      if (live?.phase === 'loading') detail = 'Carregando a voz…';
      else if (liveCh) detail = `Gerando: ${liveCh.title} — ${Math.round(((live.done || 0) / (live.total || 1)) * 100)}%`;
    } else if (job.status === 'error') detail = job.error;
    else if (job.status === 'paused') detail = 'Pausada. Toque em retomar para continuar de onde parou.';
    const actions = [
      book && h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-play-book': book.id, onClick: () => player.playBook(book.id) }, icon('play', 18), icon('pause', 18), h('span', {}, 'Ouvir')),
      book && h('a', { class: 'btn btn--ghost btn--sm', href: `#/livro/${encodeURIComponent(book.id)}` }, 'Detalhes'),
      ['running', 'queued'].includes(job.status) && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => pauseConversion(job.id) }, 'Pausar'),
      ['paused', 'error'].includes(job.status) && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => resumeConversion(job.id) }, 'Retomar'),
      ['running', 'queued', 'paused', 'error'].includes(job.status) &&
        h('button', {
          type: 'button', class: 'btn btn--danger-ghost btn--sm',
          onClick: async () => {
            if (await confirmDialog({ title: 'Cancelar conversão?', message: 'Os capítulos já convertidos continuam na biblioteca. Os demais não serão gerados.', confirmLabel: 'Cancelar conversão', cancelLabel: 'Voltar', danger: true })) cancelConversion(job.id);
          },
        }, 'Cancelar'),
      ['done', 'canceled'].includes(job.status) && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => removeConversion(job.id) }, 'Remover da lista'),
    ];
    return h('article', { class: `conversion-card is-${job.status}` },
      h('div', { class: 'conversion-head' },
        art,
        h('div', { class: 'conversion-text' },
          h('h3', {}, job.meta.title),
          h('p', { class: 'muted small' }, [job.meta.author, `voz ${job.voiceName || job.voiceId}`].filter(Boolean).join(' · ')),
          h('span', { class: `badge badge--status st-${job.status}` }, STATUS[job.status] || job.status))),
      h('div', { class: 'conversion-progress' },
        h('div', { class: 'bar' }, h('span', { style: { width: `${st.fraction * 100}%` } })),
        h('p', { class: 'small muted conversion-stats' },
          h('span', {}, `${st.done} de ${plural(st.total, 'capítulo', 'capítulos')} · ${Math.round(st.fraction * 100)}%`),
          st.audioSeconds > 0 && h('span', {}, `${formatDuration(st.audioSeconds)} de áudio`),
          job.status === 'running' && st.etaSeconds != null && h('span', {}, `≈ ${formatDuration(st.etaSeconds)} restantes`)),
        detail && h('p', { class: `small ${job.status === 'error' ? 'error-text' : ''}` }, detail)),
      h('div', { class: 'conversion-actions' }, actions));
  }

  draw();
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const offs = [bus.on('conversion', schedule), bus.on('library', schedule), bus.on('player:state', schedule)];
  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((o) => o());
  };
}
