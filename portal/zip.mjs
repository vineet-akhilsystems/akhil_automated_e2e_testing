// Minimal zip reader/writer on node:zlib only (no zip64; callers keep archives under 4 GB).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const dosTime = (d = new Date()) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

export function crc32File(file) {
  return new Promise((resolve, reject) => {
    let crc = 0;
    fs.createReadStream(file).on('data', c => { crc = zlib.crc32(c, crc); }).on('end', () => resolve(crc >>> 0)).on('error', reject);
  });
}

// entries: [{ name, data: Buffer|string } | { name, file, size }]  (files are stored uncompressed and streamed)
export function zipStream(entries) {
  async function* generate() {
    const central = []; let offset = 0;
    const { time, date } = dosTime();
    for (const entry of entries) {
      const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      let method = 0, crc, size, compressed, body;
      if (entry.file) { size = entry.size ?? fs.statSync(entry.file).size; compressed = size; crc = await crc32File(entry.file); }
      else {
        const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
        size = raw.length; crc = zlib.crc32(raw) >>> 0;
        const deflated = zlib.deflateRawSync(raw);
        if (deflated.length < raw.length) { method = 8; body = deflated; } else body = raw;
        compressed = body.length;
      }
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(method, 8);
      header.writeUInt16LE(time, 10); header.writeUInt16LE(date, 12); header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(compressed, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
      yield header; yield name;
      if (entry.file) { for await (const chunk of fs.createReadStream(entry.file)) yield chunk; } else yield body;
      central.push({ name, method, crc, compressed, size, offset, time, date });
      offset += 30 + name.length + compressed;
    }
    let cdSize = 0;
    for (const e of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12); h.writeUInt16LE(e.date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.compressed, 20); h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28); h.writeUInt32LE(e.offset, 42);
      yield h; yield e.name; cdSize += 46 + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
    yield end;
  }
  return Readable.from(generate());
}

export async function zipBuffer(entries) {
  const chunks = [];
  for await (const c of zipStream(entries)) chunks.push(c);
  return Buffer.concat(chunks);
}

// Returns Map<name, () => Buffer>. Rejects entries that are too large to inflate safely.
export function readZip(buffer, { maxEntryBytes = 100 * 1024 * 1024 } = {}) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip archive.');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const method = buffer.readUInt16LE(p + 10), csize = buffer.readUInt32LE(p + 20), usize = buffer.readUInt32LE(p + 24);
    const nlen = buffer.readUInt16LE(p + 28), elen = buffer.readUInt16LE(p + 30), clen = buffer.readUInt16LE(p + 32), local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nlen);
    entries.set(name, () => {
      if (usize > maxEntryBytes) throw new Error('Archive entry is too large.');
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: maxEntryBytes });
      throw new Error(`Unsupported zip method ${method}.`);
    });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}
