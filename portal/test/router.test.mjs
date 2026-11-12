import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRouter } from '../http/router.mjs';
import { boot } from './support.mjs';

test('router: a handler that wrote the response and returned undefined stops the chain', async () => {
  let bRan = false;
  const res = { headersSent: false, writeHead() { this.headersSent = true; }, end() {} };
  const router = createRouter([async (ctx, rc) => { rc.res.writeHead(200); rc.res.end('x'); }, async () => { bRan = true; return true; }]);
  assert.equal(await router({}, { res }), true);
  assert.equal(bRan, false);
});

test('router: a truthy return still stops the chain; no handler and no response returns false', async () => {
  let bRan = false;
  const res = { headersSent: false };
  assert.equal(await createRouter([async () => true, async () => { bRan = true; return true; }])({}, { res }), true);
  assert.equal(bRan, false);
  assert.equal(await createRouter([async () => false, async () => undefined])({}, { res }), false);
});

test('moved routes keep the keep-alive connection open after responding', async t => {
  const f = await boot(t);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const get = route => new Promise((resolve, reject) => {
    const req = http.get(f.base + route, { agent }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, reused: req.reusedSocket, body: Buffer.concat(chunks) })); res.on('error', reject); });
    req.on('error', reject);
  });
  const first = await get('/api/products');
  assert.equal(first.status, 200);
  const second = await get('/api/products');
  assert.equal(second.status, 200);
  assert.equal(second.reused, true, 'second request must reuse the socket');
});
