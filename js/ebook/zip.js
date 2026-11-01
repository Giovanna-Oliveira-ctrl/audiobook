/* Leitor mínimo de ZIP (para EPUB), sem dependências.
 * Descompacta com a API nativa DecompressionStream('deflate-raw'). */

export async function openZip(file) {
  const size = file.size;
  // Fim do diretório central: procura a assinatura nos últimos 64 KB.
  const tailStart = Math.max(0, size - 65557);
  const tail = new DataView(await file.slice(tailStart, size).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo não é um EPUB/ZIP válido.');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = new Map();
  const dec = new TextDecoder('utf-8');
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const rawSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.set(name, { name, method, compSize, rawSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function bytes(name) {
    const e = entries.get(name) || findCaseInsensitive(name);
    if (!e) return null;
    const head = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error(`Entrada corrompida no EPUB: ${name}`);
    const start = e.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const data = file.slice(start, start + e.compSize);
    if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
    if (e.method !== 8) throw new Error(`Compressão não suportada (${e.method}) em ${name}`);
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não consegue abrir EPUB (sem DecompressionStream). Atualize o navegador.');
    const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function findCaseInsensitive(name) {
    const lower = name.toLowerCase();
    for (const [k, v] of entries) if (k.toLowerCase() === lower) return v;
    return null;
  }

  return {
    entries,
    has: (name) => entries.has(name) || !!findCaseInsensitive(name),
    bytes,
    async text(name) {
      const b = await bytes(name);
      return b ? new TextDecoder('utf-8').decode(b) : null;
    },
    async blob(name, type) {
      const b = await bytes(name);
      return b ? new Blob([b], { type }) : null;
    },
  };
}
