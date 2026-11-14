import fs from 'node:fs';
import path from 'node:path';
import { check } from './registry.mjs';

// The tester knowledge pack: plain markdown a senior tester keeps up to date, injected into the AI agent's brief.
//   qa/knowledge/mindset.md              how an experienced tester thinks (all products and modules)
//   qa/knowledge/domain/<productId>.md   domain knowledge for a product (falls back to domain/default.md)
//   qa/knowledge/modules/<moduleId>.md   lessons for one module: past defects, confirmed rules, risks
// It is guidance, never a source of requirements: the agent is told to mark anything that rests only on it as assumed.

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const LIMITS = { mindset: 6000, domain: 8000, module: 8000 };
export const MAX_SAVE_CHARS = 20000;
export const LAYERS = ['mindset', 'domain', 'module'];

export const knowledgeRoot = root => path.join(root, 'qa', 'knowledge');

function fileFor(root, layer, id) {
  const dir = knowledgeRoot(root);
  if (layer === 'mindset') return path.join(dir, 'mindset.md');
  check(ID.test(String(id ?? '')), 'Invalid name.');
  return path.join(dir, layer === 'domain' ? 'domain' : 'modules', `${String(id).toLowerCase()}.md`);
}

function trim(text, limit) {
  const t = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (t.length <= limit) return { text: t, truncated: false };
  const cut = t.slice(0, limit), at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'));
  return { text: `${cut.slice(0, at > limit * 0.6 ? at : limit).trimEnd()}\n\n[...trimmed to fit the agent's reading budget]`, truncated: true };
}

const readIf = file => { try { return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null; } catch { return null; } };

/** What the agent will be given for a module, with the file list so the portal can show exactly what was used. */
export function loadKnowledge({ root, module }) {
  const product = String(module?.productId ?? 'augastam').toLowerCase(), mid = String(module?.id ?? '').toLowerCase();
  const picks = [
    { layer: 'mindset', name: 'mindset.md', raw: readIf(fileFor(root, 'mindset')), limit: LIMITS.mindset },
    { layer: 'domain', name: `domain/${product}.md`, raw: readIf(fileFor(root, 'domain', product)) ?? readIf(fileFor(root, 'domain', 'default')), limit: LIMITS.domain },
    { layer: 'module', name: `modules/${mid}.md`, raw: ID.test(mid) ? readIf(fileFor(root, 'module', mid)) : null, limit: LIMITS.module },
  ];
  const parts = [], files = [];
  for (const p of picks) {
    if (!p.raw?.trim()) continue;
    const { text, truncated } = trim(p.raw, p.limit);
    parts.push(`### ${p.name}\n${text}`);
    files.push({ layer: p.layer, name: p.name, chars: text.length, truncated });
  }
  return { text: parts.join('\n\n'), files, chars: parts.reduce((n, p) => n + p.length, 0) };
}

/** The three layers for the editor: current text (or '' when the file does not exist) and where it lives. */
export function readLayers({ root, module }) {
  const product = String(module?.productId ?? 'augastam').toLowerCase(), mid = String(module.id).toLowerCase();
  const one = (layer, id, label) => ({ layer, id: id ?? null, label, text: (readIf(fileFor(root, layer, id)) ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n'), exists: Boolean(readIf(fileFor(root, layer, id))), limit: LIMITS[layer] });
  return [one('mindset', null, 'How a senior tester thinks (all modules)'), one('domain', product, `Domain notes (${product})`), one('module', mid, `Lessons for ${module.name ?? mid}`)];
}

export function saveLayer({ root, layer, id, text }) {
  check(LAYERS.includes(layer), 'Unknown knowledge layer.');
  check(typeof text === 'string' && text.length <= MAX_SAVE_CHARS, `Keep it under ${MAX_SAVE_CHARS} characters.`);
  const file = fileFor(root, layer, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text.replace(/\r\n/g, '\n'), 'utf8');
  fs.renameSync(tmp, file);
  return { layer, chars: text.length, overBudget: text.length > LIMITS[layer] };
}

/** The part of the agent brief that carries the experience. Written as guidance with hard limits on how it may be used. */
export function knowledgeSection(pack) {
  if (!pack?.text) return '';
  return `
## Senior tester brief (experience, not requirements)
You are a senior tester with about six years of experience in healthcare software. The notes below are that experience: how to think, domain practice, and lessons from real defects in this product. Use them to decide WHAT to test and WHERE the risk is.
- They are guidance, not source material. A fact from the notes is never a "confirmed" rule: if a case depends only on the notes, set "basis": "experience", say so in the case, and set "assumed": true on any automated expectation. Only files in input/ confirm a rule.
- When a lesson says a defect pattern was found before, look for the same pattern in this module's material and write a case for it.
- If the notes and the files disagree, the files win; add the disagreement to openQuestions.

${pack.text}
`;
}
