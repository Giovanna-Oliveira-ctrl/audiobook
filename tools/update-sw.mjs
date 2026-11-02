// Atualiza a lista de arquivos pré-carregados e a versão do Service Worker.
// Rode sempre que alterar/adicionar arquivos do app:  node tools/update-sw.mjs
// A versão é um hash do conteúdo: qualquer mudança gera uma nova versão (e o aviso "Atualizar" no app).

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const include = ['index.html', 'manifest.json', 'css', 'js', 'icons'];

function walk(p) {
  const full = join(root, p);
  if (statSync(full).isDirectory()) return readdirSync(full).sort().flatMap((f) => walk(join(p, f)));
  return [p];
}

const files = include.flatMap(walk).map((f) => f.split('\\').join('/'));
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const version = new Date().toISOString().slice(0, 10) + '-' + hash.digest('hex').slice(0, 8);

const assets = ['./', ...files.map((f) => `./${f}`)];
const block = `// @generated-start\nconst VERSION = '${version}';\nconst ASSETS = [\n${assets.map((a) => `  '${a}',`).join('\n')}\n];\n// @generated-end`;

const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
writeFileSync(swPath, sw.replace(/\/\/ @generated-start[\s\S]*?\/\/ @generated-end/, block));
console.log(`sw.js atualizado: versão ${version}, ${assets.length} arquivos.`);
