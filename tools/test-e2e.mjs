// Teste automatizado ponta a ponta (Chromium headless via Playwright).
// Cobre: instalação do Service Worker, importação de arquivos reais, reprodução,
// velocidade, troca automática de capítulo, navegação durante a reprodução,
// marcadores, Media Session, persistência após recarregar, MODO OFFLINE,
// temporizador "fim do capítulo", backup completo + restauração e remoção.
//
// Uso:
//   1) Sirva a pasta do projeto:   python3 -m http.server 8765
//   2) Rode:                       node tools/test-e2e.mjs [http://localhost:8765/] [pasta-de-capturas]
// Requer Playwright com Chromium instalado.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node-tools/node_modules/playwright'));
}

const BASE = process.argv[2] || 'http://localhost:8765/';
const SHOTS = process.argv[3] || join(tmpdir(), 'audiobook-e2e');
mkdirSync(SHOTS, { recursive: true });

/* ---------- arquivos de áudio de teste (WAV gerado, sem direitos autorais) ---------- */
function wav(seconds, freq, sr = 8000) {
  const n = Math.floor(seconds * sr);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 8000), 44 + i * 2);
  return buf;
}
const fixtures = join(SHOTS, 'fixtures');
mkdirSync(fixtures, { recursive: true });
const files = [
  ['02 - Segundo capítulo.wav', wav(40, 440)],
  ['01 - Primeiro capítulo.wav', wav(6, 330)],
  ['03 - Terceiro capítulo.wav', wav(8, 550)],
].map(([name, data]) => {
  writeFileSync(join(fixtures, name), data); // cópia em disco para teste manual
  // Enviados como buffer: alguns ambientes headless não leem caminhos com acentos.
  return { name, mimeType: 'audio/wav', buffer: data };
});

/* ---------- utilidades ---------- */
let failures = 0, passes = 0;
const ok = (cond, msg) => {
  if (cond) { passes++; console.log(`  ✓ ${msg}`); }
  else { failures++; console.log(`  ✗ ${msg}`); }
};
const step = (title) => console.log(`\n▶ ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

const snap = () => page.evaluate(() => {
  const s = window.AUDIOBOOK.player.snapshot();
  const a = document.getElementById('audio');
  return { title: s.book?.title, index: s.index, position: s.position, playing: s.playing, rate: s.rate, paused: a.paused, playbackRate: a.playbackRate, src: a.src.slice(0, 5) };
});
const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });
const go = async (hash) => { await page.evaluate((h) => (location.hash = h), hash); await sleep(500); };
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });
const clickText = (text) => page.getByRole('button', { name: text }).first().click();

try {
  step('1. Abrir o app online e instalar o Service Worker');
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await waitFor(() => !!navigator.serviceWorker.controller);
  ok(true, 'Service Worker ativo e controlando a página');
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('audiobook-shell-'));
    return { shell, count: shell ? (await (await caches.open(shell)).keys()).length : 0 };
  });
  ok(cached.count >= 40, `interface pré-carregada no cache (${cached.count} arquivos em ${cached.shell})`);

  step('2. Importar um audiolivro com 3 arquivos');
  await go('#/importar');
  const chooser = page.waitForEvent('filechooser');
  await clickText('Selecionar arquivos de áudio');
  await (await chooser).setFiles(files);
  await page.waitForSelector('.import-form', { timeout: 20000 });
  const order = await page.$$eval('.editor-row .input--inline', (els) => els.map((e) => e.value));
  ok(JSON.stringify(order) === JSON.stringify(['Primeiro capítulo', 'Segundo capítulo', 'Terceiro capítulo']), `capítulos ordenados pelo nome do arquivo: ${order.join(' | ')}`);
  await page.fill('input[name="title"]', 'Livro de Teste');
  await page.locator('label.field', { hasText: 'Autor' }).locator('input').fill('Autora Teste');
  await shot('01-importar');
  await clickText('Salvar na biblioteca');
  await waitFor(() => location.hash.startsWith('#/livro/'), null, 20000);
  await page.waitForSelector('.offline-ok');
  ok(true, 'livro salvo e marcado como "Disponível offline"');
  const stored = await page.evaluate(async () => {
    const id = location.hash.split('/')[2];
    return (await window.AUDIOBOOK.repo.verifyBookAudio(decodeURIComponent(id))).ok;
  });
  ok(stored, 'arquivos de áudio verificados no IndexedDB');
  await shot('02-detalhes');

  step('3. Reproduzir');
  await page.locator('.details-actions [data-play-book]').click();
  await waitFor(() => window.AUDIOBOOK.player.position > 0.5);
  let s = await snap();
  ok(s.playing && s.src === 'blob:', 'tocando a partir de Blob URL local (sem streaming)');
  const ms = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, state: navigator.mediaSession.playbackState, art: navigator.mediaSession.metadata?.artwork?.[0]?.src?.slice(0, 10) }));
  ok(ms.title === 'Livro de Teste' && /Primeiro capítulo · Autora Teste/.test(ms.artist) && ms.state === 'playing', `Media Session: "${ms.title}" / "${ms.artist}" (${ms.state})`);
  ok(/^data:image|^http/.test(ms.art || ''), 'Media Session com capa (artwork)');

  step('4. Velocidade 2x sem reiniciar');
  const before = (await snap()).position;
  await go('#/player');
  await page.locator('.player-pills .pill').first().click();
  await page.getByRole('radio', { name: '2x' }).click();
  await page.keyboard.press('Escape');
  s = await snap();
  ok(s.playbackRate === 2 && s.position >= before - 0.3, `playbackRate=2 e posição mantida (${before.toFixed(1)}s → ${s.position.toFixed(1)}s)`);
  await shot('03-player');

  step('5. Troca automática de capítulo');
  await waitFor(() => window.AUDIOBOOK.player.index === 1, null, 12000);
  s = await snap();
  ok(s.index === 1 && s.playing, 'capítulo 2 começou sozinho');

  step('6. Navegar entre telas sem interromper o áudio');
  for (const h of ['#/inicio', '#/biblioteca', '#/favoritos', '#/historico', '#/configuracoes', '#/estatisticas', '#/armazenamento', '#/instalar']) await go(h);
  s = await snap();
  ok(s.playing, 'áudio continuou tocando durante toda a navegação');
  await go('#/biblioteca');
  await shot('04-biblioteca');

  step('7. Marcador e pausa');
  await page.keyboard.press('b');
  await sleep(400);
  await page.keyboard.press('k');
  await sleep(600);
  s = await snap();
  ok(!s.playing, 'pausado pelo atalho de teclado');
  const saved = await page.evaluate(() => {
    const id = window.AUDIOBOOK.player.book.id;
    return Promise.all([window.AUDIOBOOK.repo.getBookmarks(id), window.AUDIOBOOK.repo.getProgress(id)]);
  });
  ok(saved[0].length === 1, `marcador salvo (${saved[0][0]?.chapterTitle} @ ${saved[0][0]?.position.toFixed(1)}s)`);
  ok(saved[1].chapterIndex === 1 && saved[1].position > 0, `progresso salvo: cap. ${saved[1].chapterIndex + 1}, ${saved[1].position.toFixed(1)}s`);

  step('8. MODO OFFLINE: recarregar sem rede');
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.page', { timeout: 10000 });
  ok(await page.evaluate(() => !navigator.onLine), 'navegador sem conexão');
  await go('#/biblioteca');
  const titles = await page.$$eval('.book-card-title', (els) => els.map((e) => e.textContent));
  ok(titles.includes('Livro de Teste'), 'biblioteca disponível offline');
  s = await snap();
  ok(s.title === 'Livro de Teste' && s.index === 1 && Math.abs(s.position - saved[1].position) < 1.5, `retomou do ponto salvo (cap. ${s.index + 1}, ${s.position.toFixed(1)}s)`);
  ok(s.rate === 2, 'velocidade do livro restaurada (2x)');
  await shot('05-offline-biblioteca');
  await page.locator('.mini-play').click();
  await waitFor((p) => window.AUDIOBOOK.player.playing && window.AUDIOBOOK.player.position > p + 0.3, s.position);
  ok(true, 'reprodução offline funcionando');
  await page.evaluate(() => window.AUDIOBOOK.player.nextChapter());
  await waitFor(() => window.AUDIOBOOK.player.index === 2 && window.AUDIOBOOK.player.position > 0.2);
  ok(true, 'próximo capítulo offline');
  await page.evaluate(() => window.AUDIOBOOK.player.loadChapter(0, 0, true));
  await waitFor(() => window.AUDIOBOOK.player.index === 0 && window.AUDIOBOOK.player.position > 0.2);
  ok(true, 'seleção de capítulo pela lista offline');

  step('9. Temporizador "Final do capítulo atual"');
  await page.evaluate(() => window.AUDIOBOOK.player.startSleep('chapter'));
  await waitFor(() => !window.AUDIOBOOK.player.playing && window.AUDIOBOOK.player.index === 1, null, 12000);
  s = await snap();
  ok(!s.playing && s.index === 1 && s.position < 0.5, 'pausou no fim do capítulo e ficou pronto no início do próximo');

  step('10. Progresso persiste após fechar e reabrir (offline)');
  await page.reload();
  await page.waitForSelector('.page');
  s = await snap();
  ok(s.index === 1 && s.title === 'Livro de Teste', 'posição preservada após recarregar');
  await go('#/historico');
  ok(await page.locator('.history-item').count() === 1, 'histórico mostra o livro com último capítulo e posição');
  await shot('06-historico');

  step('11. Backup completo (com áudio), apagar tudo e restaurar — offline');
  await go('#/configuracoes');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Backup completo/ }).click();
  const download = await dl;
  const backupPath = join(SHOTS, 'backup.audiobook');
  await download.saveAs(backupPath);
  const size = readFileSync(backupPath).length;
  ok(size > 100000, `backup gerado (${(size / 1024).toFixed(0)} KB)`);
  await page.evaluate(() => window.AUDIOBOOK.repo.deleteAllData());
  await sleep(300);
  ok(await page.evaluate(() => window.AUDIOBOOK.state.books.size === 0), 'biblioteca apagada');
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Importar dados ou backup/ }).click();
  await (await fc).setFiles(backupPath);
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.getByText('Importação concluída').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Entendi' }).click();
  const restored = await page.evaluate(async () => {
    const b = [...window.AUDIOBOOK.state.books.values()][0];
    return { title: b?.title, ok: b ? (await window.AUDIOBOOK.repo.verifyBookAudio(b.id)).ok : false, progress: !!window.AUDIOBOOK.repo.getProgress(b?.id) };
  });
  ok(restored.title === 'Livro de Teste' && restored.ok && restored.progress, 'livro, áudio e progresso restaurados do backup');

  step('12. Remover audiolivro (com confirmação)');
  const id = await page.evaluate(() => [...window.AUDIOBOOK.state.books.keys()][0]);
  await go(`#/livro/${id}`);
  await page.getByRole('button', { name: 'Mais opções' }).click();
  await page.getByRole('menuitem', { name: 'Remover audiolivro' }).click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await waitFor(() => window.AUDIOBOOK.state.books.size === 0);
  const leftovers = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('audiobook');
    r.onsuccess = () => { const q = r.result.transaction('audio').objectStore('audio').count(); q.onsuccess = () => res(q.result); };
  }));
  ok(leftovers === 0, 'áudio removido do armazenamento (sem sobras)');
  await ctx.setOffline(false);
} catch (err) {
  failures++;
  console.error('\n✗ ERRO:', err.message);
  await shot('erro').catch(() => {});
} finally {
  const relevant = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  ok(relevant.length === 0, `sem erros de JavaScript no console${relevant.length ? ': ' + relevant.join(' | ') : ''}`);
  console.log(`\n${passes} verificações OK, ${failures} falha(s). Capturas em ${SHOTS}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}
