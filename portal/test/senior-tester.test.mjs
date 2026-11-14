import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { loadKnowledge, readLayers, saveLayer, knowledgeSection, LIMITS } from '../knowledge.mjs';
import { applyCritique, critiqueInstructions } from '../critique.mjs';
import { instructions } from '../agent.mjs';
import { cleanRisks } from '../insights.mjs';
import { boot, signedIn, makeUser, until } from './support.mjs';

const tempRoot = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const put = (root, rel, text) => { const f = path.join(root, 'qa', 'knowledge', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

// ---- knowledge pack -------------------------------------------------------------------------------------------------
test('knowledge pack loads mindset, product domain and module lessons, and skips what is missing', t => {
  const root = tempRoot(t);
  put(root, 'mindset.md', '# Mindset\nThink in risk.'); put(root, 'domain/augastam.md', 'Domain notes.'); put(root, 'modules/billing.md', 'Billing lessons.');
  const pack = loadKnowledge({ root, module: { id: 'billing', productId: 'augastam' } });
  assert.deepEqual(pack.files.map(f => f.name), ['mindset.md', 'domain/augastam.md', 'modules/billing.md']);
  assert.match(pack.text, /### modules\/billing\.md\nBilling lessons\./);
  const bare = loadKnowledge({ root, module: { id: 'other', productId: 'miracle' } });
  assert.deepEqual(bare.files.map(f => f.name), ['mindset.md'], 'no domain or module file for this module');
  assert.equal(loadKnowledge({ root: tempRoot(t), module: { id: 'x' } }).text, '');
});

test('a product without its own domain file falls back to domain/default.md, and long files are trimmed to budget', t => {
  const root = tempRoot(t);
  put(root, 'domain/default.md', 'Default domain.'); put(root, 'modules/big.md', ('Paragraph about risk.\n\n').repeat(2000));
  const pack = loadKnowledge({ root, module: { id: 'big', productId: 'miracle' } });
  assert.ok(pack.files.some(f => f.name === 'domain/miracle.md' && f.layer === 'domain'));
  const mod = pack.files.find(f => f.layer === 'module');
  assert.ok(mod.truncated && mod.chars <= LIMITS.module + 80, `module file ${mod.chars}`);
  assert.match(pack.text, /trimmed to fit/);
});

test('saving a layer validates the name and size, writes the file, and readLayers returns it', t => {
  const root = tempRoot(t);
  assert.throws(() => saveLayer({ root, layer: 'module', id: '../escape', text: 'x' }), /Invalid name/);
  assert.throws(() => saveLayer({ root, layer: 'module', id: 'billing', text: 'x'.repeat(20001) }), /under/);
  assert.throws(() => saveLayer({ root, layer: 'secrets', id: 'a', text: 'x' }), /Unknown/);
  const r = saveLayer({ root, layer: 'module', id: 'billing', text: 'Lesson one.' });
  assert.equal(r.chars, 11);
  const layers = readLayers({ root, module: { id: 'billing', name: 'Billing', productId: 'augastam' } });
  assert.equal(layers.find(l => l.layer === 'module').text, 'Lesson one.');
  assert.equal(layers.find(l => l.layer === 'mindset').exists, false);
  assert.ok(fs.existsSync(path.join(root, 'qa', 'knowledge', 'modules', 'billing.md')));
});

test('the repository ships a mindset, a domain draft and Registration lessons that actually load', () => {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const pack = loadKnowledge({ root, module: { id: 'registration', productId: 'augastam' } });
  assert.deepEqual(pack.files.map(f => f.name), ['mindset.md', 'domain/augastam.md', 'modules/registration.md']);
  assert.match(pack.text, /DRAFT/); assert.match(pack.text, /REG-090/);
  assert.ok(pack.chars < 16000, `pack is ${pack.chars} characters`);
});

// ---- the brief ------------------------------------------------------------------------------------------------------
test('with a knowledge pack the brief asks for risks first, a basis on every case, and treats the notes as guidance only', () => {
  const pack = { text: '### mindset.md\nThink in risk.', files: [] };
  const brief = instructions({ kind: 'analyze', module: { id: 'billing', name: 'Billing', area: 'Fin' }, knowledge: pack });
  assert.match(brief, /Senior tester brief/); assert.match(brief, /Think in risk\./);
  assert.match(brief, /not source material/i); assert.match(brief, /"basis": "experience"/); assert.match(brief, /Decide the RISKS first/);
  assert.match(brief, /"risks": \[/);
  const plain = instructions({ kind: 'analyze', module: { id: 'billing', name: 'Billing', area: 'Fin' }, knowledge: null });
  assert.ok(!/Senior tester brief/.test(plain) && !/Decide the RISKS first/.test(plain), 'no pack, no persona section');
  assert.equal(knowledgeSection({ text: '' }), '');
});

// ---- reviewer: what it may and may not do ---------------------------------------------------------------------------
const draft = n => ({ cases: Array.from({ length: n }, (_, i) => ({ title: `Case ${i}`, category: 'c', priority: 'P2', source: `file${i}.xlsx`, steps: [{ action: 'a', expected: 'vague' }] })) });

test('reviewer can improve, drop and add; improved cases keep their source and every case gets a note', () => {
  const { body, stats } = applyCritique(draft(4), { summary: 'Decent but vague.', verdicts: [
    { index: 0, action: 'keep', note: 'Good.' },
    { index: 1, action: 'improve', note: 'Expected result was vague.', improved: { title: 'Case 1 (tighter)', steps: [{ action: 'a', expected: 'Record saved and visible after reopen' }] } },
    { index: 2, action: 'drop', note: 'Duplicate of Case 0.' }],
  additions: [{ title: 'Whitespace-only first name', steps: [{ action: 'type spaces', expected: 'blocked' }], reviewNote: 'common bypass' }, { title: 'Case 0', steps: [] }], missingRisks: ['Duplicate patient'] });
  assert.deepEqual(stats, { kept: 2, improved: 1, dropped: 1, added: 1, dropGuard: false });
  assert.deepEqual(body.cases.map(c => c.title), ['Case 0', 'Case 1 (tighter)', 'Case 3', 'Whitespace-only first name']);
  assert.equal(body.cases[1].source, 'file1.xlsx', 'provenance is kept');
  assert.match(body.cases[1].reviewNote, /^Improved by the reviewer/); assert.match(body.cases[3].reviewNote, /^Added by the reviewer/);
  assert.deepEqual(body.critic.dropped, [{ title: 'Case 2', reason: 'Duplicate of Case 0.' }]);
  assert.deepEqual(body.critic.missingRisks, ['Duplicate patient']);
});

test('reviewer cannot drop more than half, add more than 8, or act on bad input', () => {
  const greedy = { verdicts: [0, 1, 2].map(index => ({ index, action: 'drop', note: 'meh' })) };
  const a = applyCritique(draft(4), greedy);
  assert.equal(a.stats.dropGuard, true); assert.equal(a.body.cases.length, 4, 'nothing dropped');
  assert.match(a.body.cases[0].reviewNote, /suggested dropping/);
  const many = { additions: Array.from({ length: 20 }, (_, i) => ({ title: `New ${i}`, steps: [] })) };
  assert.equal(applyCritique(draft(1), many).stats.added, 8);
  for (const bad of [null, 'nonsense', [], { verdicts: 'x' }, { verdicts: [{ index: 99, action: 'drop' }, { index: 0, action: 'explode' }] }]) {
    const r = applyCritique(draft(2), bad);
    assert.equal(r.body.cases.length, 2);
  }
  const original = draft(2); applyCritique(original, { verdicts: [{ index: 0, action: 'drop' }] });
  assert.equal(original.cases.length, 2, 'input is not mutated');
  assert.match(critiqueInstructions({ module: { name: 'Billing', area: 'Fin' }, knowledge: '' }), /output\/review\.json/);
});

// ---- saving: risks, basis, notes ---------------------------------------------------------------------------------------
test('risks are cleaned; malformed ones are dropped', () => {
  assert.deepEqual(cleanRisks([{ risk: ' Wrong patient ', impact: 'HIGH', likelihood: 'weird', coverage: 'REG-1', source: 'tester experience' }, 'Lost data', { impact: 'high' }, null, 5]).map(r => [r.risk, r.impact, r.likelihood]),
    [['Wrong patient', 'high', ''], ['Lost data', '', '']]);
  assert.deepEqual(cleanRisks('nope'), []);
});

// ---- end to end through the real agent runner with a fake CLI -------------------------------------------------------
const ADMIN = { username: 'root', password: 'correct-horse-battery' };
const probe = async id => ({ id, label: id, available: id !== 'codex', version: '9.9.9' });
function fakeAgent(onRun) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    const call = { cwd: opts.cwd, prompt: '', brief: fs.readFileSync(path.join(opts.cwd, 'INSTRUCTIONS.md'), 'utf8') }; calls.push(call);
    child.stdin.on('data', d => { call.prompt += d; });
    child.kill = () => { setImmediate(() => child.emit('exit', null)); return true; };
    setImmediate(() => { onRun(call, calls.length); child.stdout.end(); child.stderr.end(); child.emit('exit', call.exit ?? 0); });
    return child;
  };
  return { spawn, calls };
}
async function world(t, onRun, root) {
  const fake = fakeAgent(onRun);
  const f = await boot(t, { bootstrap: ADMIN, knowledgeRoot: root, agentOptions: { spawn: fake.spawn, probe } });
  const admin = await signedIn(f, ADMIN.username, ADMIN.password);
  const ba = await makeUser(admin, 'bob', 'ba'); const b = await signedIn(f, 'bob', ba.password);
  assert.equal((await admin.request('/api/modules', 'POST', { name: 'Billing', prefix: 'BIL', area: 'Finance' })).status, 201);
  assert.equal((await b.request('/api/modules/billing/intake/files', 'POST', Buffer.from('Invoice total must be at least 1.\n'), { 'x-file-name': 'rules.txt', 'content-type': 'application/octet-stream' })).status, 201);
  await until(async () => (await b.request('/api/modules/billing/intake')).value.files[0].extract === 'ok');
  return { f, fake, admin, b };
}
const run = async (b, body = {}) => {
  const r = await b.request('/api/modules/billing/agent/jobs', 'POST', { agent: 'claude', kind: 'analyze', ...body });
  assert.equal(r.status, 202, JSON.stringify(r.value));
  return until(async () => { const j = (await b.request(`/api/modules/billing/agent/jobs/${r.value.id}`)).value; return j.status !== 'running' ? j : null; });
};
const writeJson = (cwd, name, value) => { fs.mkdirSync(path.join(cwd, 'output'), { recursive: true }); fs.writeFileSync(path.join(cwd, 'output', name), JSON.stringify(value)); };
const FIRST = { summary: 'Billing invoices.', risks: [{ risk: 'Wrong invoice total', impact: 'high', likelihood: 'medium', coverage: 'cases 0-2', source: 'rules.txt' }],
  cases: [{ title: 'Total of 0 is rejected', category: 'validation', priority: 'P1', risk: 'Wrong invoice total', basis: 'source', source: 'rules.txt', steps: [{ action: 'Enter 0', expected: 'blocked' }] },
    { title: 'Total of 0 is not accepted', category: 'validation', priority: 'P1', source: 'rules.txt', steps: [{ action: 'Enter 0', expected: 'blocked' }] },
    { title: 'Large totals keep two decimals', category: 'format', priority: 'P2', risk: 'Wrong invoice total', basis: 'experience', source: 'tester experience', steps: [{ action: 'Enter 1234567.891', expected: 'rounded to 2 decimals' }] }] };

test('end to end: the agent gets the senior-tester brief, a reviewer then improves the draft, and the result is saved with risks and notes', async t => {
  const root = tempRoot(t);
  put(root, 'mindset.md', 'MINDSET-MARKER think in risk'); put(root, 'domain/augastam.md', 'DOMAIN-MARKER'); put(root, 'modules/billing.md', 'LESSON-MARKER rounding bugs');
  const { fake, b, f } = await world(t, (call, n) => {
    if (n === 1) writeJson(call.cwd, 'insights.json', FIRST);
    else writeJson(call.cwd, 'review.json', { summary: 'One duplicate, one case needs a stronger check.', verdicts: [
      { index: 0, action: 'keep', note: 'Clear.' }, { index: 1, action: 'drop', note: 'Same as the first case.' },
      { index: 2, action: 'improve', note: 'Say how rounding is verified.', improved: { title: 'Large totals keep two decimals', steps: [{ action: 'Enter 1234567.891 and save, then reopen', expected: 'Stored total is 1234567.89' }] } }],
    additions: [{ title: 'Whitespace-only customer name is blocked', category: 'validation', priority: 'P1', basis: 'experience', source: 'tester experience', steps: [{ action: 'Type spaces', expected: 'blocked' }] }], missingRisks: ['Duplicate invoice numbers'] });
  }, root);
  const job = await run(b);
  assert.equal(job.status, 'done', job.message);
  assert.equal(fake.calls.length, 2, 'draft run and reviewer run');
  for (const marker of ['MINDSET-MARKER', 'DOMAIN-MARKER', 'LESSON-MARKER']) assert.ok(fake.calls[0].brief.includes(marker), marker);
  assert.match(fake.calls[0].brief, /Decide the RISKS first/);
  assert.match(fake.calls[1].brief, /Reviewer brief/); assert.match(fake.calls[1].prompt, /review\.json/);
  assert.deepEqual(job.knowledge.map(k => k.name), ['mindset.md', 'domain/augastam.md', 'modules/billing.md']);
  assert.deepEqual(job.reviewer.stats, { kept: 1, improved: 1, dropped: 1, added: 1, dropGuard: false });
  assert.match(job.message, /improved 1, dropped 1 and added 1/);

  const cases = (await b.request('/api/modules/billing/cases')).value;
  assert.deepEqual(cases.map(c => c.title).sort(), ['Large totals keep two decimals', 'Total of 0 is rejected', 'Whitespace-only customer name is blocked']);
  const improved = cases.find(c => c.title.startsWith('Large'));
  assert.match(improved.steps[0].expected, /1234567\.89/); assert.match(improved.reviewNote, /Improved by the reviewer/);
  assert.equal(improved.basis, 'experience'); assert.match(improved.notes, /tester experience/);
  assert.equal(cases.find(c => c.title.startsWith('Whitespace')).reviewStatus, 'draft');
  assert.equal(cases.find(c => c.title === 'Total of 0 is rejected').risk, 'Wrong invoice total');
  const insights = (await b.request('/api/modules/billing/insights')).value;
  assert.equal(insights.risks[0].impact, 'high');
  assert.deepEqual(insights.critic.missingRisks, ['Duplicate invoice numbers']);
  assert.equal(insights.critic.dropped[0].title, 'Total of 0 is not accepted');
});

test('the reviewer is optional and can fail without losing the draft', async t => {
  const root = tempRoot(t);
  // reviewer exits with an error and writes nothing
  const a = await world(t, (call, n) => { if (n === 1) writeJson(call.cwd, 'insights.json', FIRST); else call.exit = 1; }, root);
  const failed = await run(a.b);
  assert.equal(failed.status, 'done', failed.message); assert.equal(failed.reviewer.ran, false); assert.match(failed.message, /first draft was kept/);
  assert.equal((await a.b.request('/api/modules/billing/cases')).value.length, 3, 'draft kept in full');
});

test('critic: false runs a single agent pass', async t => {
  const root = tempRoot(t);
  const { fake, b } = await world(t, (call, n) => { if (n === 1) writeJson(call.cwd, 'insights.json', FIRST); }, root);
  const job = await run(b, { critic: false });
  assert.equal(job.status, 'done'); assert.equal(fake.calls.length, 1); assert.equal(job.reviewer, undefined);
});

// ---- the knowledge editor API ------------------------------------------------------------------------------------------
test('API: everyone with module access can read the pack; leads edit lessons; only admins edit the shared notes', async t => {
  const root = tempRoot(t);
  put(root, 'mindset.md', 'Mindset text.');
  const { f, admin, b } = await world(t, () => {}, root);
  let r = await b.request('/api/modules/billing/knowledge');
  assert.equal(r.status, 200); assert.equal(r.value.layers.length, 3); assert.equal(r.value.layers[0].text, 'Mindset text.');
  assert.deepEqual(r.value.used.files.map(x => x.name), ['mindset.md']);
  // a BA cannot edit anything; an admin edits module lessons and shared notes
  assert.equal((await b.request('/api/modules/billing/knowledge', 'PUT', { layer: 'module', text: 'nope' })).status, 403);
  r = await admin.request('/api/modules/billing/knowledge', 'PUT', { layer: 'module', text: 'Rounding bug seen on totals.' });
  assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.ok(r.value.used.files.some(x => x.name === 'modules/billing.md'));
  assert.equal(fs.readFileSync(path.join(root, 'qa', 'knowledge', 'modules', 'billing.md'), 'utf8'), 'Rounding bug seen on totals.');
  assert.equal((await admin.request('/api/modules/billing/knowledge', 'PUT', { layer: 'mindset', text: 'New mindset.' })).status, 200);
  assert.equal((await admin.request('/api/modules/billing/knowledge', 'PUT', { layer: 'bogus', text: 'x' })).status, 400);
  assert.equal((await admin.request('/api/modules/nope/knowledge')).status, 404);
  assert.ok(f);
});
