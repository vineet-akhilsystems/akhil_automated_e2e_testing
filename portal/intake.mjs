import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { HttpError, check } from './registry.mjs';
import { readZip } from './zip.mjs';
import { extractVideo, NEEDS_TRANSCRIPT } from '../qa/tools/extract-video-intake.mjs';

const require = createRequire(import.meta.url);
const MAX_TEXT = 2_000_000, MAX_ROWS = 500, MAX_COLS = 60;

const KINDS = {
  sheet: ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv'], doc: ['.docx', '.doc', '.rtf', '.odt'], pdf: ['.pdf'],
  text: ['.txt', '.md', '.markdown', '.log'], data: ['.json', '.xml', '.yaml', '.yml'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'], video: ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'],
};
const MIME = { '.pdf': 'application/pdf', '.json': 'application/json', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
export const kindOf = name => { const ext = path.extname(name).toLowerCase(); return Object.entries(KINDS).find(([, list]) => list.includes(ext))?.[0] ?? 'other'; };

export function parseCsv(text, delimiter = ',') {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c !== '')) rows.push(row); row = []; if (rows.length > MAX_ROWS) break; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row); }
  return rows.slice(0, MAX_ROWS + 1).map(r => r.slice(0, MAX_COLS));
}
const tableText = (name, rows) => `## ${name}\n${rows.map(r => r.join(' | ')).join('\n')}`;

async function extractXlsx(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const tables = [];
  wb.eachSheet(ws => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, row => {
      if (rows.length > MAX_ROWS) return;
      const values = []; const count = Math.min(ws.columnCount || row.cellCount, MAX_COLS);
      for (let c = 1; c <= count; c++) { let t = ''; try { t = String(row.getCell(c).text ?? ''); } catch { /* formula/rich text edge */ } values.push(t.replace(/\s+/g, ' ').trim()); }
      if (values.some(Boolean)) rows.push(values);
    });
    if (rows.length) tables.push({ name: ws.name, rows });
  });
  return { text: tables.map(t => tableText(t.name, t.rows)).join('\n\n'), tables };
}
const xmlText = xml => xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function extractDocx(file) {
  const zip = readZip(fs.readFileSync(file), { maxEntryBytes: 50 * 1024 * 1024 });
  const doc = zip.get('word/document.xml');
  check(doc, 'Not a Word document (word/document.xml missing).');
  const text = xmlText(doc().toString('utf8')).replace(/\n{3,}/g, '\n\n').trim();
  return { text, tables: [] };
}
// Best-effort PDF text: inflate content streams and read text operators. Scanned or font-encoded PDFs yield little or nothing.
function extractPdf(file) {
  const buf = fs.readFileSync(file);
  check(buf.length < 200 * 1024 * 1024, 'PDF is too large to read.');
  const raw = buf.toString('latin1'); const out = [];
  const unescape = s => s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[c] ?? (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ''));
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const dict = raw.slice(Math.max(0, m.index - 300), m.index);
    let data = buf.subarray(start, end);
    if (/FlateDecode/.test(dict.slice(dict.lastIndexOf('<<')))) { try { data = zlib.inflateSync(data, { maxOutputLength: 50 * 1024 * 1024 }); } catch { re.lastIndex = end; continue; } }
    const content = data.toString('latin1');
    if (!/\bBT\b/.test(content)) { re.lastIndex = end; continue; }
    for (const block of content.split(/\bBT\b/).slice(1)) {
      const body = block.split(/\bET\b/)[0]; let line = '';
      for (const op of body.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm)\b/g)) {
        if (op[1] !== undefined) line += [...op[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|(-?\d+(?:\.\d+)?)/g)].map(x => x[1] !== undefined ? unescape(x[1]) : (Number(x[2]) < -250 ? ' ' : '')).join('');
        else if (op[2] !== undefined) line += unescape(op[2]);
        else if (line && !line.endsWith('\n')) line += '\n';
      }
      if (line.trim()) out.push(line.trim());
    }
    re.lastIndex = end;
  }
  const text = out.join('\n');
  const printable = (text.match(/[\x20-\x7E\n]/g) ?? []).length;
  check(text.trim().length >= 20 && printable / text.length > 0.8, 'No readable text found (scanned or font-encoded PDF). Provide a text version.');
  return { text, tables: [] };
}
function readHead(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(Math.min(bytes, fs.statSync(file).size)); fs.readSync(fd, b, 0, b.length, 0); return b.toString('utf8'); } finally { fs.closeSync(fd); }
}

// Returns { status: 'ok'|'partial'|'unsupported'|'error', text, tables, note, frames? }.
// 'partial' = video keyframes only (no transcript): readable, but visuals are NOT interpreted.
// opts (video only): { framesDir, sidecars: [{name, path}], exec } - exec is injectable for tests.
export async function extractContent(file, name, opts = {}) {
  const ext = path.extname(name).toLowerCase(), kind = kindOf(name);
  try {
    let result;
    const size = fs.statSync(file).size;
    if (['.xlsx', '.xlsm', '.docx', '.pdf'].includes(ext) && size > 100 * 1024 * 1024) return { status: 'unsupported', text: '', tables: [], note: 'File is over 100 MB; text was not extracted. It is still stored and in the pack.' };
    if (['.csv', '.tsv'].includes(ext)) { const rows = parseCsv(readHead(file, 8_000_000), ext === '.tsv' ? '\t' : ','); result = { text: tableText(name, rows), tables: [{ name, rows }] }; }
    else if (kind === 'text' || ['.json', '.xml', '.yaml', '.yml'].includes(ext)) result = { text: readHead(file, 8_000_000), tables: [] };
    else if (['.xlsx', '.xlsm'].includes(ext)) result = await extractXlsx(file);
    else if (ext === '.docx') result = extractDocx(file);
    else if (ext === '.pdf') result = extractPdf(file);
    else if (kind === 'video') {
      // Optional local extraction (ffmpeg keyframes + sidecar/whisper transcript); only when the caller supplies a frames dir.
      if (!opts.framesDir) return { status: 'unsupported', text: '', tables: [], note: NEEDS_TRANSCRIPT };
      const v = await extractVideo(file, name, opts);
      return { ...v, text: v.text.slice(0, MAX_TEXT) };
    }
    else if (kind === 'image') return { status: 'unsupported', text: '', tables: [], note: 'Image stored; text is not extracted from images.' };
    else return { status: 'unsupported', text: '', tables: [], note: 'This file type cannot be read; it is stored and included in the module pack.' };
    result.text = result.text.slice(0, MAX_TEXT);
    return { status: 'ok', ...result };
  } catch (e) {
    return { status: 'error', text: '', tables: [], note: e instanceof HttpError ? e.message : `Could not read this file (${String(e.message ?? e).slice(0, 160)}).` };
  }
}

export const EXTRACTOR_VERSION = 1;
const hashFile = file => new Promise((resolve, reject) => {
  const h = createHash('sha256'), s = fs.createReadStream(file);
  s.on('data', c => h.update(c)); s.on('error', reject); s.on('end', () => resolve(h.digest('hex')));
});

export function createIntake({ dataDir, store, maxMb = Number(process.env.INTAKE_MAX_MB) || 2048, exec }) {
  const root = path.join(dataDir, 'intake');
  const maxBytes = maxMb * 1024 * 1024;
  const dirFor = moduleId => { check(/^[\w-]+$/.test(moduleId), 'Invalid module.'); const d = path.join(root, moduleId); fs.mkdirSync(d, { recursive: true }); return d; };
  const pending = new Map();
  const pub = f => ({ id: f.id, name: f.name, size: f.size, type: f.type, kind: f.kind, uploadedBy: f.uploadedBy, uploadedAt: f.uploadedAt, note: f.note, extract: f.extract, chars: f.chars, ...(f.sha256 ? { sha256: f.sha256 } : {}), ...(f.processedAt ? { processedAt: f.processedAt, extractorVersion: f.extractorVersion } : {}), ...(f.extractNote ? { extractNote: f.extractNote } : {}) });
  const diskPath = f => path.join(dirFor(f.moduleId), f.storedAs);
  const extractPath = f => `${diskPath(f)}.extract.json`;
  const framesDirFor = f => path.join(dirFor(f.moduleId), `${f.id}-frames`);

  // Marks a source as failed with a reason (a stuck 'pending' must never stay silent).
  function markError(f, reason) {
    try {
      const latest = store.intakeFile(f.moduleId, f.id);
      if (latest) store.saveIntakeFile({ ...latest, extract: 'error', chars: 0, extractNote: reason, processedAt: new Date().toISOString(), extractorVersion: EXTRACTOR_VERSION });
    } catch { /* store closed */ }
  }
  function extractFile(f) {
    if (pending.has(f.id)) return pending.get(f.id);
    const job = (async () => {
      try {
        const opts = f.kind === 'video' ? { framesDir: framesDirFor(f), exec,
          sidecars: store.intakeFiles(f.moduleId).filter(o => o.id !== f.id).map(o => ({ name: o.name, path: diskPath(o) })) } : {};
        const result = await extractContent(diskPath(f), f.name, opts);
        const latest = store.intakeFile(f.moduleId, f.id);
        if (!latest) { fs.rmSync(framesDirFor(f), { recursive: true, force: true }); return result; } // deleted meanwhile
        if (result.status === 'ok' || result.status === 'partial') fs.writeFileSync(extractPath(f), JSON.stringify({ text: result.text, tables: result.tables, ...(result.frames ? { frames: result.frames } : {}) }));
        const updated = { ...latest, extract: result.status, chars: result.text.length, extractNote: result.note ?? '', processedAt: new Date().toISOString(), extractorVersion: EXTRACTOR_VERSION };
        store.saveIntakeFile(updated);
        return result;
      } catch (e) {
        const note = `Processing failed (${String(e?.message ?? e).slice(0, 160)}). Upload the file again or add a transcript or document instead.`;
        markError(f, note);
        return { status: 'error', text: '', tables: [], note };
      }
    })().finally(() => pending.delete(f.id));
    pending.set(f.id, job);
    return job;
  }
  // Startup resume: every source left 'pending' (the portal stopped mid-extraction) is queued again, one at a time.
  // Idempotent: a partial frames folder is cleared first and rebuilt.
  async function resume() {
    let files; try { files = store.pendingIntakeFiles(); } catch { return 0; }
    let n = 0;
    for (const f of files) {
      try {
        if (!fs.existsSync(diskPath(f))) { markError(f, 'The stored file is missing, so it could not be processed. Upload it again.'); continue; }
        fs.rmSync(framesDirFor(f), { recursive: true, force: true }); fs.rmSync(extractPath(f), { force: true });
        await extractFile(f); n++;
      } catch { /* store closed or one bad file: keep going */ }
    }
    return n;
  }
  // Fingerprints files stored before hashing existed. Sequential, idempotent, safe to run on every start.
  async function backfill() {
    let files; try { files = store.intakeFilesWithoutSha(); } catch { return 0; }
    let n = 0;
    for (const f of files) {
      try {
        if (!fs.existsSync(diskPath(f))) continue;
        const sha256 = await hashFile(diskPath(f));
        const latest = store.intakeFile(f.moduleId, f.id);
        if (latest && !latest.sha256) { store.saveIntakeFile({ ...latest, sha256 }); n++; }
      } catch { /* unreadable file or store closed */ }
    }
    return n;
  }
  let hashing = Promise.resolve(0);
  return {
    root, maxBytes, pub, resume, backfill: () => (hashing = backfill()),
    list: moduleId => store.intakeFiles(moduleId).map(pub),
    filePath: diskPath,
    // Streams the raw request body to disk; never buffers the file in memory.
    async receive(req, moduleId, user) {
      let name;
      try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')); } catch { throw new HttpError(400, 'x-file-name must be URL-encoded.'); }
      name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim().slice(0, 200);
      check(name && name !== '.' && name !== '..', 'Send the file name in the x-file-name header.');
      let note = ''; try { note = decodeURIComponent(String(req.headers['x-file-note'] ?? '')).slice(0, 1000); } catch { /* ignore malformed note */ }
      const declared = Number(req.headers['content-length']);
      check(!(declared > maxBytes), `File is too large (maximum ${maxMb} MB).`, 413);
      const id = randomUUID(), ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) ?? [''])[0];
      const storedAs = `${id}${ext}`, target = path.join(dirFor(moduleId), storedAs), part = `${target}.part`;
      let size = 0;
      const hash = createHash('sha256');
      const counter = new Transform({ transform(chunk, _enc, cb) { size += chunk.length; if (size > maxBytes) cb(new HttpError(413, `File is too large (maximum ${maxMb} MB).`)); else { hash.update(chunk); cb(null, chunk); } } });
      try { await pipeline(req, counter, fs.createWriteStream(part)); }
      catch (e) { fs.rmSync(part, { force: true }); throw e instanceof HttpError ? e : new HttpError(400, 'Upload was interrupted.'); }
      if (size === 0) { fs.rmSync(part, { force: true }); throw new HttpError(400, 'The uploaded file is empty.'); }
      const sha256 = hash.digest('hex');
      await hashing; // files stored before hashing existed are fingerprinted first, so they can be matched too
      const existing = store.intakeFileBySha(moduleId, sha256);
      if (existing) {
        // Identical bytes already stored for this module: keep one record, add the note, run no extraction.
        fs.rmSync(part, { force: true });
        const merged = note ? { ...existing, note: [existing.note, `${name}: ${note}`].filter(Boolean).join(' | ').slice(0, 4000) } : existing;
        if (note) store.saveIntakeFile(merged);
        return { ...pub(merged), duplicateOf: existing.id, duplicate: true, message: `This file was already uploaded as ${existing.name}.` };
      }
      fs.renameSync(part, target);
      const kind = kindOf(name);
      const record = { id, moduleId, name, storedAs, size, kind, type: String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase().replace(/^application\/octet-stream$/, '') || MIME[ext] || 'application/octet-stream',
        uploadedBy: user.username, uploadedAt: new Date().toISOString(), note, sha256, extract: 'pending', chars: 0 };
      store.saveIntakeFile(record);
      setImmediate(() => extractFile(record).catch(() => {}));
      return pub(record);
    },
    // Makes sure every file has an extraction result; returns [{file, extract}].
    // Folder holding a video's extracted keyframe images (frame-001.jpg ...); may not exist.
    framesPath: f => framesDirFor(f),
    async ensureExtracted(files) {
      const out = [];
      for (const f of files) {
        let current = store.intakeFile(f.moduleId, f.id) ?? f;
        if (current.extract === 'pending') { await extractFile(current); current = store.intakeFile(f.moduleId, f.id) ?? current; }
        let content = { text: '', tables: [] };
        if (current.extract === 'ok' || current.extract === 'partial') { try { content = JSON.parse(fs.readFileSync(extractPath(current), 'utf8')); } catch { /* treat as empty */ } }
        out.push({ file: current, content });
      }
      return out;
    },
    remove(f) {
      store.deleteIntakeFile(f.id);
      fs.rmSync(diskPath(f), { force: true }); fs.rmSync(extractPath(f), { force: true });
      fs.rmSync(framesDirFor(f), { recursive: true, force: true });
    },
  };
}
