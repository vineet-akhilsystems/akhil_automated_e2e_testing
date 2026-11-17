import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { until } from './support.mjs';
import { createAgentRunner, instructions } from '../agent.mjs';
import { resolveCodePaths, copyCodebase } from '../codebase.mjs';

const tmpDir = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-code-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const write = (root, rel, text) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function sampleProject(t) {
  const root = tmpDir(t);
  write(root, 'src/billing/invoice.service.ts', 'export const MIN_TOTAL = 1; // total must be at least 1\n');
  write(root, 'src/billing/messages.json', '{"min":"Total must be at least 1"}');
  write(root, 'src/.env', 'DB_PASSWORD=hunter2');
  write(root, 'src/.env.local', 'TOKEN=abc');
  write(root, 'src/server.key', 'not really a key');
  write(root, 'src/deploy.json', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----');
  write(root, 'src/node_modules/lib/index.js', 'module.exports = 1');
  write(root, 'src/logo.png', 'binary');
  write(root, 'src/package-lock.json', '{}');
  return root;
}

test('resolveCodePaths accepts real absolute folders and rejects relative, missing, drive-root and private paths', t => {
  const root = sampleProject(t);
  assert.deepEqual(resolveCodePaths([path.join(root, 'src'), path.join(root, 'src')], {}), [fs.realpathSync(path.join(root, 'src'))]); // de-duplicated
  assert.deepEqual(resolveCodePaths(undefined, {}), []);
  assert.throws(() => resolveCodePaths(['src/billing'], {}), /full path/);
  assert.throws(() => resolveCodePaths([path.join(root, 'nope')], {}), /not found/);
  assert.throws(() => resolveCodePaths([path.parse(root).root], {}), /project folder/);
  assert.throws(() => resolveCodePaths([path.join(root, 'src', '.env')], {}), /secrets/);
  assert.throws(() => resolveCodePaths(Array(6).fill(root), {}), /at most 5/);
  assert.throws(() => resolveCodePaths('x', {}), /must be a list/);
});

test('AGENT_CODE_ROOTS limits which folders can be read', t => {
  const allowed = tmpDir(t), other = tmpDir(t);
  const env = { AGENT_CODE_ROOTS: allowed };
  assert.equal(resolveCodePaths([allowed], env).length, 1);
  assert.throws(() => resolveCodePaths([other], env), e => e.status === 403 && /outside the folders/.test(e.message));
});

test('copyCodebase copies source text only: no secrets, keys, dependencies, binaries or lock files', t => {
  const root = sampleProject(t), dest = path.join(tmpDir(t), 'codebase');
  const r = copyCodebase([path.join(root, 'src')], dest);
  const all = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name)) : all.push(path.relative(dest, path.join(d, e.name)).split(path.sep).join('/')));
  walk(dest);
  assert.deepEqual(all.sort(), ['01-src/billing/invoice.service.ts', '01-src/billing/messages.json', 'INDEX.txt']);
  assert.equal(r.files, 2);
  assert.ok(!fs.readFileSync(path.join(dest, 'INDEX.txt'), 'utf8').includes('hunter2'));
});

test('the brief only mentions tester guidance and the codebase when they were given', () => {
  const module = { id: 'billing', name: 'Billing', area: 'Fin' };
  const plain = instructions({ kind: 'analyze', module });
  assert.ok(!/Guidance from the tester/.test(plain) && !/The application code/.test(plain));
  const rich = instructions({ kind: 'analyze', module, hasGuidance: true, hasCodebase: true });
  assert.match(rich, /input\/tester-guidance\.md/); assert.match(rich, /input\/codebase\//); assert.match(rich, /INDEX\.txt/); assert.match(rich, /code:<path/);
});

async function runWith(t, startArgs, { extract = 'unsupported', kind = 'video' } = {}) {
  const tmp = tmpDir(t), module = { id: 'billing', name: 'Billing', area: 'Fin', config: {} };
  const file = { id: 'f1', name: 'walk.mp4', kind, extract };
  const store = { intakeFiles: () => [file], cases: () => [], module: () => module };
  const intake = { ensureExtracted: async files => files.map(f => ({ file: f, content: { text: '' } })) };
  let cwd; const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => true; cwd = opts.cwd; calls.push(args);
    setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('exit', 0); });
    return child;
  };
  const env = { ...process.env, ...(startArgs.env ?? {}) };
  const runner = createAgentRunner({ dataDir: path.join(tmp, 'data'), store, intake, ingest: () => ({ id: 'x', draftCases: 0 }), spawn, probe: async id => ({ id, label: id, available: true }), env });
  const job = await runner.start({ module, agent: 'claude', user: { username: 'u' }, prompt: startArgs.prompt, codePaths: startArgs.codePaths });
  await until(() => runner.get('billing', job.id).status !== 'running');
  return { runner, job: runner.get('billing', job.id), ws: cwd };
}

test('a request and a code path make a run worthwhile even when the only upload is an unreadable video', async t => {
  const root = sampleProject(t);
  const { job, ws } = await runWith(t, { prompt: '  Focus on the minimum invoice total.  ', codePaths: [path.join(root, 'src')] });
  assert.match(fs.readFileSync(path.join(ws, 'input', 'tester-guidance.md'), 'utf8'), /Focus on the minimum invoice total\./);
  assert.ok(fs.existsSync(path.join(ws, 'input', 'codebase', '01-src', 'billing', 'invoice.service.ts')));
  assert.ok(!fs.existsSync(path.join(ws, 'input', 'codebase', '01-src', '.env')));
  const brief = fs.readFileSync(path.join(ws, 'INSTRUCTIONS.md'), 'utf8');
  assert.match(brief, /Guidance from the tester/); assert.match(brief, /The application code/);
  assert.equal(job.codePathCount, 1);
  assert.ok(!JSON.stringify(job).includes(root.replace(/\\/g, '\\\\')) && !('codePaths' in job)); // server paths are not shown to viewers
  assert.equal(job.codeSnapshot.files, 2);
});

test('bad code paths and over-long requests are refused before a job starts', async t => {
  await assert.rejects(runWith(t, { codePaths: ['relative/path'] }), e => e.status === 400 && /full path/.test(e.message));
  await assert.rejects(runWith(t, { prompt: 'x'.repeat(4001) }), e => e.status === 400 && /at most 4000/.test(e.message));
});

test('a folder with nothing readable fails the job with a clear message', async t => {
  const empty = tmpDir(t); write(empty, 'logo.png', 'binary');
  const { job } = await runWith(t, { codePaths: [empty] });
  assert.equal(job.status, 'error'); assert.match(job.message, /No readable source files/);
});
