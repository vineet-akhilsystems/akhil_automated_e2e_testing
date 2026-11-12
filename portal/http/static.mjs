import fs from 'node:fs';
import path from 'node:path';
import { check } from '../registry.mjs';
import { file } from './respond.mjs';

const ROOT_FILES = { '/': 'index.html', '/app.js': 'app.js', '/api.js': 'api.js', '/boot.js': 'boot.js', '/permissions.js': 'permissions.js', '/router.js': 'router.js', '/state.js': 'state.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
// Browser modules live one level down; only plain lowercase module names are served (no dots, no traversal).
const NESTED_MODULE = /^\/(?:pages|components|handlers)\/[a-z0-9-]+\.js$/;

export async function serveStatic(req, res, publicDir) {
  const route = new URL(req.url, 'http://localhost').pathname;
  check(['GET', 'HEAD'].includes(req.method), 'Method not allowed.', 405);
  const target = ROOT_FILES[route] ?? (NESTED_MODULE.test(route) ? route.slice(1) : null);
  check(target, 'Page not found.', 404);
  const filename = path.join(publicDir, target);
  check(fs.existsSync(filename) && fs.statSync(filename).isFile(), 'Page not found.', 404);
  await file(res, filename, false);
  return true;
}
