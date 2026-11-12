// Optional, local-only video walkthrough extraction for portal intake.
// ffmpeg/ffprobe (and an optional `whisper` CLI) are used only when found on PATH. All child processes run
// through execFile with argument arrays (never a shell), off the event loop, with time, frame, duration and disk limits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
  maxDurationSec: 2 * 3600, maxFrames: 40, maxFrameBytes: 60 * 1024 * 1024, maxTextChars: 2_000_000,
  probeTimeoutMs: 5_000, ffprobeTimeoutMs: 20_000, ffmpegTimeoutMs: 10 * 60_000, whisperTimeoutMs: 30 * 60_000,
};
export const SIDECAR_EXTS = ['.srt', '.vtt', '.txt'];
export const PARTIAL_NOTE = 'Only scene-change keyframes were extracted; the visuals are NOT interpreted. No transcript was found - upload a transcript (.srt/.vtt/.txt) or notes for requirements.';
export const NEEDS_TRANSCRIPT = 'Needs transcript: video content is stored but not analysed. Upload a transcript or notes as text.';

export const defaultExec = (file, args, options = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', ...options }, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout: String(stdout), stderr: String(stderr) }));
});

async function available(exec, tool, args) {
  try { await exec(tool, args, { timeout: LIMITS.probeTimeoutMs }); return true; } catch { return false; }
}

const pad = n => String(n).padStart(2, '0');
export const stamp = sec => { const s = Math.max(0, Math.floor(sec)); return s >= 3600 ? `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const toSec = t => { const m = t.trim().replace(',', '.').match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/); return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; };

// SRT/VTT -> "[mm:ss] text" lines. Plain text is returned as-is.
export function parseTranscript(raw, ext) {
  const text = String(raw).replace(/^﻿/, '');
  if (ext === '.txt') return text.trim();
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n'); const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (body) out.push(`[${stamp(toSec(lines[i].split('-->')[0]))}] ${body}`);
  }
  return out.join('\n');
}

function readSidecar(file) {
  try { const ext = path.extname(file).toLowerCase(); return parseTranscript(fs.readFileSync(file, 'utf8').slice(0, LIMITS.maxTextChars * 2), ext).slice(0, LIMITS.maxTextChars); } catch { return ''; }
}

// Candidates: explicit sidecars (same module uploads) first, then files next to the video with the same base name.
export function findSidecar(file, name, extra = []) {
  const wanted = path.basename(name, path.extname(name)).toLowerCase();
  const list = extra.filter(s => SIDECAR_EXTS.includes(path.extname(s.name).toLowerCase()) && path.basename(s.name, path.extname(s.name)).toLowerCase() === wanted).map(s => s.path);
  const dir = path.dirname(file);
  for (const base of new Set([path.basename(name, path.extname(name)), path.basename(file, path.extname(file))])) {
    for (const e of SIDECAR_EXTS) { const p = path.join(dir, base + e); if (fs.existsSync(p)) list.push(p); }
  }
  for (const p of list) { const t = readSidecar(p); if (t.trim()) return t; }
  return '';
}

async function probeDuration(exec, file) {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: LIMITS.ffprobeTimeoutMs });
    const d = Number(String(stdout).trim()); return Number.isFinite(d) ? d : null;
  } catch { return null; }
}

async function extractFrames(exec, file, framesDir) {
  fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir, { recursive: true });
  const run = (vf, extra) => exec('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', file, '-an', '-vf', vf, '-fps_mode', 'vfr', '-frames:v', String(LIMITS.maxFrames), '-q:v', '4', ...extra, path.join(framesDir, 'frame-%03d.jpg')], { timeout: LIMITS.ffmpegTimeoutMs });
  const times = s => [...String(s).matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  let r = await run("select='gt(scene,0.35)',showinfo,scale=1280:-1", []);
  let files = fs.readdirSync(framesDir).filter(n => /^frame-\d+\.jpg$/.test(n)).sort(), ts = times(r.stderr);
  if (!files.length) { // no scene changes (static screen recording): keep the first frame so the video is not blank
    r = await run('showinfo,scale=1280:-1', ['-frames:v', '1']);
    files = fs.readdirSync(framesDir).filter(n => /^frame-\d+\.jpg$/.test(n)).sort(); ts = times(r.stderr);
  }
  const frames = []; let bytes = 0;
  files.forEach((n, i) => {
    const p = path.join(framesDir, n), size = fs.statSync(p).size;
    if (i >= LIMITS.maxFrames || bytes + size > LIMITS.maxFrameBytes) { fs.rmSync(p, { force: true }); return; }
    bytes += size; frames.push({ t: ts[i] ?? 0, file: n, bytes: size });
  });
  return frames;
}

// Whisper is only run with a model that is already on disk (never auto-downloaded): $WHISPER_MODEL (a local file) or the
// default cache copy of the base model. Returns '' when none is present.
export function whisperModelPath(env = process.env) {
  const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (env.WHISPER_MODEL) return isFile(env.WHISPER_MODEL) ? env.WHISPER_MODEL : '';
  const cache = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const def = path.join(cache, 'whisper', 'base.pt');
  return isFile(def) ? def : '';
}
export const NO_WHISPER_MODEL = 'Speech-to-text skipped: no local whisper model (set WHISPER_MODEL to a local model file; models are never downloaded automatically).';

async function runWhisper(exec, file, outDir, model) {
  fs.mkdirSync(outDir, { recursive: true });
  try {
    await exec('whisper', [file, '--model', model, '--output_format', 'srt', '--output_dir', outDir], { timeout: LIMITS.whisperTimeoutMs });
    const srt = fs.readdirSync(outDir).find(n => n.toLowerCase().endsWith('.srt'));
    return srt ? readSidecar(path.join(outDir, srt)) : '';
  } catch { return ''; }
}

export const frameIndex = frames => frames.map(f => `[${stamp(f.t)}] keyframe ${f.file}`).join('\n');

// opts: { framesDir, sidecars: [{name, path}], exec, limits }. Never throws for missing tools; returns
// { status: 'ok'|'partial'|'unsupported', text, tables, frames, note }.
// At most one video extraction runs at a time; others wait in order.
let extractionChain = Promise.resolve();
export function extractVideo(file, name, opts = {}) {
  const run = extractionChain.then(() => extractVideoNow(file, name, opts));
  extractionChain = run.catch(() => undefined);
  return run;
}

async function extractVideoNow(file, name, opts = {}) {
  const exec = opts.exec ?? defaultExec, framesDir = opts.framesDir;
  const none = note => ({ status: 'unsupported', text: '', tables: [], frames: [], note });
  let transcript = findSidecar(file, name, opts.sidecars ?? []);
  const hasFfmpeg = await available(exec, 'ffmpeg', ['-version']) && await available(exec, 'ffprobe', ['-version']);
  let frames = [], notes = [];
  if (hasFfmpeg && framesDir) {
    const duration = await probeDuration(exec, file);
    if (duration !== null && duration > LIMITS.maxDurationSec) notes.push(`Video is longer than ${LIMITS.maxDurationSec / 3600} hours; keyframes were not extracted.`);
    else {
      try { frames = await extractFrames(exec, file, framesDir); } catch { notes.push('Keyframe extraction failed or timed out.'); fs.rmSync(framesDir, { recursive: true, force: true }); }
      if (!transcript && frames.length && await available(exec, 'whisper', ['--help'])) {
        const model = whisperModelPath(opts.env ?? process.env);
        if (model) transcript = await runWhisper(exec, file, path.join(framesDir, '_whisper'), model);
        else notes.push(NO_WHISPER_MODEL);
      }
      fs.rmSync(path.join(framesDir, '_whisper'), { recursive: true, force: true });
    }
  }
  if (!transcript && !frames.length) return none(notes.length ? `${NEEDS_TRANSCRIPT} ${notes.join(' ')}` : NEEDS_TRANSCRIPT);
  const parts = [];
  if (transcript) parts.push(`## Transcript\n${transcript}`);
  if (frames.length) parts.push(`## Keyframe index (${frames.length} scene-change frames)\n${frameIndex(frames)}`);
  if (!transcript) parts.unshift(`NOTE: ${PARTIAL_NOTE}`);
  return { status: transcript ? 'ok' : 'partial', text: parts.join('\n\n').slice(0, LIMITS.maxTextChars), tables: [], frames,
    note: transcript ? (frames.length ? '' : 'Transcript read; keyframes were not extracted.') : [PARTIAL_NOTE, ...notes].join(' ') };
}

// CLI: node qa/tools/extract-video-intake.mjs <video> [framesDir]  (prints a status line only, never file contents)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, dir] = process.argv.slice(2);
  if (!file) { console.error('Usage: node qa/tools/extract-video-intake.mjs <video> [framesDir]'); process.exit(2); }
  const r = await extractVideo(path.resolve(file), path.basename(file), { framesDir: path.resolve(dir ?? `${file}-frames`) });
  console.log(JSON.stringify({ status: r.status, chars: r.text.length, frames: r.frames.length, note: r.note }));
}
