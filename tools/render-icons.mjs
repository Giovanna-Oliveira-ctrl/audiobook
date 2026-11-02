// Gera os ícones PNG a partir dos SVGs (requer Playwright: npx playwright / chromium).
// Uso: node tools/render-icons.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rounded = readFileSync(join(root, 'icons/favicon.svg'), 'utf8');
const full = readFileSync(join(root, 'tools/icon-maskable.svg'), 'utf8');
// Ícone "any": fundo transparente fora do quadrado arredondado.
const jobs = [
  ['icons/icon-32.png', rounded, 32],
  ['icons/icon-96.png', rounded, 96],
  ['icons/icon-192.png', rounded, 192],
  ['icons/icon-512.png', rounded, 512],
  ['icons/maskable-192.png', full, 192],
  ['icons/maskable-512.png', full, 512],
  ['icons/apple-touch-icon.png', full.replace('scale(0.72)', 'scale(0.86)'), 180],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, svg, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✓', out);
}
await browser.close();
