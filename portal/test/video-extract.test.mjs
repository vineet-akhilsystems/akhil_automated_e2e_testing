import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractVideo, gapSeconds, LIMITS } from '../../qa/tools/extract-video-intake.mjs';

const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const real = { skip: hasFfmpeg ? false : 'ffmpeg/ffprobe not installed' };

// A synthetic screen recording: a static colour for `seconds`, 1 fps, with a silent audio track like real recordings have.
const makeVideo = (file, seconds) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=0x2a5db0:s=320x240:r=1`, '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
  '-t', String(seconds), '-pix_fmt', 'yuv420p', '-shortest', file], { stdio: 'ignore' });

test('gap threshold: 60 s minimum, one twelfth of long videos', () => {
  assert.equal(gapSeconds(60), 60); assert.equal(gapSeconds(600), 60); assert.equal(gapSeconds(1800), 150);
});

test('real ffmpeg: a long static recording is sampled across its whole length, in time order', real, async t => {
  const d = tmp(t), video = path.join(d, 'walk.mp4'); makeVideo(video, 300);
  const r = await extractVideo(video, 'walk.mp4', { framesDir: path.join(d, 'frames') });
  assert.equal(r.status, 'partial');
  assert.ok(r.frames.length >= 4, `expected spread frames, got ${r.frames.length}`);
  const times = r.frames.map(f => f.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'frames are in time order');
  const edges = [0, ...times, 300]; const worst = Math.max(...edges.slice(1).map((x, i) => x - edges[i]));
  assert.ok(worst <= gapSeconds(300) + 5, `largest uncovered stretch ${Math.round(worst)}s`);
  assert.deepEqual(r.frames.map(f => f.file), r.frames.map((_, i) => `frame-${String(i + 1).padStart(3, '0')}.jpg`), 'files are numbered in order');
  for (const f of r.frames) assert.ok(fs.statSync(path.join(d, 'frames', f.file)).size > 0);
  assert.deepEqual(fs.readdirSync(path.join(d, 'frames')).sort(), r.frames.map(f => f.file), 'no temporary files left behind');
  assert.match(r.text, /keyframe frame-001\.jpg/);
});

test('real ffmpeg: a short video is not padded with extra frames', real, async t => {
  const d = tmp(t), video = path.join(d, 'short.mp4'); makeVideo(video, 30);
  const r = await extractVideo(video, 'short.mp4', { framesDir: path.join(d, 'frames') });
  assert.equal(r.frames.length, 1, 'static short clip keeps just its first frame');
});

test('real ffmpeg: a transcript next to the video makes it a full source with both transcript and frames', real, async t => {
  const d = tmp(t), video = path.join(d, 'demo.mp4'); makeVideo(video, 90);
  fs.writeFileSync(path.join(d, 'demo.srt'), '1\n00:00:05,000 --> 00:00:08,000\nThe cashier must enter the payment mode before saving.\n');
  const r = await extractVideo(video, 'demo.mp4', { framesDir: path.join(d, 'frames') });
  assert.equal(r.status, 'ok'); assert.match(r.text, /\[00:05\] The cashier must enter the payment mode/); assert.match(r.text, /Keyframe index/);
});

test('real ffmpeg: a file that is not a video degrades to "needs transcript" instead of throwing', real, async t => {
  const d = tmp(t), video = path.join(d, 'broken.mp4'); fs.writeFileSync(video, 'this is not a video');
  const r = await extractVideo(video, 'broken.mp4', { framesDir: path.join(d, 'frames') });
  assert.equal(r.status, 'unsupported'); assert.match(r.note, /Needs transcript/);
});

test('gap filling never exceeds the frame cap, even when scene detection already used most of it', async t => {
  const d = tmp(t), video = path.join(d, 'x.mp4'); fs.writeFileSync(video, 'x');
  let fillCalls = 0;
  const exec = async (file, args) => {
    if (file === 'ffprobe' && args.includes('format=duration')) return { stdout: '7200\n', stderr: '' };
    if (file !== 'ffmpeg') return { stdout: '', stderr: '' };
    if (args.includes('-ss')) { fillCalls++; fs.writeFileSync(args[args.length - 1], 'jpg'); return { stdout: '', stderr: '' }; }
    if (args.includes('-i')) { // scene pass: 38 frames bunched in the first minute
      const dir = path.dirname(args[args.length - 1]); let stderr = '';
      for (let i = 1; i <= 38; i++) { fs.writeFileSync(path.join(dir, `frame-${String(i).padStart(3, '0')}.jpg`), 'jpg'); stderr += `pts_time:${i}\n`; }
      return { stdout: '', stderr };
    }
    return { stdout: '', stderr: '' };
  };
  const r = await extractVideo(video, 'x.mp4', { framesDir: path.join(d, 'f'), exec });
  assert.equal(r.frames.length, LIMITS.maxFrames); assert.equal(fillCalls, LIMITS.maxFrames - 38);
  assert.deepEqual(r.frames.map(f => f.t), [...r.frames.map(f => f.t)].sort((a, b) => a - b));
});

// ---- through the portal API: what a BA actually does in the Upload step -------------------------------
import { boot, signedIn, until } from './support.mjs';
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const up = (c, module, name, body) => c.request(`/api/modules/${module}/intake/files`, 'POST', body, { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' });

test('real ffmpeg, through the API: a walkthrough video with its transcript becomes a readable source; without one it is partial', real, async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  const d = tmp(t), video = path.join(d, 'billing-walkthrough.mp4'); makeVideo(video, 120);
  const bytes = fs.readFileSync(video);

  // 1. video alone -> keyframes only
  const alone = await up(admin, 'billing', 'billing-walkthrough.mp4', bytes);
  assert.equal(alone.status, 201); assert.equal(alone.value.kind, 'video');
  const partial = await until(async () => { const r = await admin.request('/api/modules/billing/intake'); const x = r.value.files.find(y => y.id === alone.value.id); return x?.extract && x.extract !== 'pending' ? x : null; }, 60_000);
  assert.equal(partial.extract, 'partial'); assert.ok(partial.chars > 0);

  // 2. transcript uploaded first, then a different video with the same base name -> full source
  assert.equal((await up(admin, 'billing', 'refund.srt', Buffer.from('1\n00:00:10,000 --> 00:00:14,000\nA refund over 5000 needs supervisor approval.\n'))).status, 201);
  const video2 = path.join(d, 'refund.mp4'); makeVideo(video2, 125); // different bytes: the portal dedupes identical uploads
  const second = await up(admin, 'billing', 'refund.mp4', fs.readFileSync(video2)); assert.equal(second.status, 201);
  const full = await until(async () => { const r = await admin.request('/api/modules/billing/intake'); const x = r.value.files.find(y => y.id === second.value.id); return x?.extract && x.extract !== 'pending' ? x : null; }, 60_000);
  assert.equal(full.extract, 'ok'); assert.ok(full.chars > 0);
});
