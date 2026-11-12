import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { createPortal } from '../server.mjs';

export function relaxApproval(store) {
  const original = store.saveModule;
  store.saveModule = (module, version) => original({ ...module, settings: { requireSecondApprover: false, ...(module.settings ?? {}) } }, version);
  store.db.exec(`UPDATE modules SET document=json_set(document,'$.settings.requireSecondApprover',json('false'))`);
}
// Boots a real portal on an ephemeral port with a temp data dir and a cookie-aware client.
export async function boot(t, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-portal-test-'));
  const authDir = path.join(directory, 'auth');
  fs.mkdirSync(authDir); fs.writeFileSync(path.join(authDir, 'admin.json'), '{}'); fs.writeFileSync(path.join(authDir, 'session.json'), '{}');
  const launches = [];
  const launch = (command, args, options) => { const child = new EventEmitter(); child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; }; launches.push({ command, args, options, child }); return child; };
  const p = createPortal({ dataDir: directory, environments: [{ id: 'local', name: 'Local', url: 'http://application.invalid', authDir }], launch, ...extra });
  // The second-approver rule defaults to on for every module in production. Most suites are about other things and
  // create and approve cases with one account, so new modules start with it off here; pass { strict: true } to keep the real default.
  if (!extra.strict) relaxApproval(p.store);
  await new Promise(resolve => p.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await p.close();
    const resolved = fs.realpathSync(directory);
    assert.ok(path.basename(resolved).startsWith('augastam-portal-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${p.server.address().port}`;
  // Each client keeps its own cookie, so several roles can act in one test.
  const client = () => {
    let cookie = '';
    const request = async (route, method = 'GET', body, headers = {}) => {
      const isBuffer = Buffer.isBuffer(body);
      const response = await fetch(base + route, { method, headers: { ...(body === undefined || isBuffer ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : isBuffer ? body : JSON.stringify(body) });
      const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      const type = response.headers.get('content-type') ?? '';
      const value = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
      return { status: response.status, value, response };
    };
    const login = (username, password) => request('/api/login', 'POST', { username, password });
    return { request, login };
  };
  return { ...p, base, directory, launches, client, request: client().request };
}
export async function signedIn(f, username, password) { const c = f.client(); const r = await c.login(username, password); assert.equal(r.status, 200, JSON.stringify(r.value)); return c; }
export async function makeUser(admin, username, role, password = 'password-' + username) {
  const r = await admin.request('/api/users', 'POST', { username, password, role, displayName: username });
  assert.equal(r.status, 201, JSON.stringify(r.value)); return { ...r.value, password };
}
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, ms = 10000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('Timed out waiting for condition'); await wait(40); } }
