import fs from 'node:fs';
import path from 'node:path';
import { check } from './registry.mjs';

// One place that decides HOW the portal spends AI: which model a job uses, how much it may read, how long it may run,
// and how many jobs a day. Non-technical users only ever see three plain-language presets in Settings; model names stay here.
//
// Rule of thumb (same as .claude/skills/routing-work-to-models): the lightest model that can do the job.
//   - small, text-only reading ........ Haiku   (Economy only)
//   - reading with screenshots / large  Sonnet  (default)
//   - writing test code ................ Sonnet  (Opus only for "Best quality")
const K = n => n * 1000;
const WHY = {
  light: 'Small text-only input, so the lightest model is enough.',
  vision: 'Screenshots or a lot of text need a more capable model.',
  standard: 'A capable everyday model gives good results at a fair cost.',
  deep: 'Best quality: the strongest model for screenshots, large inputs and test code.',
  code: 'Writing test code needs a capable model.',
};

export const PRESETS = {
  economy: {
    label: 'Economy', blurb: 'Lowest cost and fastest. Short text files are read by the lightest model; screenshots and very large files are trimmed. Good for quick checks.',
    analyze: { frames: 12, fileChars: K(40), totalChars: K(100), maxTurns: 20, skipUnchanged: true },
    automation: { maxTurns: 35 },
    pick: (kind, { chars = 0, images = 0 }) => kind === 'automation' ? { model: 'sonnet', why: WHY.code } : images > 0 || chars > K(60) ? { model: 'sonnet', why: WHY.vision } : { model: 'haiku', why: WHY.light },
  },
  balanced: {
    label: 'Balanced', blurb: 'Recommended. A capable model for everything, with sensible limits on how much is read and how long a job may run.',
    analyze: { frames: 24, fileChars: K(120), totalChars: K(300), maxTurns: 30, skipUnchanged: true },
    automation: { maxTurns: 50 },
    pick: kind => ({ model: 'sonnet', why: kind === 'automation' ? WHY.code : WHY.standard }),
  },
  quality: {
    label: 'Best quality', blurb: 'Highest quality and highest cost. Reads more of every file and more video frames, and uses the strongest model for hard jobs. Use for important modules.',
    analyze: { frames: 40, fileChars: K(300), totalChars: K(800), maxTurns: 40, skipUnchanged: false },
    automation: { maxTurns: 60 },
    pick: (kind, { chars = 0, images = 0 }) => kind === 'automation' || images > 0 || chars > K(150) ? { model: 'opus', why: WHY.deep } : { model: 'sonnet', why: WHY.standard },
  },
};

export const DEFAULTS = { preset: 'balanced', dailyJobLimit: 20, codexModel: '' };
export const presetList = () => Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, blurb: p.blurb }));
const input = tokens => (tokens?.input_tokens ?? 0) + (tokens?.cache_creation_input_tokens ?? 0) + (tokens?.cache_read_input_tokens ?? 0);
export const tokensOf = input;
// "claude-sonnet-5-5" -> "Sonnet": what a person would say.
export const friendlyModel = name => { const m = /(haiku|sonnet|opus|fable)/i.exec(String(name ?? '')); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : String(name ?? '') || 'Unknown'; };
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const SETTING_KEY = 'setting:ai-policy';

// The policy is a shared setting, so it lives in the portal database (meta table) and travels with the team snapshot.
// Without a database (unit tests, tools) it falls back to a JSON file. The usage ledger stays local: it is per-machine history.
export function createAiPolicy(dataDir, { now = () => new Date(), db = null } = {}) {
  const file = path.join(dataDir, 'ai-policy.json'), ledger = path.join(dataDir, 'ai-usage.jsonl');
  const load = () => {
    try {
      if (db) {
        const row = db.prepare('SELECT value FROM meta WHERE key=?').get(SETTING_KEY);
        if (row) return JSON.parse(row.value);
        if (fs.existsSync(file)) { const old = JSON.parse(fs.readFileSync(file, 'utf8')); store(old); return old; } // one-time move from the old file
        return {};
      }
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return {}; }
  };
  const store = value => {
    if (db) { db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(SETTING_KEY, JSON.stringify(value)); return; }
    fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file + '.tmp', file);
  };
  const get = () => ({ ...DEFAULTS, ...load() });
  const entries = () => { try { return fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; } };
  const todayJobs = () => entries().filter(e => e.startedAt && localDay(new Date(e.startedAt)) === localDay(now())).length;
  return {
    get, presets: presetList,
    save(body) {
      check(body && typeof body === 'object' && !Array.isArray(body), 'Policy settings are required.');
      const next = { ...get() };
      if (body.preset !== undefined) { check(Object.hasOwn(PRESETS, body.preset), 'Choose Economy, Balanced or Best quality.'); next.preset = body.preset; }
      if (body.dailyJobLimit !== undefined) { check(Number.isInteger(body.dailyJobLimit) && body.dailyJobLimit >= 0 && body.dailyJobLimit <= 1000, 'The daily job limit must be a whole number from 0 (no limit) to 1000.'); next.dailyJobLimit = body.dailyJobLimit; }
      if (body.codexModel !== undefined) { check(typeof body.codexModel === 'string' && /^[\w.:-]{0,60}$/.test(body.codexModel), 'The Codex model name can only contain letters, numbers and . _ : -'); next.codexModel = body.codexModel; }
      store(next);
      return next;
    },
    // Reading and time limits for a kind of job under the current preset (applied while the workspace is prepared).
    limits: kind => ({ ...PRESETS[get().preset][kind === 'automation' ? 'automation' : 'analyze'], preset: get().preset }),
    // The model and step limit for one job, once its real input size is known.
    route(kind, stats = {}, agent = 'claude') {
      const { preset, codexModel } = get(), p = PRESETS[preset], k = kind === 'automation' ? 'automation' : 'analyze', picked = p.pick(kind, stats);
      return { preset, presetLabel: p.label, model: agent === 'codex' ? (codexModel || null) : picked.model, maxTurns: p[k].maxTurns, why: agent === 'codex' && !codexModel ? 'Codex uses its own default model.' : picked.why,
        ...(agent === 'claude' && picked.model !== 'sonnet' ? { fallbackModel: 'sonnet' } : {}) };
    },
    todayJobs,
    // A limit of 0 means no limit.
    checkQuota() {
      const { dailyJobLimit } = get();
      check(!dailyJobLimit || todayJobs() < dailyJobLimit, `The daily limit of ${dailyJobLimit} AI job(s) has been reached. An administrator can raise it in Settings > AI usage, or try again tomorrow.`, 429);
    },
    record(entry) { try { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(ledger, JSON.stringify(entry) + '\n'); } catch { /* usage history is best effort */ } },
    // Totals for the last N days plus the most recent jobs, for the Settings panel.
    usage(days = 7) {
      const since = now().getTime() - days * 86_400_000, rows = entries().filter(e => Date.parse(e.startedAt) >= since);
      const sum = list => ({ jobs: list.length, inputTokens: list.reduce((n, e) => n + (e.inputTokens ?? 0), 0), outputTokens: list.reduce((n, e) => n + (e.outputTokens ?? 0), 0), costUsd: Math.round(list.reduce((n, e) => n + (e.costUsd ?? 0), 0) * 100) / 100 });
      const byModel = {}; for (const e of rows) (byModel[e.modelLabel ?? 'Unknown'] ??= []).push(e);
      return { days, ...sum(rows), today: todayJobs(), byModel: Object.fromEntries(Object.entries(byModel).map(([m, l]) => [m, sum(l)])), recent: rows.slice(-15).reverse() };
    },
  };
}
