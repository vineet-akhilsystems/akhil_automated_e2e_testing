import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createAgentRunner, shellArgs } from '../agent.mjs';

const probe = async id => ({ id, label: id, available: true, version: '9' });
const wait = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

function world(t, { frames = 6, extra = [] } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-vision-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const framesDir = path.join(tmp, 'frames-src'); fs.mkdirSync(framesDir);
  const list = Array.from({ length: frames }, (_, i) => ({ t: i * 31.5, file: `frame-${String(i + 1).padStart(3, '0')}.jpg`, bytes: 10 }));
  list.forEach(f => fs.writeFileSync(path.join(framesDir, f.file), Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
  const image = path.join(tmp, 'screen.png'); fs.writeFileSync(image, Buffer.from('png'));
  const files = [{ id: 'v1', name: 'Billing walkthrough.mp4', kind: 'video', extract: 'partial' }, ...extra];
  const store = { intakeFiles: () => files, cases: () => [], module: () => module };
  const module = { id: 'billing', name: 'Billing', area: 'Fin', config: {} };
  const intake = {
    framesPath: () => framesDir, filePath: f => (f.id === 'img' ? image : null),
    ensureExtracted: async fs_ => fs_.map(f => ({ file: f, content: f.kind === 'video' ? { text: 'NOTE: keyframes only', frames: list } : { text: '' } })),
  };
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => true; calls.push({ bin, args, opts });
    setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('exit', 1); });
    return child;
  };
  const runner = createAgentRunner({ dataDir: path.join(tmp, 'data'), store, intake, ingest: () => ({ id: 'x', draftCases: 0 }), spawn, probe });
  return { runner, module, calls, tmp };
}

test('video keyframes and screenshots reach the agent as images with timestamps, and the brief tells it how to use them', async t => {
  const { runner, module, calls } = world(t, { frames: 6, extra: [{ id: 'img', name: 'invoice screen.png', kind: 'image', extract: 'unsupported' }] });
  const job = await runner.start({ module, agent: 'codex', user: { username: 'u' } });
  await wait(() => calls.length === 1);
  const ws = calls[0].opts.cwd;
  const manifest = JSON.parse(fs.readFileSync(path.join(ws, 'input', 'MANIFEST.json'), 'utf8'));
  const video = manifest.find(m => m.kind === 'video'), image = manifest.find(m => m.kind === 'image');
  assert.equal(video.frames.length, 6);
  assert.deepEqual(video.frames.slice(0, 2).map(f => f.time), ['00:00', '00:31']);
  assert.ok(video.frames.every(f => fs.existsSync(path.join(ws, f.file))), 'every listed frame exists inside the workspace');
  assert.equal(image.images.length, 1); assert.ok(fs.existsSync(path.join(ws, image.images[0].file)));
  const brief = fs.readFileSync(path.join(ws, 'INSTRUCTIONS.md'), 'utf8');
  assert.match(brief, /Looking at the screenshots and video frames/); assert.match(brief, /narration/i); assert.match(brief, /@ mm:ss/);
  // Codex gets every image attached with -i and reads the prompt from stdin (no trailing "-").
  const args = calls[0].args;
  const at = args.indexOf('-i');
  assert.ok(at > 0 && args.slice(at + 1).filter(a => /\.(jpg|png)$/.test(a)).length === 7, JSON.stringify(args));
  assert.ok(!args.includes('-'));
  void job;
});

test('image count is capped, spread across the video, and a videos-only module with frames is no longer refused', async t => {
  const { runner, module, calls } = world(t, { frames: 40 });
  await runner.start({ module, agent: 'claude', user: { username: 'u' } }); // frames exist, so videos alone are enough
  await wait(() => calls.length === 1);
  const ws = calls[0].opts.cwd;
  const video = JSON.parse(fs.readFileSync(path.join(ws, 'input', 'MANIFEST.json'), 'utf8'))[0];
  assert.ok(video.frames.length <= 24 && video.frames.length >= 4, `picked ${video.frames.length}`);
  assert.equal(video.frames[0].time, '00:00');
  assert.ok(video.frames.at(-1).time > video.frames[1].time, 'frames come from across the whole video, not just the start');
  assert.ok(!calls[0].args.includes('-i'), 'Claude opens the files itself, nothing is attached');
});

test('arguments containing spaces are quoted on Windows so workspace paths like "Company Enhancement Projects" survive the shell', () => {
  const win = process.platform === 'win32';
  const out = shellArgs(['exec', '-C', 'C:\\Users\\HP\\Company Enhancement Projects\\.portal\\agent\\x', '-i', 'C:\\a b\\frame-001.jpg']);
  if (win) { assert.equal(out[2], '"C:\\Users\\HP\\Company Enhancement Projects\\.portal\\agent\\x"'); assert.equal(out[4], '"C:\\a b\\frame-001.jpg"'); assert.equal(out[0], 'exec'); }
  else assert.equal(out[2], 'C:\\Users\\HP\\Company Enhancement Projects\\.portal\\agent\\x');
});
