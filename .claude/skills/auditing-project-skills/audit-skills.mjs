#!/usr/bin/env node
// Mechanical audit of Claude Code skills (and agents) against this repo.
// Usage: node .claude/skills/auditing-project-skills/audit-skills.mjs [skill-dir-or-name ...] [--json] [--agents]
// No args = every skill in .claude/skills. Exit code 1 if any ERROR.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const withAgents = args.includes('--agents');
const targets = args.filter((a) => !a.startsWith('--'));

const IGNORE_DIRS = new Set(['node_modules', '.git', 'playwright-report', 'test-results', 'output', 'tmp', '.auth', 'runs']);
const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide']);
const MODEL_VALUES = /^(inherit|sonnet|opus|haiku|fable|best|opusplan|sonnet\[1m\]|opus\[1m\]|claude-[a-z0-9.-]+)$/;
const EFFORT_VALUES = /^(low|medium|high|xhigh|max)$/;
const FILE_EXT = /\.(md|json|ts|tsx|js|mjs|cjs|xlsx|csv|txt|sqlite|ya?ml|html|py|ps1|sh)$/i;

// ---- repo index (files + dirs, repo-relative, forward slashes) ----
const repoFiles = [];
const repoDirs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (e.isDirectory()) { repoDirs.push(rel); walk(full); } else repoFiles.push(rel);
  }
})(ROOT);

const pkg = fs.existsSync(path.join(ROOT, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) : {};
const npmScripts = new Set(Object.keys(pkg.scripts || {}));
const localSkills = fs.existsSync(SKILLS_DIR) ? new Set(fs.readdirSync(SKILLS_DIR).filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')))) : new Set();
const localAgents = fs.existsSync(AGENTS_DIR) ? new Set(fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))) : new Set();

// ---- helpers ----
function parseFrontmatter(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (val === '>' || val === '|' || val === '>-' || val === '|-' || val === '') {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i].trim());
      val = block.join(val.startsWith('|') ? '\n' : ' ');
    }
    fm[key] = val.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return { fm, body: text.slice(m[0].length) };
}

function resolveRef(token, skillDir) {
  const clean = token.replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
  const isDir = clean.endsWith('/');
  const bare = clean.replace(/\/$/, '');
  const pool = isDir ? repoDirs : repoFiles;
  const relSkill = path.relative(ROOT, skillDir).split(path.sep).join('/');
  if (pool.includes(bare) || pool.includes(`${relSkill}/${bare}`)) return { status: 'ok' };
  if (!isDir && (repoDirs.includes(bare) || repoDirs.includes(`${relSkill}/${bare}`))) return { status: 'ok' };
  const hits = [...repoFiles, ...repoDirs].filter((p) => p === bare || p.endsWith('/' + bare));
  if (hits.length === 1) return { status: 'relative', where: hits[0] };
  if (hits.length > 1) return { status: 'ambiguous', where: hits.slice(0, 4).join(', ') + (hits.length > 4 ? ` (+${hits.length - 4})` : '') };
  return { status: 'missing' };
}

function looksLikePath(t) {
  if (/[\s<>{}*$|()"'=,;[\]]/.test(t) || t.startsWith('http') || t.startsWith('-') || t.startsWith('@')) return false;
  if (t.startsWith('.') && !t.startsWith('./') && !t.startsWith('.claude') && !t.startsWith('.portal') && !t.startsWith('.env')) return false;
  if (/^\.env/.test(t)) return false; // secrets are deny-listed; never resolve them
  return t.includes('/') || FILE_EXT.test(t);
}

function auditFile(file, kind) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });
  const text = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const parsed = parseFrontmatter(text);
  const expectedName = kind === 'skill' ? path.basename(dir) : path.basename(file, '.md');
  if (!parsed) { add('ERROR', 'no YAML frontmatter (--- block at top)'); return { file, issues, words: 0 }; }
  const { fm, body } = parsed;

  // frontmatter
  if (!fm.name) add('WARN', `no name: (defaults to "${expectedName}")`);
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name)) add('ERROR', `name "${fm.name}" must be lowercase letters, digits, hyphens`);
    if (fm.name !== expectedName) add('WARN', `name "${fm.name}" differs from ${kind === 'skill' ? 'directory' : 'file'} "${expectedName}"`);
  }
  const desc = fm.description || '';
  if (!desc) add('ERROR', 'no description: - Claude cannot decide when to load it');
  else {
    const total = desc.length + (fm.when_to_use ? fm.when_to_use.length + 1 : 0);
    if (total > 1536) add('ERROR', `description+when_to_use is ${total} chars (Claude Code caps at 1536)`);
    else if (desc.length > 1024) add('WARN', `description is ${desc.length} chars (Agent Skills spec max 1024; claude.ai upload will reject)`);
    if (kind === 'skill' && !/^Use (when|for|to|as|before|after)\b/i.test(desc)) add('WARN', 'description should start with "Use when..." (trigger conditions, not a workflow summary)');
    if (/\b(I|my|we|our)\b/.test(desc.split(/[.:]/)[0])) add('WARN', 'description should be third person');
    if (/\bthen\b.*\bthen\b|\s(→|->)\s|\bstep 1\b/i.test(desc)) add('WARN', 'description looks like it summarizes a workflow - agents may follow it instead of reading the body');
  }
  if (fm.model && !MODEL_VALUES.test(fm.model)) add('ERROR', `model "${fm.model}" is not a valid alias/ID`);
  if (fm.effort && !EFFORT_VALUES.test(fm.effort)) add('ERROR', `effort "${fm.effort}" must be low|medium|high|xhigh|max`);
  if (fm.context && fm.context !== 'fork') add('ERROR', `context "${fm.context}" - only "fork" is supported`);
  if (fm.agent && !fm.context) add('WARN', 'agent: has no effect without context: fork');

  // size
  const words = body.split(/\s+/).filter(Boolean).length;
  if (kind === 'skill' && words > 1000) add('WARN', `body is ${words} words - move reference material to a supporting file (aim <500)`);
  else if (kind === 'skill' && words > 500) add('INFO', `body is ${words} words (aim <500 unless it is a reference skill)`);

  // references
  const seen = new Set();
  const lines = body.split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; }
    const ln = i + 1 + (text.split('\n').length - lines.length);
    for (const m of line.matchAll(/npm run ([\w:.-]+)/g)) {
      const s = m[1];
      if (!npmScripts.has(s) && !seen.has('npm:' + s)) { seen.add('npm:' + s); add('ERROR', `L${ln}: npm script "${s}" not in package.json`); }
    }
    if (inFence) return; // code samples show example output, not repo references
    for (const m of line.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target) || seen.has('link:' + target)) continue;
      seen.add('link:' + target);
      if (!fs.existsSync(path.resolve(dir, target))) add('ERROR', `L${ln}: markdown link target "${target}" does not exist`);
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const t = m[1].trim();
      if (looksLikePath(t) && !seen.has('path:' + t)) {
        seen.add('path:' + t);
        const r = resolveRef(t, dir);
        const multiSegment = t.replace(/\/$/, '').includes('/');
        if (r.status === 'missing' && multiSegment) add('ERROR', `L${ln}: path \`${t}\` not found in repo`);
        else if (r.status === 'missing') add('WARN', `L${ln}: \`${t}\` not found - fine if it is a runtime artifact, URL segment or API name; otherwise a stale reference`);
        else if (r.status === 'ambiguous') add('WARN', `L${ln}: path \`${t}\` matches several files: ${r.where} - make it repo-relative`);
        else if (r.status === 'relative') add('INFO', `L${ln}: \`${t}\` resolves only by suffix -> ${r.where}`);
      }
      if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(t) && !seen.has('ref:' + t)) {
        const mentionsSkill = /\bskill/i.test(line), mentionsAgent = /\b(agent|subagent)/i.test(line);
        if (mentionsSkill && !mentionsAgent && !localSkills.has(t)) { seen.add('ref:' + t); add('WARN', `L${ln}: \`${t}\` mentioned next to "skill" but no .claude/skills/${t}/SKILL.md`); }
        if (mentionsAgent && !mentionsSkill && !localAgents.has(t) && !BUILTIN_AGENTS.has(t)) { seen.add('ref:' + t); add('WARN', `L${ln}: \`${t}\` mentioned next to "agent" but no .claude/agents/${t}.md`); }
      }
    }
  });
  return { file: path.relative(ROOT, file).split(path.sep).join('/'), words, issues };
}

// ---- run ----
const files = [];
const skillNames = targets.length ? targets : [...localSkills];
for (const t of skillNames) {
  const dir = fs.existsSync(path.join(t, 'SKILL.md')) ? t : path.join(SKILLS_DIR, t);
  const f = path.join(dir, 'SKILL.md');
  if (fs.existsSync(f)) files.push([f, 'skill']); else console.error(`skip: no SKILL.md for "${t}"`);
}
if (withAgents) for (const a of localAgents) files.push([path.join(AGENTS_DIR, a + '.md'), 'agent']);

const results = files.map(([f, k]) => auditFile(f, k));
if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) {
    const counts = ['ERROR', 'WARN', 'INFO'].map((l) => `${r.issues.filter((i) => i.level === l).length}${l[0]}`).join(' ');
    console.log(`\n## ${r.file}  (${r.words}w, ${counts})`);
    for (const i of r.issues) console.log(`  ${i.level.padEnd(5)} ${i.msg}`);
    if (!r.issues.length) console.log('  clean');
  }
}
process.exit(results.some((r) => r.issues.some((i) => i.level === 'ERROR')) ? 1 : 0);
