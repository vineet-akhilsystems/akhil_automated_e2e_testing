import fs from 'node:fs';
import path from 'node:path';
import { check } from '../registry.mjs';

export function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
}
export async function file(res, filename, download, downloadName) {
  check(fs.existsSync(filename) && fs.statSync(filename).isFile(), 'File not found.', 404);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.md': 'text/plain', '.log': 'text/plain', '.zip': 'application/zip', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  res.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store',
    ...(download ? { 'Content-Disposition': `attachment; filename="${downloadName ?? path.basename(filename)}"` } : {}) });
  fs.createReadStream(filename).pipe(res);
}
export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
