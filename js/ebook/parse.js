/* Leitura de ebooks no dispositivo: EPUB, PDF, TXT, Markdown e HTML.
 * Resultado: { format, meta: { title, author, language, description, year }, cover: Blob|null,
 *              chapters: [{ title, paragraphs[], words, chars, include }] } */

import { openZip } from './zip.js';
import { fileExt } from '../utils.js';

export const EBOOK_ACCEPT = '.epub,.pdf,.txt,.text,.md,.markdown,.html,.htm,.xhtml,application/epub+zip,application/pdf,text/plain,text/html,text/markdown';
export const CHARS_PER_SECOND = 15; // fala em português, ritmo normal
export const estimateSeconds = (chars, lengthScale = 1) => (chars / CHARS_PER_SECOND) * lengthScale;

const countWords = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => squash(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, '');

const SKIP_TITLES = /^(sum[aá]rio|[ií]ndice|contents|table of contents|copyright|direitos autorais|cr[eé]ditos|ficha catalogr[aá]fica|cover|capa|title page|folha de rosto|colophon|colof[aã]o|outras obras|also by)/i;
const CHAPTER_RE = /^\s*((cap[ií]tulo|chapter|parte|part|livro|book|pr[oó]logo|prologue|ep[ií]logo|epilogue|introdu[cç][aã]o|introduction|pref[aá]cio|preface|apresenta[cç][aã]o|ato|canto|conclus[aã]o)\b[^.!?]{0,80}|[IVXLCDM]{1,7}\.?|\d{1,3}\.?)\s*$/i;

export async function parseEbook(file, onProgress = () => {}) {
  const ext = fileExt(file.name);
  const type = (file.type || '').toLowerCase();
  let out;
  if (ext === 'epub' || type === 'application/epub+zip') out = await parseEpub(file, onProgress);
  else if (ext === 'pdf' || type === 'application/pdf') out = await parsePdf(file, onProgress);
  else if (['html', 'htm', 'xhtml'].includes(ext) || type === 'text/html') out = await parseHtmlFile(file);
  else if (['md', 'markdown'].includes(ext)) out = await parseText(file, { markdown: true });
  else if (['txt', 'text'].includes(ext) || type.startsWith('text/')) out = await parseText(file);
  else throw new Error('Formato não suportado. Use EPUB, PDF, TXT, Markdown ou HTML.');

  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  out.meta.title = squash(out.meta.title) || base;
  out.meta.author = squash(out.meta.author);
  out.chapters = out.chapters.filter((c) => c.words > 0);
  if (!out.chapters.length) {
    throw new Error(
      out.format === 'pdf'
        ? 'Não encontrei texto neste PDF. Ele provavelmente é escaneado (só imagens) — seria preciso OCR, que este app não faz.'
        : 'Não encontrei texto legível neste arquivo.',
    );
  }
  markIncludes(out.chapters);
  return out;
}

function chapter(title, paragraphs, { prependTitle = false } = {}) {
  const ps = paragraphs.map(squash).filter((p) => /[\p{L}\p{N}]/u.test(p));
  const t = squash(title);
  if (prependTitle && t && ps.length && !norm(ps[0]).startsWith(norm(t).slice(0, 30))) ps.unshift(t);
  const text = ps.join(' ');
  return { title: t || 'Sem título', paragraphs: ps, words: countWords(text), chars: text.length };
}

const FRONT_MATTER = /copyright|©|todos os direitos|direitos reservados|isbn|ficha catalogr|all rights reserved/i;

function markIncludes(chapters) {
  const maxWords = Math.max(...chapters.map((c) => c.words));
  const minWords = Math.min(40, maxWords * 0.3);
  for (const c of chapters) {
    const frontMatter = c.words < 150 && FRONT_MATTER.test(c.paragraphs.join(' '));
    c.include = c.words >= minWords && !SKIP_TITLES.test(c.title) && !frontMatter;
  }
  if (!chapters.some((c) => c.include)) chapters.forEach((c) => (c.include = true));
}

/* ------------------------------ HTML -> blocos ------------------------------ */

const BLOCK_TAGS = new Set('p div h1 h2 h3 h4 h5 h6 li blockquote pre section article header footer td th dt dd figcaption tr ul ol dl table caption address main hr center body'.split(' '));
const SKIP_TAGS = new Set('script style noscript sup sub rt rp svg math img button nav head title iframe object video audio template select'.split(' '));

function parseMarkup(str, type = 'application/xhtml+xml') {
  let doc = new DOMParser().parseFromString(str, type);
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(str, 'text/html');
  return doc;
}

/** Extrai blocos de texto de um documento: [{ text, heading (0-6), ids[] }]. */
export function htmlBlocks(root) {
  const blocks = [];
  let buf = '';
  let ids = [];
  const flush = (heading = 0) => {
    const text = squash(buf);
    buf = '';
    if (text) {
      blocks.push({ text, heading, ids });
      ids = [];
    }
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        buf += child.data;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const etype = child.getAttribute('epub:type') || child.getAttribute('role') || '';
      if (/footnote|endnote|rearnote|noteref|pagebreak|doc-noteref|doc-pagebreak/.test(etype)) continue;
      const anchor = child.getAttribute('id') || (tag === 'a' && child.getAttribute('name'));
      if (tag === 'br') {
        buf += ' ';
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        flush();
        if (anchor) ids.push(anchor);
        walk(child);
        const h = /^h([1-6])$/.exec(tag);
        flush(h ? Number(h[1]) : 0);
      } else {
        if (anchor) ids.push(anchor);
        walk(child);
      }
    }
  };
  walk(root);
  flush();
  return blocks;
}

const firstHeading = (blocks) => blocks.find((b) => b.heading && b.text.length < 120)?.text || '';

/** Divide blocos em capítulos pelos títulos (h1/h2 ou "Capítulo X"). */
function splitByHeadings(blocks) {
  const levels = [1, 2, 3].map((l) => blocks.filter((b) => b.heading === l).length);
  let level = levels.findIndex((n) => n >= 2) + 1;
  const isHead = level > 0 ? (b) => b.heading === level || (b.heading && b.heading < level) : (b) => b.text.length < 90 && CHAPTER_RE.test(b.text);
  const heads = blocks.filter(isHead);
  if (heads.length < 2) return null;
  const out = [];
  let cur = null;
  for (const b of blocks) {
    if (isHead(b)) {
      cur = { title: b.text, paragraphs: [] };
      out.push(cur);
    }
    if (!cur) {
      cur = { title: 'Início', paragraphs: [] };
      out.push(cur);
    }
    cur.paragraphs.push(b.text);
  }
  return out.map((c) => chapter(c.title, c.paragraphs));
}

/** Sem títulos detectáveis: partes de ~4.500 palavras (≈ 30 min). */
function splitBySize(paragraphs, maxWords = 4500) {
  const out = [];
  let cur = [];
  let words = 0;
  for (const p of paragraphs) {
    cur.push(p);
    words += countWords(p);
    if (words >= maxWords) {
      out.push(chapter(`Parte ${out.length + 1}`, cur));
      cur = [];
      words = 0;
    }
  }
  if (cur.length) out.push(chapter(`Parte ${out.length + 1}`, cur));
  return out;
}

/* ------------------------------ EPUB ------------------------------ */

function resolvePath(baseFile, href) {
  const url = new URL(href, 'http://epub/' + baseFile);
  return { path: decodeURIComponent(url.pathname.slice(1)), frag: url.hash ? decodeURIComponent(url.hash.slice(1)) : '' };
}

async function parseEpub(file, onProgress) {
  const zip = await openZip(file);
  const containerXml = await zip.text('META-INF/container.xml');
  if (!containerXml) throw new Error('EPUB inválido: falta META-INF/container.xml.');
  // DRM: texto criptografado (ofuscação de fontes é comum e não atrapalha).
  const encryption = await zip.text('META-INF/encryption.xml');
  if (encryption && /URI="[^"]+\.(x?html?|xml|txt)"/i.test(encryption)) {
    throw new Error('Este EPUB tem proteção contra cópia (DRM), então o texto não pode ser lido. Use uma versão sem DRM — por exemplo, livros de domínio público ou comprados em lojas que vendem sem DRM.');
  }
  const opfPath = parseMarkup(containerXml, 'application/xml').getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  const opfXml = opfPath && (await zip.text(opfPath));
  if (!opfXml) throw new Error('EPUB inválido: não encontrei o arquivo de pacote (OPF).');
  const opf = parseMarkup(opfXml, 'application/xml');

  const DC = 'http://purl.org/dc/elements/1.1/';
  const dc = (name) => [...opf.getElementsByTagNameNS(DC, name)].map((e) => squash(e.textContent)).filter(Boolean);
  const desc = dc('description')[0] || '';
  const meta = {
    title: dc('title')[0] || '',
    author: dc('creator').join(', '),
    language: dc('language')[0] || '',
    description: squash(parseMarkup(`<div>${desc}</div>`, 'text/html').body.textContent),
    year: (dc('date')[0] || '').slice(0, 4),
  };

  const manifest = new Map();
  for (const item of opf.getElementsByTagName('item')) {
    const href = item.getAttribute('href');
    if (!href) continue;
    manifest.set(item.getAttribute('id'), {
      id: item.getAttribute('id'),
      path: resolvePath(opfPath, href).path,
      type: (item.getAttribute('media-type') || '').toLowerCase(),
      props: item.getAttribute('properties') || '',
    });
  }
  const spineEl = opf.getElementsByTagName('spine')[0];
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => ({ item: manifest.get(r.getAttribute('idref')), linear: r.getAttribute('linear') !== 'no' }));

  // Capa
  const items = [...manifest.values()];
  let coverItem = items.find((i) => /\bcover-image\b/.test(i.props));
  if (!coverItem) {
    const m = [...opf.getElementsByTagName('meta')].find((x) => x.getAttribute('name') === 'cover');
    if (m) coverItem = manifest.get(m.getAttribute('content'));
  }
  if (!coverItem) coverItem = items.find((i) => i.type.startsWith('image/') && /cover|capa/i.test(i.id + i.path));
  const cover = coverItem?.type.startsWith('image/') ? await zip.blob(coverItem.path, coverItem.type).catch(() => null) : null;

  // Sumário: EPUB 3 (nav) ou EPUB 2 (NCX)
  let toc = [];
  const navItem = items.find((i) => /\bnav\b/.test(i.props));
  if (navItem) {
    const doc = parseMarkup((await zip.text(navItem.path)) || '');
    const navs = [...doc.getElementsByTagName('nav')];
    const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('role') || '')) || navs[0];
    for (const a of nav ? nav.getElementsByTagName('a') : []) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let depth = 0;
      for (let p = a.parentElement; p && p !== nav; p = p.parentElement) if (p.localName === 'li') depth++;
      toc.push({ ...resolvePath(navItem.path, href), label: squash(a.textContent), depth });
    }
  }
  if (!toc.length) {
    const ncxItem = manifest.get(spineEl?.getAttribute('toc')) || items.find((i) => i.type === 'application/x-dtbncx+xml');
    const ncxXml = ncxItem && (await zip.text(ncxItem.path));
    if (ncxXml) {
      const ncx = parseMarkup(ncxXml, 'application/xml');
      for (const np of ncx.getElementsByTagName('navPoint')) {
        const src = np.getElementsByTagName('content')[0]?.getAttribute('src');
        if (!src) continue;
        let depth = 0;
        for (let p = np; p && p.localName === 'navPoint'; p = p.parentElement) depth++;
        toc.push({ ...resolvePath(ncxItem.path, src), label: squash(np.getElementsByTagName('text')[0]?.textContent), depth });
      }
    }
  }
  if (toc.length) {
    const minDepth = Math.min(...toc.map((t) => t.depth));
    const top = toc.filter((t) => t.depth === minDepth);
    const maxDepth = top.length >= 3 ? minDepth : minDepth + 1;
    toc = toc.filter((t) => t.depth <= maxDepth);
  }
  const tocByPath = new Map();
  for (const t of toc) {
    if (!tocByPath.has(t.path)) tocByPath.set(t.path, []);
    tocByPath.get(t.path).push(t);
  }

  // Capítulos na ordem de leitura (spine)
  const raw = [];
  let current = null;
  for (let i = 0; i < spine.length; i++) {
    const { item, linear } = spine[i];
    onProgress(i / spine.length);
    if (!item || item === navItem || !/x?html|xml/.test(item.type)) continue;
    const xml = await zip.text(item.path);
    if (!xml) continue;
    const doc = parseMarkup(xml);
    const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
    const blocks = htmlBlocks(body);
    const entries = tocByPath.get(item.path) || [];
    if (!entries.length) {
      if (current && toc.length && linear) current.blocks.push(...blocks);
      else {
        current = { title: firstHeading(blocks) || `Seção ${raw.length + 1}`, blocks, fromToc: false };
        raw.push(current);
      }
      continue;
    }
    const starts = [];
    for (const e of entries) {
      let idx = e.frag ? blocks.findIndex((b) => b.ids.includes(e.frag)) : 0;
      if (idx < 0) idx = 0;
      if (!starts.some((s) => s.idx === idx)) starts.push({ e, idx });
    }
    starts.sort((a, b) => a.idx - b.idx);
    if (starts[0].idx > 0) {
      const pre = blocks.slice(0, starts[0].idx);
      if (current) current.blocks.push(...pre);
      else raw.push((current = { title: firstHeading(pre) || 'Início', blocks: pre, fromToc: false }));
    }
    starts.forEach((s, k) => {
      const slice = blocks.slice(s.idx, starts[k + 1]?.idx ?? blocks.length);
      current = { title: s.e.label || firstHeading(slice) || `Seção ${raw.length + 1}`, blocks: slice, fromToc: true };
      raw.push(current);
    });
  }
  onProgress(1);
  return {
    format: 'epub',
    meta,
    cover,
    chapters: raw.map((c) => chapter(c.title, c.blocks.map((b) => b.text), { prependTitle: c.fromToc })),
  };
}

/* ------------------------------ PDF ------------------------------ */

const vendorUrl = (p) => new URL(`../../vendor/pdfjs-6.5.438/${p}`, import.meta.url).href;

async function loadPdfJs() {
  // Usa a cópia do cache offline do motor quando disponível (funciona mesmo sem Service Worker).
  let main = vendorUrl('pdf.min.mjs');
  let worker = vendorUrl('pdf.worker.min.mjs');
  try {
    const cache = await caches.open('audiobook-engine-v1');
    const [m, w] = await Promise.all([cache.match(main), cache.match(worker)]);
    if (m && w) {
      main = URL.createObjectURL(new Blob([await m.blob()], { type: 'text/javascript' }));
      worker = URL.createObjectURL(new Blob([await w.blob()], { type: 'text/javascript' }));
    }
  } catch {}
  const pdfjs = await import(main);
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

async function parsePdf(file, onProgress) {
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
  } catch {
    throw new Error('Não foi possível carregar o leitor de PDF. Abra esta função uma vez com internet para que ele fique disponível offline.');
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  const info = (await doc.getMetadata().catch(() => null))?.info || {};

  // 1) Linhas de cada página
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress((i - 1) / doc.numPages);
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const lines = [];
    let line = '', y = null, h = 0;
    const push = () => {
      if (line.trim()) lines.push({ text: line.replace(/\s+/g, ' ').trim(), y, h });
      line = '';
    };
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const iy = it.transform[5];
      const ih = Math.abs(it.transform[3]) || it.height || 10;
      if (y !== null && Math.abs(iy - y) > ih * 0.6 && line) push();
      if (!line) {
        y = iy;
        h = ih;
      }
      line += it.str;
      if (it.hasEOL) {
        push();
        y = null;
      }
    }
    push();
    pages.push(lines);
    page.cleanup();
  }

  // 2) Remove cabeçalhos/rodapés repetidos e números de página
  const key = (t) => t.replace(/\d+/g, '#').toLowerCase();
  const freq = new Map();
  for (const lines of pages) {
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const k of new Set(edge.map((l) => key(l.text)))) freq.set(k, (freq.get(k) || 0) + 1);
  }
  const minRepeat = Math.max(3, pages.length * 0.4);
  for (let i = 0; i < pages.length; i++) {
    const lines = pages[i];
    pages[i] = lines.filter((l, idx) => {
      const isEdge = idx < 2 || idx >= lines.length - 2;
      if (/^\s*[-–]?\s*\d{1,4}\s*[-–]?\s*$/.test(l.text)) return false;
      return !(isEdge && (freq.get(key(l.text)) || 0) >= minRepeat);
    });
  }

  // 3) Parágrafos (com página de início)
  const gaps = [];
  for (const lines of pages) for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && g < 100) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const lineGap = gaps[Math.floor(gaps.length / 2)] || 14;
  const paras = []; // { text, page }
  let cur = null;
  pages.forEach((lines, pi) => {
    lines.forEach((l, li) => {
      const prev = li > 0 ? lines[li - 1] : null;
      const gap = prev ? prev.y - l.y : 0;
      const prevEnds = cur && /[.!?:;»”"…)]$/.test(cur.text);
      const headingLike = l.text.length < 90 && CHAPTER_RE.test(l.text);
      const newPara = !cur || headingLike || cur.heading || (prev && (gap > lineGap * 1.55 || gap < 0)) || (prevEnds && /^[\p{Lu}—–\-"«“]/u.test(l.text) && prev && prev.text.length < 0.75 * Math.max(...lines.map((x) => x.text.length)));
      if (newPara) {
        cur = { text: l.text, page: pi, heading: headingLike };
        paras.push(cur);
      } else if (/[\p{L}]-$/u.test(cur.text) && /^\p{Ll}/u.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
      else cur.text += ' ' + l.text;
    });
  });

  // 4) Capítulos: pelo sumário do PDF, por títulos detectados ou por tamanho
  let chapters = null;
  const outline = await doc.getOutline().catch(() => null);
  if (outline?.length) {
    const flat = [];
    const visit = (items, depth) => items.forEach((o) => {
      flat.push({ o, depth });
      if (o.items?.length && depth < 1) visit(o.items, depth + 1);
    });
    visit(outline, 0);
    const top = flat.filter((x) => x.depth === 0);
    const use = top.length >= 3 ? top : flat;
    const marks = [];
    for (const { o } of use) {
      try {
        const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest;
        if (!dest) continue;
        const pageIndex = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
        marks.push({ title: o.title, page: pageIndex });
      } catch {}
    }
    marks.sort((a, b) => a.page - b.page);
    if (marks.length >= 2) {
      chapters = [];
      const before = paras.filter((p) => p.page < marks[0].page);
      if (before.length) chapters.push(chapter('Início', before.map((p) => p.text)));
      marks.forEach((m, k) => {
        const end = marks[k + 1]?.page ?? Infinity;
        const ps = paras.filter((p) => p.page >= m.page && p.page < end);
        if (ps.length || k === marks.length - 1) chapters.push(chapter(m.title, ps.map((p) => p.text), { prependTitle: true }));
      });
      chapters = chapters.filter((c) => c.words > 0);
    }
  }
  if (!chapters || chapters.length < 2) {
    chapters = splitByHeadings(paras.map((p) => ({ text: p.text, heading: 0 }))) || splitBySize(paras.map((p) => p.text));
  }

  // 5) Capa: miniatura da primeira página
  let cover = null;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 900 / Math.max(vp.width, vp.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    // Página quase toda branca (só texto) não serve de capa: usa a capa tipográfica gerada.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 48;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(canvas, 0, 0, 48, 48);
    const px = pctx.getImageData(0, 0, 48, 48).data;
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 600) ink++;
    if (ink / (48 * 48) > 0.12) cover = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  } catch {}
  onProgress(1);
  await (task.destroy?.() || doc.destroy?.())?.catch?.(() => {});
  const firstShort = paras.find((p) => p.text.length >= 3 && p.text.length < 90 && !CHAPTER_RE.test(p.text));
  return {
    format: 'pdf',
    meta: { title: info.Title || (firstShort && firstShort.page === 0 ? firstShort.text : '') || chapters[0]?.title || '', author: info.Author || '', language: '', description: info.Subject || '', year: '' },
    cover,
    chapters,
  };
}

/* ------------------------------ TXT / Markdown / HTML ------------------------------ */

async function readTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

async function parseText(file, { markdown = false } = {}) {
  const text = (await readTextFile(file)).replace(/\r\n?/g, '\n');
  const meta = { title: '', author: '', language: '', description: '', year: '' };
  // Cabeçalho do Projeto Gutenberg ("Title: ...", "Author: ...")
  const t = text.match(/^\s*(?:Title|Título):\s*(.+)$/im);
  const a = text.match(/^\s*(?:Author|Autor):\s*(.+)$/im);
  if (t) meta.title = t[1];
  if (a) meta.author = a[1];

  let rawParas = text.split(/\n\s*\n/);
  if (rawParas.length < 3 && text.split('\n').length > 12) rawParas = text.split('\n');
  const blocks = [];
  for (const p of rawParas) {
    let s = p.trim();
    if (!s) continue;
    let heading = 0;
    if (markdown) {
      const m = s.match(/^(#{1,6})\s+(.*)$/m);
      if (m && s.split('\n').length === 1) {
        heading = m[1].length;
        s = m[2];
      }
      s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`>]+/g, '');
    }
    s = s.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/\s*\n\s*/g, ' ');
    blocks.push({ text: s, heading });
  }
  if (!meta.title) {
    const h = blocks.find((b) => b.heading === 1) || (blocks[0] && blocks[0].text.length < 80 ? blocks[0] : null);
    if (h) meta.title = h.text;
  }
  const chapters = splitByHeadings(blocks) || splitBySize(blocks.map((b) => b.text));
  return { format: markdown ? 'md' : 'txt', meta, cover: null, chapters };
}

async function parseHtmlFile(file) {
  const doc = parseMarkup(await readTextFile(file), 'text/html');
  const blocks = htmlBlocks(doc.body || doc.documentElement);
  const meta = {
    title: doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '',
    author: doc.querySelector('meta[name="author"]')?.getAttribute('content') || '',
    language: doc.documentElement.getAttribute('lang') || '',
    description: doc.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    year: '',
  };
  const chapters = splitByHeadings(blocks) || splitBySize(blocks.map((b) => b.text));
  return { format: 'html', meta, cover: null, chapters };
}
