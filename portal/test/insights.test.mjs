import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, signedIn, until } from './support.mjs';
import { heuristicAnalyse, heuristicCaseSpecs, buildDraftCases, nextCaseIds, analyseModule } from '../insights.mjs';

const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const file = (name, text, tables = []) => ({ file: { id: name, name, kind: 'text', extract: 'ok', chars: text.length }, content: { text, tables } });
const SPEC = `Registration form
Patient Name: text field, mandatory, max 50 characters
Phone: numeric, required, exactly 10 digits
Notes: free text, optional
The phone number must be unique per patient.
Email should be validated when entered.
What is the maximum age for a newborn registration?

Registration flow:
1. Open the registration page
2. Fill the mandatory fields
3. Click Save
`;

test('heuristic extractor finds fields, rules, flows, questions and builds draft specs', () => {
  const a = heuristicAnalyse([file('spec.txt', SPEC)]);
  assert.ok(a.fields.some(f => f.name === 'Patient Name' && f.required));
  assert.ok(a.fields.some(f => f.name === 'Notes' && !f.required));
  assert.ok(a.rules.some(r => /unique/.test(r.text)));
  assert.ok(a.openQuestions.some(q => /maximum age/.test(q.text)));
  assert.equal(a.flows.length, 1); assert.equal(a.flows[0].steps.length, 3);
  assert.ok(a.rules.every(r => r.source === 'spec.txt'));
  assert.ok(heuristicCaseSpecs(a).length >= 4);
});

test('tabular data dictionaries become fields; unreadable files become open questions', () => {
  const tables = [{ name: 'Dict', rows: [['Field', 'Type', 'Mandatory', 'Validation'], ['Email', 'text', 'Yes', 'Must be a valid email'], ['Age', 'number', 'No', '']] }];
  const a = heuristicAnalyse([file('dict.xlsx', '', tables), { file: { id: 'v', name: 'demo.mp4', kind: 'video', extract: 'unsupported', extractNote: 'Needs transcript' }, content: { text: '', tables: [] } }]);
  assert.deepEqual(a.fields.map(f => [f.name, f.required]), [['Email', true], ['Age', false]]);
  assert.ok(a.rules.some(r => /valid email/.test(r.text)));
  assert.ok(a.openQuestions.some(q => /demo\.mp4/.test(q.text)));
});

test('draft cases are validated, numbered after existing ids, de-duplicated and always draft', () => {
  const module = { id: 'reg', prefix: 'REG', name: 'Reg', adapter: 'registration', config: { bases: {} } };
  const existing = [{ id: 'REG-300', title: 'Rule: existing', mode: 'manual' }];
  assert.deepEqual(nextCaseIds(module, existing, 2), ['REG-301', 'REG-302']);
  const specs = [{ title: 'Rule: existing', category: 'x', priority: 'P1', steps: [{ action: 'a', expected: 'b' }] },
    { title: 'New one', category: 'x', priority: 'P1', source: 's.txt', steps: [{ action: 'a', expected: 'b' }] },
    { title: 'No steps', category: 'x', priority: 'P1', steps: [] }];
  const out = buildDraftCases({ module, existingCases: existing, specs, user: { username: 'bob' }, insightId: 'i1', mode: 'heuristic' });
  assert.equal(out.cases.length, 1); assert.equal(out.duplicates, 1); assert.equal(out.skipped, 1);
  assert.deepEqual([out.cases[0].id, out.cases[0].reviewStatus, out.cases[0].mode, out.cases[0].createdBy.user], ['REG-301', 'draft', 'manual', 'bob']);
});

test('structured automated drafts are kept when valid for an adapter module, otherwise fall back to manual; always draft', () => {
  const module = { id: 'reg', prefix: 'REG', name: 'Reg', adapter: 'registration', config: { bases: { valid: {} } } };
  const steps = [{ action: 'Type 11 digits', expected: 'Only 10 kept' }];
  const specs = [
    { title: 'Auto ok', category: 'x', priority: 'P1', steps, action: 'fill', registrationType: 'New Registration', input: { mobile: '98765432109' }, expected: { outcome: 'field-state', values: { mobile: '9876543210' } } },
    { title: 'Auto bad field', category: 'x', priority: 'P1', steps, action: 'fill', input: { not_a_field: 'x' }, expected: { outcome: 'field-state' } },
    { title: 'Auto bad no steps', category: 'x', priority: 'P1', action: 'nope', input: {}, expected: { outcome: 'created' } },
    { title: 'Manual only', category: 'x', priority: 'P1', steps }];
  const out = buildDraftCases({ module, existingCases: [], specs, user: { username: 'bob' }, insightId: 'i', mode: 'agent:claude' });
  assert.deepEqual(out.cases.map(c => [c.title, c.mode, c.reviewStatus]), [['Auto ok', 'automated', 'draft'], ['Auto bad field', 'manual', 'draft'], ['Manual only', 'manual', 'draft']]);
  assert.equal(out.automated, 1); assert.equal(out.skipped, 1);
  assert.equal(out.cases[0].action, 'fill');
  // a module without an adapter ignores structured fields
  const plainOut = buildDraftCases({ module: { id: 'b', prefix: 'B', name: 'B', config: {} }, existingCases: [], specs: [specs[0]], user: { username: 'bob' }, insightId: 'i', mode: 'x' });
  assert.equal(plainOut.cases[0].mode, 'manual'); assert.equal(plainOut.cases[0].action, undefined);
});

test('LLM mode uses the Anthropic HTTP API, never logs the key, and falls back to heuristics on failure', async () => {
  const module = { id: 'm', prefix: 'M', name: 'M', config: {} };
  const seen = [];
  const good = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here: ' + JSON.stringify({ summary: 'S', fields: [{ name: 'Phone', type: 'text', required: true }], rules: [{ text: 'Phone is 10 digits', source: 'spec.txt' }], flows: [], edgeCases: [], openQuestions: [],
      cases: [{ title: 'Phone length', priority: 'P0', steps: [{ action: 'Enter 9 digits', expected: 'Rejected' }] }, { title: 'bad case', steps: [] }] }) }] }) };
  };
  const env = { ANTHROPIC_API_KEY: 'sk-test-secret', INSIGHTS_MODEL: 'test-model', ANTHROPIC_BASE_URL: 'http://llm.invalid' };
  const r = await analyseModule({ module, sources: [file('spec.txt', SPEC)], existingCases: [], user: { username: 'u' }, env, fetchImpl: good });
  assert.equal(r.doc.mode, 'llm'); assert.equal(r.doc.model, 'test-model');
  assert.equal(seen[0].url, 'http://llm.invalid/v1/messages'); assert.equal(seen[0].headers['x-api-key'], 'sk-test-secret'); assert.equal(seen[0].body.model, 'test-model');
  assert.equal(r.cases.length, 1); assert.equal(r.cases[0].priority, 'P0'); assert.equal(r.cases[0].reviewStatus, 'draft');
  assert.ok(!JSON.stringify(r.doc).includes('sk-test-secret'));
  const bad = async () => ({ ok: false, status: 529, json: async () => ({}) });
  const fb = await analyseModule({ module, sources: [file('spec.txt', SPEC)], existingCases: [], user: { username: 'u' }, env, fetchImpl: bad });
  assert.equal(fb.doc.mode, 'heuristic'); assert.match(fb.doc.fallbackReason, /529/); assert.ok(fb.cases.length > 0);
  const none = await analyseModule({ module, sources: [file('spec.txt', SPEC)], existingCases: [], user: { username: 'u' }, env: {} });
  assert.equal(none.doc.mode, 'heuristic'); assert.equal(none.doc.fallbackReason, undefined);
});

test('analyze job end to end: insights stored, draft cases saved for review', async t => {
  const f = await boot(t, { bootstrap: ADMIN });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  await admin.request('/api/modules', 'POST', { name: 'Reg2', prefix: 'RG', area: 'A' });
  assert.equal((await admin.request('/api/modules/reg2/intake/analyze', 'POST', {})).status, 400); // nothing uploaded
  assert.equal((await admin.request('/api/modules/reg2/insights')).status, 404);
  await admin.request('/api/modules/reg2/intake/files', 'POST', Buffer.from(SPEC), { 'x-file-name': 'spec.txt' });
  await admin.request('/api/modules/reg2/intake/files', 'POST', Buffer.from('not really video'), { 'x-file-name': 'walkthrough.mp4' });
  const first = (await admin.request('/api/modules/reg2/intake/analyze', 'POST', {}));
  assert.equal(first.status, 202);
  const job = await until(async () => { const r = (await admin.request(`/api/modules/reg2/intake/analyze/${first.value.jobId}`)).value; return r.status !== 'running' ? r : null; });
  assert.equal(job.status, 'done', job.message); assert.equal(job.progress, 100);
  const insights = (await admin.request('/api/modules/reg2/insights')).value;
  assert.equal(insights.mode, 'heuristic');
  for (const k of ['summary', 'fields', 'rules', 'flows', 'edgeCases', 'openQuestions', 'sources', 'createdAt']) assert.ok(k in insights, k);
  assert.ok(insights.sources.some(s => s.name === 'walkthrough.mp4' && s.extract === 'unsupported'));
  const cases = (await admin.request('/api/modules/reg2/cases')).value;
  assert.ok(cases.length > 0 && cases.every(c => c.reviewStatus === 'draft'));
  assert.deepEqual(insights.draftCaseIds.sort(), cases.map(c => c.id).sort());
  const meta = (await admin.request('/api/modules/reg2/intake')).value.insights;
  assert.equal(meta.id, insights.id); assert.equal(meta.counts.draftCases, cases.length);
  // second run adds no duplicate drafts
  const again = (await admin.request('/api/modules/reg2/intake/analyze', 'POST', { fileIds: [] }));
  assert.equal(again.status, 400); // empty selection
  const second = (await admin.request('/api/modules/reg2/intake/analyze', 'POST', {})).value.jobId;
  await until(async () => (await admin.request(`/api/modules/reg2/intake/analyze/${second}`)).value.status === 'done');
  assert.equal((await admin.request('/api/modules/reg2/cases')).value.length, cases.length);
});

test('AI-written update drafts may only target a {{name@CASE-ID}} reference; literal patient ids fall back to manual with a note', () => {
  const module = { id: 'reg', prefix: 'REG', name: 'Reg', adapter: 'registration', config: { bases: {} } };
  const steps = [{ action: 'Open the patient', expected: 'Opens' }];
  const mk = (title, target) => ({ title, category: 'x', priority: 'P1', steps, action: 'update', target, input: { email: 'a@example.test' }, expected: { outcome: 'updated' } });
  const out = buildDraftCases({ module, existingCases: [], specs: [mk('literal', 'ABC123'), mk('ref', '{{regId@REG-001}}'), mk('injected', '{{regId@REG-001}} x')], user: { username: 'bob' }, insightId: 'i', mode: 'agent:claude' });
  assert.deepEqual(out.cases.map(c => [c.title, c.mode]), [['literal', 'manual'], ['ref', 'automated'], ['injected', 'manual']]);
  assert.match(out.cases[0].notes, /not a {{name@CASE-ID}} reference/); assert.equal(out.cases[0].target, undefined);
});

test('partial (keyframes-only) files add an open question about unreviewed video visuals', () => {
  const a = heuristicAnalyse([{ file: { name: 'demo.mp4', extract: 'partial' }, content: { text: 'frame 1 at 0:01', tables: [] } }]);
  assert.ok(a.openQuestions.some(q => /visuals were not reviewed/.test(q.text) && /transcript/.test(q.text)));
});
