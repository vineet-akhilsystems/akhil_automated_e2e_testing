import { randomUUID } from 'node:crypto';
import { validateCase, check, textValue } from './registry.mjs';
import { cleanModuleUrl, cleanVariants } from './readiness.mjs';

const covers = f => ({ fileId: f.id, sha256: f.sha256 ?? null, name: f.name });

const isReadable = f => f.extract === 'ok' || f.extract === 'partial';
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const RULE = /\b(must not|must|shall|should|required|mandatory|cannot|can't|can not|may not|not allowed|only if|only when|at least|at most|no more than|maximum|minimum|unique|validat\w*|if\b.+\bthen)\b/i;
const EDGE = /\b(edge|boundary|invalid|duplicate|empty|blank|null|special char\w*|negative|overflow|time ?out|exceed\w*|limit|too long|too short|zero|concurrent|offline|retry|whitespace)\b/i;
const QUESTION = /\?\s*$|\b(TBD|TBC|TODO|to be (confirmed|decided|defined)|unclear|not (yet )?(defined|specified|decided)|open (point|question|issue))\b/i;
const FIELD_LINE = /^[\s\-*•\d.)]*([A-Za-z][\w /()-]{1,40}?)\s*[:\-–—]\s*(.{3,200})$/;
const FIELD_HINT = /\b(text|number|numeric|date|dropdown|drop-down|select|checkbox|radio|email|phone|mandatory|required|optional|alphanumeric|string|boolean|free text|characters|digits)\b/i;
const FLOW_HEAD = /^[#\s]*(?:flow|workflow|process|scenario|steps|procedure|use case|journey)\b[:\s-]*(.*)$/i;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;
const isRequired = d => /\b(mandatory|required)\b/i.test(d) && !/\b(non[- ]?mandatory|not (mandatory|required)|optional)\b/i.test(d);
const guessType = values => {
  const v = values.filter(Boolean).slice(0, 20);
  if (!v.length) return 'text';
  if (v.every(x => /^-?\d+([.,]\d+)?$/.test(x))) return 'number';
  if (v.every(x => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(x))) return 'date';
  if (v.every(x => /^[^@\s]+@[^@\s]+\.\w+$/.test(x))) return 'email';
  if (v.every(x => /^(true|false|yes|no|y|n)$/i.test(x))) return 'boolean';
  return 'text';
};

export function heuristicAnalyse(sources) {
  const fields = [], rules = [], flows = [], edgeCases = [], openQuestions = [];
  const seen = new Set(); const once = (kind, text) => { const k = `${kind}:${text.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; };
  for (const { file, content } of sources) {
    const src = file.name;
    for (const t of content.tables ?? []) {
      const [header = [], ...body] = t.rows; if (!body.length) continue;
      const col = re => header.findIndex(h => re.test(h));
      const nameIdx = col(/^(field|attribute|column|parameter|element|label|name)\b/i);
      const typeIdx = col(/type|format/i), reqIdx = col(/mandatory|required|optional/i), descIdx = col(/desc|remark|validation|rule|note|comment/i);
      const caseSheet = col(/expected/i) >= 0 && col(/step|scenario|test/i) >= 0;
      if (caseSheet) {
        const titleIdx = Math.max(0, col(/title|scenario|test case|name|summary/i)), stepIdx = col(/step|procedure/i), expIdx = col(/expected/i);
        for (const r of body.slice(0, 60)) {
          const name = clip(r[titleIdx], 140); if (!name) continue;
          const steps = String(r[stepIdx] ?? '').split(/\r?\n|\s(?=\d+[.)]\s)/).map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
          if (steps.length && once('flow', name)) flows.push({ name, steps: steps.slice(0, 20), source: src });
          if (r[expIdx] && once('rule', r[expIdx])) rules.push({ text: clip(r[expIdx], 300), source: src });
        }
      } else if (nameIdx >= 0 && (typeIdx >= 0 || reqIdx >= 0 || descIdx >= 0)) {
        for (const r of body.slice(0, 300)) {
          const name = clip(r[nameIdx], 80); if (!name || !once('field', name)) continue;
          const desc = clip(r[descIdx] ?? '', 300);
          fields.push({ name, type: clip(r[typeIdx] ?? '', 40) || guessType([desc]), required: reqIdx >= 0 ? /^(y|yes|true|m|mandatory|required|\*)/i.test(String(r[reqIdx]).trim()) : isRequired(desc), description: desc, source: src });
          if (desc && RULE.test(desc) && once('rule', `${name}: ${desc}`)) rules.push({ text: `${name}: ${desc}`, source: src });
        }
      } else {
        header.forEach((h, i) => { const name = clip(h, 80); if (name && !/^\d+$/.test(name) && once('field', name)) fields.push({ name, type: guessType(body.map(r => r[i])), required: body.length > 0 && body.every(r => String(r[i] ?? '').trim()), description: `Column in ${t.name}`, source: src }); });
      }
    }
    if (content.tables?.length) continue; // tabular content already structured
    const lines = String(content.text ?? '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim(); if (!line) continue;
      const head = FLOW_HEAD.exec(line);
      const startsList = LIST_ITEM.test(lines[i]) && /^\s*\d+[.)]/.test(lines[i]);
      if ((head && LIST_ITEM.test(lines[i + 1] ?? '')) || (startsList && !LIST_ITEM.test(lines[i - 1] ?? ''))) {
        const steps = []; let j = head ? i + 1 : i;
        while (j < lines.length && LIST_ITEM.test(lines[j])) { steps.push(clip(LIST_ITEM.exec(lines[j])[1], 300)); j++; }
        if (steps.length >= 2) { const name = clip(head?.[1] || (lines[i - 1]?.trim() ?? '') || `Flow ${flows.length + 1}`, 120); if (once('flow', `${name}${steps[0]}`)) flows.push({ name, steps: steps.slice(0, 25), source: src }); i = j - 1; continue; }
      }
      const f = FIELD_LINE.exec(line);
      if (f && FIELD_HINT.test(f[2]) && !/[.!?]\s+\S+.*[.!?]/.test(f[2]) && once('field', f[1].trim())) fields.push({ name: clip(f[1], 80), type: (FIELD_HINT.exec(f[2])[1] ?? 'text').toLowerCase(), required: isRequired(f[2]), description: clip(f[2], 300), source: src });
      for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
        const text = clip(s.replace(/^[\s\-*•#\d.)]+/, ''), 300); if (text.length < 12) continue;
        if (QUESTION.test(text)) { if (once('q', text)) openQuestions.push({ text, source: src }); }
        else if (EDGE.test(text) && !RULE.test(text)) { if (once('edge', text)) edgeCases.push({ text, source: src }); }
        else if (RULE.test(text)) { if (once('rule', text)) rules.push({ text, source: src }); if (EDGE.test(text) && once('edge', text)) edgeCases.push({ text, source: src }); }
      }
    }
  }
  const unreadable = sources.filter(s => !isReadable(s.file));
  for (const s of unreadable) openQuestions.push({ text: `No readable text from "${s.file.name}" (${s.file.extractNote || s.file.extract}). What does it contain?`, source: s.file.name });
  for (const s of sources.filter(s => s.file.extract === 'partial')) openQuestions.push({ text: `Video visuals were not reviewed for "${s.file.name}" (keyframes only, no transcript); add a transcript.`, source: s.file.name });
  const cap = (a, n) => a.slice(0, n);
  const readable = sources.length - unreadable.length;
  return {
    summary: `Heuristic analysis of ${readable} readable file(s) of ${sources.length}: ${fields.length} field(s), ${rules.length} business rule(s), ${flows.length} flow(s), ${edgeCases.length} edge case(s), ${openQuestions.length} open question(s). Rule-based extraction only - review carefully.`,
    fields: cap(fields, 300), rules: cap(rules, 200), flows: cap(flows, 50), edgeCases: cap(edgeCases, 100), openQuestions: cap(openQuestions, 100), cases: [],
  };
}

// Draft case specs derived from a heuristic analysis.
export function heuristicCaseSpecs(a) {
  const specs = [];
  for (const f of a.fields.filter(f => f.required).slice(0, 25)) specs.push({ title: `Required field "${f.name}" cannot be left empty`, category: 'Intake - Fields', priority: 'P1', source: f.source,
    steps: [{ action: `Open the form, fill every field with valid data except "${f.name}", which stays empty, then submit.`, expected: `Submission is blocked and a message indicates "${f.name}" is required.` }] });
  for (const r of a.rules.slice(0, 30)) specs.push({ title: `Rule: ${clip(r.text, 110)}`, category: 'Intake - Rules', priority: 'P1', source: r.source,
    steps: [{ action: `Use data that satisfies this rule and perform the related action: "${clip(r.text, 250)}"`, expected: 'The system accepts the input and behaves as the source describes.' },
      { action: 'Repeat with data that violates the same rule.', expected: 'The system rejects the input or shows the message the source specifies.' }] });
  for (const e of a.edgeCases.slice(0, 20)) specs.push({ title: `Edge: ${clip(e.text, 110)}`, category: 'Intake - Edge cases', priority: 'P2', source: e.source,
    steps: [{ action: `Exercise this edge case: "${clip(e.text, 250)}"`, expected: 'The system handles it without errors or data corruption, with a clear message where applicable.' }] });
  for (const f of a.flows.slice(0, 12)) specs.push({ title: `Flow: ${clip(f.name, 110)}`, category: 'Intake - Flows', priority: 'P1', source: f.source,
    steps: f.steps.map((s, i) => ({ action: s, expected: i === f.steps.length - 1 ? 'The flow completes successfully and the result is visible to the user.' : 'The step completes without error.' })) });
  return specs;
}

const SYSTEM = `You are a senior QA business analyst. From the supplied module documents produce structured insights and draft manual test cases. Respond with ONE JSON object only, no prose, with keys: summary (string), fields ([{name,type,required(boolean),description,source}]), rules ([{text,source}]), flows ([{name,steps:[string],source}]), edgeCases ([{text,source}]), openQuestions ([{text,source}]), cases ([{title,category,priority:"P0"|"P1"|"P2"|"P3",preconditions,requirement,source,steps:[{action,expected}]}]). "source" is the file name. Only state what the documents support; put gaps in openQuestions. Max 40 cases, each with at least one step having an expected result.`;

export async function llmAnalyse(sources, { apiKey, model, baseUrl, fetchImpl = fetch, moduleName }) {
  const budget = 120_000, per = Math.max(4000, Math.floor(budget / Math.max(1, sources.length)));
  const docs = sources.filter(s => isReadable(s.file)).map(s => `### FILE: ${s.file.name}\n${String(s.content.text).slice(0, per)}`).join('\n\n');
  const res = await fetchImpl(`${baseUrl}/v1/messages`, {
    method: 'POST', signal: AbortSignal.timeout(300_000),
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: `Module: ${moduleName}\n\n${docs}` }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API returned HTTP ${res.status}`);
  const payload = await res.json();
  const text = (payload.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model response contained no JSON.');
  let o; try { o = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('Model response was not valid JSON.'); }
  const list = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
  const str = (v, n = 400) => clip(v, n);
  const withText = v => list(v, 150).map(x => ({ text: str(typeof x === 'string' ? x : x?.text, 400), source: str(x?.source ?? '', 200) })).filter(x => x.text);
  return {
    summary: str(o.summary, 3000) || 'No summary returned.',
    fields: list(o.fields, 300).map(f => ({ name: str(f?.name, 80), type: str(f?.type ?? 'text', 40), required: f?.required === true, description: str(f?.description, 400), source: str(f?.source ?? '', 200) })).filter(f => f.name),
    rules: withText(o.rules), edgeCases: withText(o.edgeCases), openQuestions: withText(o.openQuestions),
    flows: list(o.flows, 50).map(f => ({ name: str(f?.name, 120), steps: list(f?.steps, 25).map(s => str(s, 300)).filter(Boolean), source: str(f?.source ?? '', 200) })).filter(f => f.name && f.steps.length),
    cases: list(o.cases, 60).map(c => ({ title: str(c?.title, 300), category: str(c?.category || 'Intake - AI', 100), priority: ['P0', 'P1', 'P2', 'P3'].includes(c?.priority) ? c.priority : 'P2', preconditions: str(c?.preconditions ?? '', 1000), requirement: str(c?.requirement ?? '', 300), source: str(c?.source ?? '', 200),
      steps: list(c?.steps, 30).map(s => ({ action: str(s?.action, 1000), expected: str(s?.expected, 1000) })).filter(s => s.action && s.expected) })).filter(c => c.title && c.steps.length),
  };
}

export function nextCaseIds(module, existing, count) {
  const prefix = module.prefix || 'TC', re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
  const taken = new Set(existing.map(c => c.id)); let n = 0;
  for (const c of existing) { const m = re.exec(c.id); if (m) n = Math.max(n, Number(m[1])); }
  const ids = [];
  while (ids.length < count) { const id = `${prefix}-${String(++n).padStart(3, '0')}`; if (!taken.has(id)) ids.push(id); }
  return ids;
}

const TARGET_REF = /^\{\{[\w-]+@[\w-]+\}\}$/;
const AUTOMATION_KEYS =['action', 'base', 'input', 'expected', 'registrationType', 'target'];
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

// Turns case specs into validated draft cases. Invalid or duplicate-titled specs are skipped.
// When the module has an automation adapter and a spec carries structured fields (action/base/input/expected),
// the draft is saved as an automated case if it passes validateCase; otherwise it falls back to manual steps.
// Either way the draft stays reviewStatus 'draft', so the review gate is unchanged.
export function buildDraftCases({ module, existingCases, specs, user, insightId, mode }) {
  const titles = new Set(existingCases.map(c => c.title.trim().toLowerCase()));
  const fresh = specs.filter(s => { const k = s.title.trim().toLowerCase(); if (titles.has(k)) return false; titles.add(k); return true; });
  const ids = nextCaseIds(module, existingCases, fresh.length), cases = []; let skipped = 0, automated = 0, fellBack = 0;
  const at = new Date().toISOString();
  fresh.forEach((s, i) => {
    const common = { id: ids[i], title: s.title, category: s.category, priority: s.priority, preconditions: s.preconditions ?? '', requirement: s.requirement ?? '',
      reviewStatus: 'draft', origin: { type: 'intake', insightId, mode, source: s.source ?? '' }, createdBy: { user: user.username, at } };
    const note = kind => `Draft from module intake (${mode}). Source: ${s.source || 'intake files'}. ${kind}`;
    // An AI-written update may only target a record another case creates ({{name@CASE-ID}}), never a literal (real) patient id.
    const badTarget = s.target !== undefined && s.target !== '' && !TARGET_REF.test(String(s.target).trim());
    if (badTarget) fellBack++;
    if (!badTarget && module.adapter && typeof s.action === 'string' && plain(s.expected) && typeof s.expected.outcome === 'string') {
      try {
        const structured = Object.fromEntries(AUTOMATION_KEYS.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
        cases.push(validateCase({ ...common, mode: 'automated', ...structured, steps: s.steps ?? [], notes: note('Automated draft: review the expected outcome before approving; it will not run until approved.') }, module));
        automated++; return;
      } catch { fellBack++; /* fall through to manual steps */ }
    }
    try {
      cases.push(validateCase({ ...common, mode: 'manual', steps: s.steps, notes: note(badTarget ? 'Converted to manual: the proposed update target was not a {{name@CASE-ID}} reference, and AI-written cases must not point at a real patient. Needs human review before it can be run.' : 'Needs human review before it can be run.') }, module));
    } catch { skipped++; }
  });
  return { cases, skipped, duplicates: specs.length - fresh.length, automated, fellBack };
}

export async function analyseModule({ module, sources, existingCases, user, env = process.env, fetchImpl, onProgress = () => {} }) {
  const apiKey = env.ANTHROPIC_API_KEY, model = env.INSIGHTS_MODEL || 'claude-sonnet-5-5';
  const baseUrl = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const id = randomUUID();
  let mode = 'heuristic', analysis, fallbackReason = '';
  onProgress(30, 'Reading extracted text');
  if (apiKey && sources.some(s => isReadable(s.file))) {
    try { onProgress(40, 'Asking the model for insights'); analysis = await llmAnalyse(sources, { apiKey, model, baseUrl, fetchImpl, moduleName: module.name }); mode = 'llm'; }
    catch (e) { fallbackReason = `LLM unavailable (${String(e.message ?? e).replace(apiKey, '***').slice(0, 160)}); used the built-in heuristic instead.`; }
  }
  if (!analysis) { analysis = heuristicAnalyse(sources); analysis.cases = heuristicCaseSpecs(analysis); }
  onProgress(80, 'Preparing draft test cases');
  const drafts = buildDraftCases({ module, existingCases: typeof existingCases === 'function' ? existingCases() : existingCases, specs: analysis.cases, user, insightId: id, mode });
  const { cases: _specs, ...body } = analysis;
  const doc = { id, moduleId: module.id, createdAt: new Date().toISOString(), createdBy: user.username, mode, ...(mode === 'llm' ? { model } : {}), status: 'done', ...(fallbackReason ? { fallbackReason } : {}), ...body,
    sources: sources.map(s => ({ fileId: s.file.id, name: s.file.name, kind: s.file.kind, extract: s.file.extract, chars: s.file.chars ?? 0, note: s.file.extractNote ?? '' })),
    coveredSources: sources.filter(s => s.file.extract !== 'pending').map(s => covers(s.file)),
    draftCaseIds: drafts.cases.map(c => c.id), draftSkipped: drafts.skipped, draftDuplicates: drafts.duplicates };
  return { doc, cases: drafts.cases };
}

// Structured automation fields from an outside agent. Anything malformed is dropped so the case falls back to manual steps.
function automationSpec(c) {
  if (typeof c.action !== 'string' || !plain(c.expected) || !plain(c.input ?? {})) return {};
  if (!Object.values(c.input ?? {}).every(v => typeof v === 'string' || typeof v === 'boolean')) return {};
  const out = { action: c.action, expected: structuredClone(c.expected), input: { ...(c.input ?? {}) } };
  for (const k of ['base', 'registrationType', 'target']) if (typeof c[k] === 'string' && c[k]) out[k] = c[k];
  return out;
}

// Saves an analysis written by an outside assistant or coding agent. Cases always arrive as drafts.
// A suggested target setup from the analysis: never applied automatically (a lead confirms it). Anything invalid is dropped, not an error.
function cleanSuggestedSetup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out = {};
  try { if (raw.moduleUrl !== undefined) out.moduleUrl = cleanModuleUrl(raw.moduleUrl); } catch { /* ignore */ }
  try { if (raw.variants !== undefined) out.variants = cleanVariants((Array.isArray(raw.variants) ? raw.variants : []).slice(0, 20).map(v => String(v ?? '').slice(0, 60))); } catch { /* ignore */ }
  return Object.keys(out).length ? out : undefined;
}

// coveredFileIds (optional): the files this analysis really read; default is every stored file that is not still being processed.
export function saveExternalInsights({ store, module, body, user, mode = 'assistant', model, coveredFileIds }) {
  const mid = module.id;
  check(body && typeof body === 'object', 'Insights must be a JSON object.');
  const list = (v, n) => { check(v === undefined || Array.isArray(v), `${n} must be a list.`); return (v ?? []).slice(0, 500); };
  const items = (v, n) => list(v, n).map(x => typeof x === 'string' ? { text: textValue(x, n, 2000, true), source: '' } : { text: textValue(x?.text, n, 2000, true), source: textValue(x?.source ?? '', 'source', 300) });
  const files = store.intakeFiles(mid);
  const coveredSet = coveredFileIds ? new Set(coveredFileIds) : null;
  const suggestedSetup = cleanSuggestedSetup(body.suggestedSetup);
  const id = randomUUID();
  const specs = list(body.cases, 'cases').map(c => ({ title: textValue(c.title, 'Case title', 200, true), category: textValue(c.category ?? 'General', 'Suite', 120, true), priority: ['P0', 'P1', 'P2', 'P3'].includes(c.priority) ? c.priority : 'P2',
    preconditions: textValue(c.preconditions ?? '', 'preconditions', 1000), requirement: textValue(c.requirement ?? '', 'requirement', 200), source: textValue(c.source ?? '', 'source', 300),
    steps: list(c.steps, 'steps').map(st => ({ action: textValue(st.action, 'Step action', 500, true), expected: textValue(st.expected ?? '', 'Step expected result', 500) })),
    ...automationSpec(c) }));
  const drafts = buildDraftCases({ module, existingCases: store.cases(mid), specs, user, insightId: id, mode });
  const doc = { id, moduleId: mid, createdAt: new Date().toISOString(), createdBy: user.username, mode, ...(model ? { model } : {}), status: 'done', summary: textValue(body.summary, 'Summary', 8000, true),
    fields: list(body.fields, 'fields').map(f => ({ name: textValue(f.name, 'Field name', 200, true), type: textValue(f.type ?? '', 'type', 80), required: Boolean(f.required), description: textValue(f.description ?? '', 'description', 1000), source: textValue(f.source ?? '', 'source', 300) })),
    rules: items(body.rules, 'rules'), edgeCases: items(body.edgeCases, 'edgeCases'), openQuestions: items(body.openQuestions, 'openQuestions'),
    flows: list(body.flows, 'flows').map(f => ({ name: textValue(f.name, 'Flow name', 200, true), steps: list(f.steps, 'flow steps').map(x => textValue(x, 'Flow step', 500, true)), source: textValue(f.source ?? '', 'source', 300) })),
    sources: files.map(f => ({ fileId: f.id, name: f.name, kind: f.kind, extract: f.extract, chars: f.chars ?? 0, note: f.extractNote ?? '' })),
    coveredSources: files.filter(f => coveredSet ? coveredSet.has(f.id) : f.extract !== 'pending').map(covers),
    ...(suggestedSetup ? { suggestedSetup } : {}),
    draftCaseIds: drafts.cases.map(c => c.id), draftSkipped: drafts.skipped, draftDuplicates: drafts.duplicates, draftAutomated: drafts.automated };
  const stored = store.transaction(() => { const saved = store.saveInsights(doc); drafts.cases.forEach(c => store.saveCase(mid, c)); return saved; });
  return { id, version: stored.version, changeSummary: stored.changeSummary, mode, draftCases: drafts.cases.length, draftIds: drafts.cases.map(c => c.id), skipped: drafts.skipped, duplicates: drafts.duplicates, automatedDrafts: drafts.automated };
}
