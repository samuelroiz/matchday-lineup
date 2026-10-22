// Read a spreadsheet into rows of strings: CSV text, or an .xlsx file (the first sheet).
// No library: an .xlsx is a zip of XML files, unzipped with the built-in DecompressionStream
// (browsers and Node 18+). Pure apart from that, so it is tested in Node.

/** CSV text -> rows (arrays of strings). Handles quotes, "" escapes, CRLF, a BOM, and ; or tab delimiters. */
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let atStart = true; // a quote only opens a quoted field at its very start, so 6'1" stays as typed
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; continue; }
    if (ch === delimiter) { row.push(field); field = ''; atStart = true; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atStart = true;
      continue;
    }
    field += ch;
    atStart = false;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The first line's most common separator outside quotes (Excel in some countries uses ;).
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n ? best : ',';
}

// ---------- zip ----------

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Zip archive -> Map(name -> { method, data: compressed bytes }). */
function readZipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx spreadsheet.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('This .xlsx file looks damaged.');
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    entries.set(name, { method, data: bytes.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate({ method, data }) {
  if (method === 0) return data;
  if (method !== 8) throw new Error('This .xlsx file uses a compression this app cannot read. Save it again, or as CSV.');
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV instead.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- SpreadsheetML ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});
const attr = (attrs, name) => new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;
// Tags may carry a namespace prefix (x:c) in files from some tools.
const tagRe = (name, flags = 'g') => new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, flags);
// All the <t> text inside a string item (plain or rich text runs), ignoring phonetic hints.
const textOf = (xml = '') => [...xml.replace(tagRe('rPh'), '').matchAll(tagRe('t'))].map((m) => decodeXml(m[2] || '')).join('');

/** "BC12" -> column index 54 (0-based). */
const columnIndex = (ref) => [...ref.replace(/\d+$/, '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** .xlsx bytes -> rows of strings from the first sheet. */
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = readZipEntries(bytes);
  const read = async (name) => {
    const e = zip.get(name);
    return e ? new TextDecoder().decode(await inflate(e)) : null;
  };
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not a valid .xlsx spreadsheet.');
  // First sheet in the workbook's tab order, found through the workbook relationships.
  const firstSheet = tagRe('sheet').exec(workbook);
  const relId = firstSheet && attr(firstSheet[1], 'id');
  const rels = (await read('xl/_rels/workbook.xml.rels')) || '';
  const rel = [...rels.matchAll(tagRe('Relationship'))].find((m) => attr(m[1], 'Id') === relId);
  let target = rel ? attr(rel[1], 'Target') : 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = await read(target);
  if (!sheet) throw new Error('Could not find the first sheet in this .xlsx file.');

  const shared = [...((await read('xl/sharedStrings.xml')) || '').matchAll(tagRe('si'))].map((m) => textOf(m[2]));
  const rows = [];
  for (const rowMatch of sheet.matchAll(tagRe('row'))) {
    const r = Number(attr(rowMatch[1], 'r')) || rows.length + 1;
    const cells = [];
    let next = 0;
    for (const c of (rowMatch[2] || '').matchAll(tagRe('c'))) {
      const ref = attr(c[1], 'r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = attr(c[1], 't');
      const inner = c[2] || '';
      const v = tagRe('v', '').exec(inner);
      const raw = v ? decodeXml(v[2] || '') : '';
      let value;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(tagRe('is', '').exec(inner)?.[2]);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
      else value = raw;
      cells[col] = value;
    }
    rows[r - 1] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}

/** Rows from a File: .xlsx by name or zip signature, anything else as CSV text. */
export async function readSheetFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(file.name || '')) return readXlsx(bytes);
  if (/\.xls$/i.test(file.name || '')) throw new Error('Old .xls files are not supported. Save the sheet as .xlsx or CSV.');
  return parseCsv(new TextDecoder().decode(bytes));
}

/** Rows -> CSV text (for the template download). */
export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + '\r\n';
}
