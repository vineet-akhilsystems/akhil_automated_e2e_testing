import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { boot, signedIn, makeUser, until } from './support.mjs';
import { extractContent, parseCsv } from '../intake.mjs';
import { zipBuffer, readZip } from '../zip.mjs';

const require = createRequire(import.meta.url), ExcelJS = require('exceljs');
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'augastam-intake-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const upload = (c, module, name, body, extra = {}) => c.request(`/api/modules/${module}/intake/files`, 'POST', Buffer.from(body), { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream', ...extra });

test('extraction reads csv, txt, xlsx, docx and pdf; images and video are stored but unsupported', async t => {
  const d = tmp(t);
  assert.deepEqual(parseCsv('a,b\n"x,1","he said ""hi"""\n'), [['a', 'b'], ['x,1', 'he said "hi"']]);
  const csv = path.join(d, 'f.csv'); fs.writeFileSync(csv, 'Field,Type\nName,text\n');
  let r = await extractContent(csv, 'f.csv'); assert.equal(r.status, 'ok'); assert.equal(r.tables[0].rows[1][0], 'Name');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Fields').addRows([['Field', 'Mandatory'], ['Phone', 'Yes']]);
  const xlsx = path.join(d, 'f.xlsx'); await wb.xlsx.writeFile(xlsx);
  r = await extractContent(xlsx, 'f.xlsx'); assert.equal(r.status, 'ok'); assert.match(r.text, /Phone \| Yes/);
  const docx = path.join(d, 'f.docx');
  fs.writeFileSync(docx, await zipBuffer([{ name: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Phone must be 10 digits &amp; unique.</w:t></w:r></w:p></w:body></w:document>' }]));
  r = await extractContent(docx, 'f.docx'); assert.equal(r.status, 'ok'); assert.match(r.text, /Phone must be 10 digits & unique\./);
  const content = 'BT /F1 12 Tf (Registration needs a valid phone number) Tj ET';
  const pdf = path.join(d, 'f.pdf');
  fs.writeFileSync(pdf, Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), zlib.deflateSync(Buffer.from(content)), Buffer.from('\nendstream\nendobj\n')]));
  r = await extractContent(pdf, 'f.pdf'); assert.equal(r.status, 'ok'); assert.match(r.text, /valid phone number/);
  fs.writeFileSync(path.join(d, 'bad.pdf'), '%PDF-1.4 nothing readable');
  assert.equal((await extractContent(path.join(d, 'bad.pdf'), 'bad.pdf')).status, 'error');
  assert.equal((await extractContent(csv, 'clip.mp4')).status, 'unsupported');
  assert.match((await extractContent(csv, 'clip.mp4')).note, /transcript/i);
  assert.equal((await extractContent(csv, 'shot.png')).status, 'unsupported');
});

// Fake exec: records every call, emulates ffmpeg/ffprobe/whisper without needing them installed.
function fakeExec({ tools = ['ffmpeg', 'ffprobe'], duration = 60, frames = 3, scene = true } = {}) {
  const calls = [];
  const fn = async (file, args, options) => {
    calls.push({ file, args, options });
    if (!tools.includes(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    if (file === 'ffprobe' && args.includes('format=duration')) return { stdout: `${duration}\n`, stderr: '' };
    if (file === 'ffmpeg' && args.includes('-i')) {
      const out = args[args.length - 1], dir = path.dirname(out); let stderr = '';
      const n = scene ? frames : (args.includes('-frames:v') && args[args.lastIndexOf('-frames:v') + 1] === '1' ? 1 : 0);
      for (let i = 1; i <= n; i++) { fs.writeFileSync(path.join(dir, `frame-${String(i).padStart(3, '0')}.jpg`), 'jpg'); stderr += `[Parsed_showinfo_1] n: ${i - 1} pts_time:${i * 12.5} pos:1\n`; }
      return { stdout: '', stderr };
    }
    if (file === 'whisper' && args.includes('--output_dir')) { fs.writeFileSync(path.join(args[args.indexOf('--output_dir') + 1], 'v.srt'), '1\n00:00:01,000 --> 00:00:02,000\nSpoken line\n'); return { stdout: '', stderr: '' }; }
    return { stdout: '', stderr: '' };
  };
  fn.calls = calls; return fn;
}

test('video extraction is optional: partial with frames, ok with sidecar transcript, unsupported without tools', async t => {
  const d = tmp(t), video = path.join(d, 'u1.mp4'); fs.writeFileSync(video, 'not really a video');
  // tools missing -> unsupported with the existing note
  let r = await extractContent(video, 'walk.mp4', { framesDir: path.join(d, 'f0'), exec: fakeExec({ tools: [] }) });
  assert.equal(r.status, 'unsupported'); assert.match(r.note, /Needs transcript/);
  // no framesDir -> no tool is touched
  const spy = fakeExec(); r = await extractContent(video, 'walk.mp4', { exec: spy });
  assert.equal(r.status, 'unsupported'); assert.equal(spy.calls.length, 0);
  // frames only -> partial, timestamped index, explicit not-interpreted note
  const ex = fakeExec(); r = await extractContent(video, 'walk.mp4', { framesDir: path.join(d, 'f1'), exec: ex });
  assert.equal(r.status, 'partial'); assert.equal(r.frames.length, 3);
  assert.match(r.text, /\[00:12\] keyframe frame-001\.jpg/); assert.match(r.text, /NOT interpreted/); assert.match(r.note, /NOT interpreted/);
  assert.ok(fs.existsSync(path.join(d, 'f1', 'frame-001.jpg')));
  const ff = ex.calls.find(c => c.file === 'ffmpeg' && c.args.includes('-i'));
  assert.ok(ff.args.includes("select='gt(scene,0.35)',showinfo,scale=1280:-1")); assert.equal(ff.args[ff.args.indexOf('-frames:v') + 1], '40');
  const wl = ff.args.indexOf('-protocol_whitelist'); assert.ok(wl >= 0 && ff.args[wl + 1] === 'file' && wl < ff.args.indexOf('-i'));
  const probe = ex.calls.find(c => c.file === 'ffprobe' && c.args.includes('format=duration')); assert.equal(probe.args[probe.args.indexOf('-protocol_whitelist') + 1], 'file');
  assert.ok(ff.options.timeout > 0); assert.ok(ex.calls.every(c => Array.isArray(c.args) && !('shell' in (c.options ?? {}))));
  // sidecar next to the file -> ok, srt cues become timestamped lines
  fs.writeFileSync(path.join(d, 'u1.srt'), '1\n00:00:05,000 --> 00:00:07,000\nUser clicks <i>Save</i>\n\n2\n00:01:02,000 --> 00:01:04,000\nToast appears\n');
  r = await extractContent(video, 'walk.mp4', { framesDir: path.join(d, 'f2'), exec: fakeExec() });
  assert.equal(r.status, 'ok'); assert.match(r.text, /\[00:05\] User clicks Save/); assert.match(r.text, /\[01:02\] Toast appears/); assert.match(r.text, /Keyframe index/);
  // sidecar uploaded to the same module (matching base name), no ffmpeg at all -> still ok (transcript only)
  const other = path.join(d, 'other.vtt'); fs.writeFileSync(other, 'WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nHello there\n');
  const lone = path.join(d, 'solo', 'x.mp4'); fs.mkdirSync(path.dirname(lone)); fs.writeFileSync(lone, 'x');
  r = await extractContent(lone, 'demo.mp4', { framesDir: path.join(d, 'f3'), exec: fakeExec({ tools: [] }), sidecars: [{ name: 'demo.vtt', path: other }, { name: 'unrelated.txt', path: other }] });
  assert.equal(r.status, 'ok'); assert.match(r.text, /\[00:03\] Hello there/);
  // optional whisper fills the transcript when no sidecar exists
  const w = path.join(d, 'w', 'w.mp4'); fs.mkdirSync(path.dirname(w)); fs.writeFileSync(w, 'x');
  const model = path.join(d, 'tiny.pt'); fs.writeFileSync(model, 'model');
  const wx = fakeExec({ tools: ['ffmpeg', 'ffprobe', 'whisper'] });
  r = await extractContent(w, 'w.mp4', { framesDir: path.join(d, 'f4'), exec: wx, env: { WHISPER_MODEL: model } });
  assert.equal(wx.calls.find(c => c.file === 'whisper' && c.args.includes('--output_dir')).args[2], model);
  // whisper without a local model is never run (no network download): stays partial with a note
  const nx = fakeExec({ tools: ['ffmpeg', 'ffprobe', 'whisper'] });
  const none = await extractContent(w, 'w.mp4', { framesDir: path.join(d, 'f4b'), exec: nx, env: { WHISPER_MODEL: path.join(d, 'missing.pt'), XDG_CACHE_HOME: path.join(d, 'nocache') } });
  assert.equal(none.status, 'partial'); assert.match(none.note, /no local whisper model/); assert.ok(!nx.calls.some(c => c.file === 'whisper' && c.args.includes('--output_dir')));
  assert.equal(r.status, 'ok'); assert.match(r.text, /\[00:01\] Spoken line/); assert.ok(!fs.existsSync(path.join(d, 'f4', '_whisper')));
  // over-long video is not processed
  r = await extractContent(w, 'w.mp4', { framesDir: path.join(d, 'f5'), exec: fakeExec({ duration: 3 * 3600 }) });
  assert.equal(r.status, 'unsupported'); assert.match(r.note, /longer than 2 hours/);
  // frame cap is enforced even if the tool over-produces
  r = await extractContent(w, 'w.mp4', { framesDir: path.join(d, 'f6'), exec: fakeExec({ frames: 55 }) });
  assert.equal(r.frames.length, 40); assert.equal(fs.readdirSync(path.join(d, 'f6')).length, 40);
  // static video: no scene change -> single first frame fallback
  r = await extractContent(w, 'w.mp4', { framesDir: path.join(d, 'f7'), exec: fakeExec({ scene: false }) });
  assert.equal(r.status, 'partial'); assert.equal(r.frames.length, 1);
});

test('video extractions run one at a time', async t => {
  const d = tmp(t), video = path.join(d, 'c.mp4'); fs.writeFileSync(video, 'x');
  let active = 0, peak = 0;
  const base = fakeExec();
  const exec = async (file, args, o) => {
    if (file === 'ffmpeg' && args.includes('-i')) { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 30)); active--; }
    return base(file, args, o);
  };
  const rs = await Promise.all([1, 2, 3].map(i => extractContent(video, 'c.mp4', { framesDir: path.join(d, `c${i}`), exec })));
  assert.ok(rs.every(r => r.status === 'partial')); assert.equal(peak, 1);
});

test('zip writer output is readable and stored files stream', async t => {
  const d = tmp(t), big = path.join(d, 'big.bin'); fs.writeFileSync(big, Buffer.alloc(300000, 7));
  const z = readZip(await zipBuffer([{ name: 'a/b.txt', data: 'hello hello hello hello' }, { name: 'big.bin', file: big }]));
  assert.equal(z.get('a/b.txt')().toString(), 'hello hello hello hello'); assert.equal(z.get('big.bin')().length, 300000);
});

test('uploads stream to disk with audit, extraction, download, limits and role checks', async t => {
  const f = await boot(t, { bootstrap: ADMIN, intakeMaxMb: 0.002 });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bob', 'ba'), ba2 = await makeUser(admin, 'bea', 'ba'), viewer = await makeUser(admin, 'vic', 'viewer');
  const b = await signedIn(f, 'bob', ba.password), b2 = await signedIn(f, 'bea', ba2.password), v = await signedIn(f, 'vic', viewer.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Fin' })).status, 201);

  assert.equal((await upload(v, 'billing', 'x.txt', 'hi')).status, 403);
  assert.equal((await upload(b, 'nope', 'x.txt', 'hi')).status, 404);
  assert.equal((await b.request('/api/modules/billing/intake/files', 'POST', Buffer.from('hi'), {})).status, 400); // no x-file-name
  const body = 'Invoice number: text, mandatory\nTotal must be at least 1.\n';
  const up = await upload(b, 'billing', '../../evil name.txt', body, { 'x-file-note': encodeURIComponent('first draft') });
  assert.equal(up.status, 201);
  assert.deepEqual([up.value.name, up.value.kind, up.value.uploadedBy, up.value.note, up.value.size], ['evil name.txt', 'text', 'bob', 'first draft', body.length]);
  assert.ok(up.value.uploadedAt);
  const listed = await until(async () => { const r = await v.request('/api/modules/billing/intake'); return r.value.files[0].extract === 'ok' ? r.value : null; });
  assert.ok(listed.files[0].chars > 10); assert.equal(listed.insights, null);
  const dl = await v.request(`/api/modules/billing/intake/files/${up.value.id}/download`);
  assert.equal(dl.status, 200); assert.equal(dl.value.toString(), body);
  assert.match(dl.response.headers.get('content-disposition'), /attachment/);
  assert.ok(fs.existsSync(path.join(f.directory, 'intake', 'billing')));
  // limit (2 KB)
  const tooBig = await upload(b, 'billing', 'big.bin', 'x'.repeat(5000));
  assert.equal(tooBig.status, 413);
  assert.equal(fs.readdirSync(path.join(f.directory, 'intake', 'billing')).filter(n => n.endsWith('.part')).length, 0);
  // delete rules: other BA cannot, uploader and admin can
  assert.equal((await b2.request(`/api/modules/billing/intake/files/${up.value.id}`, 'DELETE')).status, 403);
  assert.equal((await b.request(`/api/modules/billing/intake/files/${up.value.id}`, 'DELETE')).status, 200);
  assert.equal((await v.request('/api/modules/billing/intake')).value.files.length, 0);
});

test('module pack zip contains manifest, cases, insights and raw files', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Fin' });
  await upload(admin, 'billing', 'spec.md', 'Phone: text, mandatory\nThe total must be at least 1.\nWhat happens on refund?\n');
  await until(async () => (await admin.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');
  const job = (await admin.request('/api/modules/billing/intake/analyze', 'POST', {})).value.jobId;
  await until(async () => (await admin.request(`/api/modules/billing/intake/analyze/${job}`)).value.status === 'done');
  const pack = await admin.request('/api/modules/billing/pack');
  assert.equal(pack.status, 200); assert.equal(pack.response.headers.get('content-type'), 'application/zip');
  const z = readZip(pack.value), names = [...z.keys()];
  for (const n of ['manifest.json', 'cases/approved-cases.json', 'cases/draft-cases.json', 'insights/insights.json', 'insights/insights.md', 'config/module.json']) assert.ok(names.includes(n), n);
  assert.ok(names.some(n => n.startsWith('files/') && n.endsWith('spec.md')));
  const manifest = JSON.parse(z.get('manifest.json')());
  assert.equal(manifest.module.id, 'billing'); assert.ok(manifest.counts.draftCases > 0); assert.equal(manifest.counts.approvedCases, 0);
  assert.equal(JSON.parse(z.get('cases/approved-cases.json')()).length, 0);
  const lean = readZip((await admin.request('/api/modules/billing/pack?files=0')).value);
  assert.ok(![...lean.keys()].some(n => n.startsWith('files/')));
});
