// Teste ponta a ponta da conversão de ebook em audiolivro (Chromium headless via Playwright).
// Gera um EPUB e um PDF de teste, importa uma voz Piper de arquivo, converte, toca o
// resultado e repete a conversão em MODO OFFLINE.
//
// Uso:
//   1) python3 -m http.server 8765
//   2) node tools/test-convert.mjs --voz /caminho/pt_BR-faber-medium.onnx [--url http://localhost:8765/]
//      (o arquivo .onnx.json da voz deve estar ao lado do .onnx; baixe ambos em
//       https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/pt/pt_BR)

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('--url', 'http://localhost:8765/');
const VOICE = arg('--voz');
const SHOTS = arg('--capturas', join(tmpdir(), 'audiobook-convert'));
if (!VOICE || !existsSync(VOICE) || !existsSync(VOICE + '.json')) {
  console.error('Informe a voz Piper: --voz caminho/da/voz.onnx (com o .onnx.json ao lado).');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

/* ---------------- EPUB de teste (ZIP montado à mão) ---------------- */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, store } of files) {
    const raw = Buffer.from(data);
    const comp = store ? raw : deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(comp.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(store ? 0 : 8, 10);
    cen.writeUInt32LE(crc32(raw), 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;

function buildEpub(coverPng) {
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">teste-1</dc:identifier><dc:title>O Pequeno Teste</dc:title><dc:creator>Autora Exemplo</dc:creator><dc:language>pt-BR</dc:language><dc:description>&lt;p&gt;Um livro curtinho para testar a conversão.&lt;/p&gt;</dc:description></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cr" href="texto/direitos.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="texto/cap1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="texto/cap2.xhtml" media-type="application/xhtml+xml"/><item id="capa" href="imagens/capa.png" media-type="image/png" properties="cover-image"/></manifest><spine><itemref idref="cr"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>` },
    { name: 'OEBPS/nav.xhtml', data: xhtml('Sumário', '<nav epub:type="toc"><ol><li><a href="texto/cap1.xhtml">Capítulo 1 — A chegada</a></li><li><a href="texto/cap2.xhtml#c2">Capítulo 2 — O jardim</a></li><li><a href="texto/cap2.xhtml#c3">Capítulo 3 — A partida</a></li></ol></nav>') },
    { name: 'OEBPS/texto/direitos.xhtml', data: xhtml('Direitos', '<p>Copyright 2026. Todos os direitos reservados.</p>') },
    { name: 'OEBPS/texto/cap1.xhtml', data: xhtml('Cap 1', '<h1>Capítulo 1 — A chegada</h1><p>Era uma manhã clara quando Ana chegou à cidade.<sup><a epub:type="noteref" href="#n1">1</a></sup> Ela trazia uma mala pequena e muitas perguntas.</p><p>— Bom dia! — disse o porteiro, sorrindo.</p>') },
    { name: 'OEBPS/texto/cap2.xhtml', data: xhtml('Cap 2', '<h1 id="c2">Capítulo 2 — O jardim</h1><p>No jardim havia flores de todas as cores. Ana sentou-se num banco e leu por duas horas.</p><h1 id="c3">Capítulo 3 — A partida</h1><p>No fim da tarde, ela voltou para casa feliz. A viagem tinha valido a pena.</p>') },
    { name: 'OEBPS/imagens/capa.png', data: coverPng, store: true },
  ]);
}

/* ---------------- utilidades ---------------- */
let failures = 0, passes = 0;
const ok = (cond, msg) => { cond ? passes++ : failures++; console.log(`  ${cond ? '✓' : '✗'} ${msg}`); };
const step = (t) => console.log(`\n▶ ${t}`);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const go = async (hash) => { await page.evaluate((h) => (location.hash = h), hash); await page.waitForTimeout(400); };
const clickBtn = (name) => page.getByRole('button', { name }).first().click();
const pick = async (trigger, files) => {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles(files);
};
const waitJobDone = (title, timeout) =>
  page.waitForFunction((t) => [...document.querySelectorAll('.conversion-card')].some((c) => c.textContent.includes(t) && c.classList.contains('is-done')), title, { timeout });

try {
  step('Preparar arquivos de teste');
  await page.setContent('<div style="width:600px;height:600px;background:linear-gradient(135deg,#7a3,#135)"></div>');
  const coverPng = await page.screenshot({ clip: { x: 0, y: 0, width: 600, height: 600 } });
  const epub = buildEpub(coverPng);
  await page.setContent(`<html lang="pt-BR"><body style="font:16px Georgia">
    <h1>O Livro em PDF</h1><p>Uma introdução breve ao livro de teste.</p>
    <h1 style="page-break-before:always">Capítulo 1 — Começo</h1><p>O sol nasceu sobre as montanhas. Pedro acordou cedo e preparou o café.</p>
    <h1 style="page-break-before:always">Capítulo 2 — Fim</h1><p>À noite, a cidade ficou em silêncio. Pedro dormiu tranquilo.</p></body></html>`);
  const pdf = await page.pdf({ format: 'A5', outline: true, tagged: true });
  ok(epub.length > 1000 && pdf.length > 1000, `EPUB (${epub.length} B) e PDF (${pdf.length} B) gerados`);

  step('Abrir o app e ler o EPUB');
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await go('#/converter');
  await pick(() => clickBtn('Selecionar ebook'), { name: 'o-pequeno-teste.epub', mimeType: 'application/epub+zip', buffer: epub });
  await page.waitForSelector('.convert-book', { timeout: 20000 });
  const info = await page.evaluate(() => ({
    title: document.querySelector('input[name="title"]').value,
    chapters: [...document.querySelectorAll('.cv-chapter')].map((li) => ({ title: li.querySelector('.input').value, on: li.querySelector('input[type=checkbox]').checked })),
    cover: !!document.querySelector('.convert-book img'),
  }));
  ok(info.title === 'O Pequeno Teste', `título lido do EPUB: ${info.title}`);
  ok(info.cover, 'capa do EPUB detectada');
  const on = info.chapters.filter((c) => c.on).map((c) => c.title);
  ok(JSON.stringify(on) === JSON.stringify(['Capítulo 1 — A chegada', 'Capítulo 2 — O jardim', 'Capítulo 3 — A partida']), `capítulos do sumário (incl. 2 no mesmo arquivo): ${on.join(' | ')}`);
  ok(info.chapters.some((c) => !c.on), 'página de direitos autorais desmarcada automaticamente');
  await page.screenshot({ path: join(SHOTS, '01-converter.png'), fullPage: true });

  step('Importar voz de arquivo e baixar o motor');
  await pick(() => clickBtn('Importar voz de arquivo'), [VOICE, VOICE + '.json']);
  await page.waitForSelector('.voice-card.is-active .voice-status.is-ready', { timeout: 30000 });
  ok(true, 'voz importada e selecionada');
  await clickBtn('Ouvir amostra');
  await page.getByRole('button', { name: 'Baixar agora' }).click();
  await page.waitForFunction(() => !document.querySelector('.busy-overlay'), null, { timeout: 120000 });
  ok(!(await page.getByText('Não foi possível').count()), 'motor baixado e amostra gerada sem erros');

  step('Converter o EPUB');
  const t0 = Date.now();
  await clickBtn('Gerar audiolivro');
  await page.waitForFunction(() => location.hash.startsWith('#/conversoes'));
  await page.waitForSelector('.conversion-card');
  await page.screenshot({ path: join(SHOTS, '02-conversoes.png') });
  await waitJobDone('O Pequeno Teste', 300000);
  ok(true, `conversão concluída em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const book = await page.evaluate(async () => {
    const { state, repo } = window.AUDIOBOOK;
    const b = [...state.books.values()].find((x) => x.title === 'O Pequeno Teste');
    const chs = await repo.getChapters(b.id);
    return { id: b.id, author: b.author, conversion: b.conversion, ok: (await repo.verifyBookAudio(b.id)).ok, chapters: chs.map((c) => ({ t: c.title, d: c.duration, type: c.type })) };
  });
  ok(book.chapters.length === 3 && book.chapters.every((c) => c.d > 1 && c.type === 'audio/mpeg'), `livro com 3 capítulos MP3: ${book.chapters.map((c) => c.d.toFixed(1) + 's').join(', ')}`);
  ok(book.ok && !book.conversion && book.author === 'Autora Exemplo', 'áudio guardado no IndexedDB e livro finalizado');

  step('Ouvir o audiolivro gerado');
  await page.evaluate((id) => window.AUDIOBOOK.player.playBook(id), book.id);
  await page.waitForFunction(() => window.AUDIOBOOK.player.position > 0.8, null, { timeout: 15000 });
  const ms = await page.evaluate(() => navigator.mediaSession.metadata?.title);
  ok(ms === 'O Pequeno Teste', 'tocando, com controles do sistema (Media Session)');
  await page.evaluate(() => window.AUDIOBOOK.player.pause());

  step('MODO OFFLINE: converter um PDF sem internet');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.page');
  await go('#/converter');
  await pick(() => clickBtn('Selecionar ebook'), { name: 'livro.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForSelector('.convert-book', { timeout: 30000 });
  const pdfInfo = await page.evaluate(() => [...document.querySelectorAll('.cv-chapter .input')].map((i) => i.value));
  ok(pdfInfo.length >= 2, `PDF lido offline, capítulos pelo sumário: ${pdfInfo.join(' | ')}`);
  ok(await page.locator('.voice-card.is-active .voice-status.is-ready').count() === 1, 'voz disponível offline');
  await clickBtn('Gerar audiolivro');
  await page.waitForFunction(() => location.hash.startsWith('#/conversoes'));
  await waitJobDone('O Livro em PDF', 300000);
  const pdfBook = await page.evaluate(() => [...window.AUDIOBOOK.state.books.values()].find((b) => /PDF/.test(b.title))?.chapterCount);
  ok(pdfBook >= 2, `audiolivro do PDF criado offline (${pdfBook} capítulos)`);
  await page.screenshot({ path: join(SHOTS, '03-offline.png') });
} catch (err) {
  failures++;
  console.error('\n✗ ERRO:', err.message);
  await page.screenshot({ path: join(SHOTS, 'erro.png') }).catch(() => {});
} finally {
  const relevant = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  ok(relevant.length === 0, `sem erros de JavaScript${relevant.length ? ': ' + relevant.join(' | ') : ''}`);
  console.log(`\n${passes} verificações OK, ${failures} falha(s). Capturas em ${SHOTS}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}
