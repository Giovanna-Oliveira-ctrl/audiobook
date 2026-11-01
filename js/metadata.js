/* Leitura de metadados embutidos, 100% local (sem internet):
 *  - MP3: ID3v2.2/2.3/2.4 (título, artista, álbum, gênero, faixa, capa APIC, capítulos CHAP)
 *  - M4A/M4B/MP4: átomos iTunes (©nam, ©ART, ©alb, ©gen, trkn, covr...) e capítulos Nero (chpl)
 * Falhas aqui nunca impedem a importação: retornamos {} e seguimos. */

const latin1 = (bytes, start, len) => {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function decode(bytes, enc) {
  let label = enc === 0 ? 'iso-8859-1' : enc === 3 ? 'utf-8' : enc === 2 ? 'utf-16be' : 'utf-16le';
  if (enc === 1 && bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) { label = 'utf-16be'; bytes = bytes.subarray(2); }
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) { label = 'utf-16le'; bytes = bytes.subarray(2); }
  }
  try {
    return new TextDecoder(label).decode(bytes).split('\0')[0].trim();
  } catch {
    return '';
  }
}

/** Fim de uma string terminada em \0 (1 byte para latin1/utf8, 2 bytes para utf16). */
function stringEnd(bytes, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    return bytes.length;
  }
  const i = bytes.indexOf(0, start);
  return i < 0 ? bytes.length : i;
}
const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

function unsync(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

const ID3_GENRES = { 0: 'Blues', 12: 'Outros', 28: 'Vocal', 32: 'Clássica', 57: 'Comédia', 101: 'Fala', 183: 'Audiolivro' };

function cleanGenre(g) {
  if (!g) return '';
  const m = g.match(/^\((\d+)\)(.*)$/);
  if (m) return m[2].trim() || ID3_GENRES[m[1]] || '';
  if (/^\d+$/.test(g)) return ID3_GENRES[g] || '';
  return g;
}

export async function readTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return await readID3(file, head);
    if (latin1(head, 4, 4) === 'ftyp') return await readMP4(file);
  } catch (err) {
    console.warn('[metadata] não foi possível ler as tags de', file.name, err);
  }
  return {};
}

/* ------------------------------- ID3 -------------------------------- */

async function readID3(file, head) {
  const ver = head[3];
  const flags = head[5];
  const size = syncsafe(head, 6);
  const len = Math.min(size, 20 * 1024 * 1024);
  let data = new Uint8Array(await file.slice(10, 10 + len).arrayBuffer());
  if (flags & 0x80 && ver < 4) data = unsync(data);
  let pos = 0;
  if (flags & 0x40 && ver >= 3) pos += ver === 4 ? syncsafe(data, 0) : u32(data, 0) + 4;

  const tags = {};
  const chapters = [];
  parseFrames(data, pos, data.length, ver, tags, chapters);
  if (chapters.length) tags.chapters = chapters.sort((a, b) => a.start - b.start);
  if (tags.genre) tags.genre = cleanGenre(tags.genre);
  return tags;
}

function parseFrames(data, pos, end, ver, tags, chapters) {
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen <= end) {
    const id = latin1(data, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize =
      ver === 2 ? (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5] : ver === 4 ? syncsafe(data, pos + 4) : u32(data, pos + 4);
    const fflags = ver >= 3 ? data[pos + 9] : 0;
    const start = pos + hdrLen;
    const fend = start + fsize;
    if (fsize <= 0 || fend > end) break;
    let frame = data.subarray(start, fend);
    const skip = ver === 4 ? fflags & 0x0c : ver === 3 ? fflags & 0xc0 : 0; // compressão/criptografia
    if (!skip) {
      if (ver === 4 && fflags & 0x02) frame = unsync(frame);
      if (ver === 4 && fflags & 0x01) frame = frame.subarray(4);
      try {
        handleFrame(id, frame, ver, tags, chapters);
      } catch {}
    }
    pos = fend;
  }
}

const TEXT_FRAMES = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist',
  TALB: 'album', TAL: 'album', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year', TDRC: 'year',
  TRCK: 'track', TRK: 'track', TPOS: 'disc', TPA: 'disc', TCOM: 'composer', TCM: 'composer', TPE3: 'conductor',
};

function handleFrame(id, f, ver, tags, chapters) {
  if (TEXT_FRAMES[id]) {
    const v = decode(f.subarray(1), f[0]);
    const key = TEXT_FRAMES[id];
    if (!v) return;
    if (key === 'track' || key === 'disc') {
      const [n, total] = v.split('/').map((x) => parseInt(x, 10));
      if (Number.isFinite(n)) tags[key] = n;
      if (key === 'track' && Number.isFinite(total)) tags.trackTotal = total;
    } else if (key === 'year') tags.year = v.slice(0, 4);
    else if (!tags[key]) tags[key] = v;
    return;
  }
  if (id === 'TXXX') {
    const enc = f[0];
    const dEnd = stringEnd(f, 1, enc);
    const desc = decode(f.subarray(1, dEnd), enc);
    const value = decode(f.subarray(dEnd + termLen(enc)), enc);
    if (/narrat|reader|leitor/i.test(desc) && value) tags.narrator = value;
    return;
  }
  if (id === 'COMM' || id === 'COM' || id === 'USLT') {
    const enc = f[0];
    const dEnd = stringEnd(f, 4, enc);
    const text = decode(f.subarray(dEnd + termLen(enc)), enc);
    if (text && text.length > (tags.comment?.length || 0) && !/^(\d+|[0-9A-F ]{20,})$/.test(text)) tags.comment = text;
    return;
  }
  if (id === 'APIC' || id === 'PIC') {
    const enc = f[0];
    let p = 1;
    let mime;
    if (id === 'PIC') {
      const fmt = latin1(f, 1, 3).toLowerCase();
      mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      p = 4;
    } else {
      const mEnd = f.indexOf(0, 1);
      mime = latin1(f, 1, mEnd - 1) || 'image/jpeg';
      if (!mime.includes('/')) mime = `image/${mime.toLowerCase()}`;
      p = mEnd + 1;
    }
    const type = f[p];
    p += 1;
    p = stringEnd(f, p, enc) + termLen(enc);
    const data = f.slice(p);
    if (data.length > 100 && (!tags.picture || type === 3)) tags.picture = { mime, data };
    return;
  }
  if (id === 'CHAP' && ver >= 3) {
    const idEnd = f.indexOf(0);
    let p = idEnd + 1;
    const startMs = u32(f, p);
    const endMs = u32(f, p + 4);
    p += 16;
    const sub = {};
    parseFrames(f, p, f.length, ver, sub, []);
    chapters.push({ start: startMs / 1000, end: endMs / 1000, title: sub.title || '' });
  }
}

/* ------------------------------- MP4 -------------------------------- */

function* boxes(dv, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let len = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    let hl = 8;
    if (len === 1) {
      len = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12);
      hl = 16;
    } else if (len === 0) len = end - p;
    if (len < hl || p + len > end) return;
    yield { type, start: p + hl, end: p + len };
    p += len;
  }
}

const findBox = (dv, start, end, type) => {
  for (const b of boxes(dv, start, end)) if (b.type === type) return b;
  return null;
};

async function readMP4(file) {
  let pos = 0;
  let moov = null;
  while (pos + 8 <= file.size) {
    const dv = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let len = dv.getUint32(0);
    const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
    let hl = 8;
    if (len === 1) {
      len = dv.getUint32(8) * 2 ** 32 + dv.getUint32(12);
      hl = 16;
    } else if (len === 0) len = file.size - pos;
    if (len < 8) break;
    if (type === 'moov') {
      if (len > 80 * 1024 * 1024) break;
      moov = new DataView(await file.slice(pos + hl, pos + len).arrayBuffer());
      break;
    }
    pos += len;
  }
  if (!moov) return {};

  const tags = {};
  const bytes = new Uint8Array(moov.buffer);
  const udta = findBox(moov, 0, moov.byteLength, 'udta');
  if (udta) {
    const meta = findBox(moov, udta.start, udta.end, 'meta');
    if (meta) {
      // "meta" é full box (4 bytes de versão/flags) — exceto em alguns arquivos QuickTime.
      const hasVersion = String.fromCharCode(...bytes.subarray(meta.start + 4, meta.start + 8)) !== 'hdlr';
      const s = meta.start + (hasVersion ? 4 : 0);
      const ilst = findBox(moov, s, meta.end, 'ilst');
      if (ilst) readIlst(moov, bytes, ilst, tags);
    }
    const chpl = findBox(moov, udta.start, udta.end, 'chpl');
    if (chpl) {
      const ch = readChpl(moov, bytes, chpl);
      if (ch.length) tags.chapters = ch;
    }
  }
  if (tags.genre) tags.genre = cleanGenre(tags.genre);
  return tags;
}

const ILST_KEYS = {
  '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', '©gen': 'genre',
  '©day': 'year', '©wrt': 'composer', '©nrt': 'narrator', desc: 'comment', ldes: 'comment', '©cmt': 'comment',
};

function readIlst(dv, bytes, ilst, tags) {
  for (const item of boxes(dv, ilst.start, ilst.end)) {
    const data = findBox(dv, item.start, item.end, 'data');
    if (!data) continue;
    const kind = dv.getUint32(data.start) & 0xffffff;
    const value = bytes.subarray(data.start + 8, data.end);
    const key = ILST_KEYS[item.type];
    if (key) {
      const text = new TextDecoder('utf-8').decode(value).trim();
      if (!text) continue;
      if (key === 'year') tags.year = text.slice(0, 4);
      else if (key === 'comment') {
        if (text.length > (tags.comment?.length || 0)) tags.comment = text;
      } else tags[key] = text;
    } else if (item.type === 'trkn' && value.length >= 6) {
      tags.track = (value[2] << 8) | value[3];
      tags.trackTotal = (value[4] << 8) | value[5];
    } else if (item.type === 'disk' && value.length >= 4) {
      tags.disc = (value[2] << 8) | value[3];
    } else if (item.type === 'gnre' && value.length >= 2 && !tags.genre) {
      tags.genre = ID3_GENRES[((value[0] << 8) | value[1]) - 1] || '';
    } else if (item.type === 'covr' && value.length > 100 && !tags.picture) {
      tags.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: value.slice() };
    }
  }
}

/** Capítulos no formato Nero ("chpl"), comuns em arquivos .m4b. */
function readChpl(dv, bytes, box) {
  const out = [];
  let p = box.start;
  const version = dv.getUint8(p);
  p += 4;
  if (version) p += 4;
  const count = dv.getUint8(p);
  p += 1;
  for (let i = 0; i < count && p + 9 <= box.end; i++) {
    const start = (dv.getUint32(p) * 2 ** 32 + dv.getUint32(p + 4)) / 1e7;
    const l = dv.getUint8(p + 8);
    p += 9;
    const title = new TextDecoder('utf-8').decode(bytes.subarray(p, p + l)).trim();
    p += l;
    out.push({ start, title });
  }
  return out.sort((a, b) => a.start - b.start);
}
