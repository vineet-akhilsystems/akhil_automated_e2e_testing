import test from 'node:test';
import assert from 'node:assert/strict';
import { saveExternalInsights } from '../insights.mjs';

function stub(setup) {
  let mod = { id: 'billing', name: 'Billing', area: 'Fin', version: 1, ...(setup ? { setup } : {}) };
  const audits = [];
  return {
    audits, get mod() { return mod; },
    store: { intakeFiles: () => [], cases: () => [], module: () => mod, saveModule: m => { mod = { ...m, version: m.version + 1 }; return mod; }, saveInsights: d => ({ ...d, version: 1 }), saveCase: () => {}, transaction: fn => fn(), audit: a => audits.push(a) },
  };
}
const body = { summary: 'Billing', suggestedSetup: { moduleUrl: '/billing', variants: ['Cash', 'Credit'] }, cases: [] };
const run = (s, envs) => saveExternalInsights({ store: s.store, module: s.mod, body, user: { username: 'u' }, mode: 'agent:claude', environments: envs });

test('the AI-identified target setup is applied after analysis and the login profile is picked when the product has exactly one', () => {
  const s = stub();
  const r = run(s, [{ id: 'local' }]);
  assert.deepEqual(r.setupApplied, { moduleUrl: '/billing', variants: ['Cash', 'Credit'], confirmed: true });
  assert.deepEqual([s.mod.setup.loginProfileId, s.mod.setup.auto, s.mod.setup.confirmedBy], ['local', true, 'AI analysis']);
  assert.equal(s.audits[0].detail.auto, true);
});

test('with several login profiles the URL and tabs are filled but a person still picks the profile', () => {
  const s = stub();
  const r = run(s, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(r.setupApplied.confirmed, false);
  assert.equal(s.mod.setup.moduleUrl, '/billing'); assert.equal(s.mod.setup.confirmedAt, undefined); assert.equal(s.mod.setup.loginProfileId, undefined);
});

test('a setup confirmed by a person is never replaced; a later AI setup is updated and keeps its profile', () => {
  const human = { moduleUrl: '/manual', variants: [], loginProfileId: 'b', confirmedBy: 'ann', confirmedAt: '2026-01-01T00:00:00Z' };
  const h = stub(human);
  assert.equal(run(h, [{ id: 'a' }, { id: 'b' }]).setupApplied, undefined);
  assert.deepEqual(h.mod.setup, human);
  const ai = stub({ moduleUrl: '/old', variants: [], loginProfileId: 'b', confirmedBy: 'AI analysis', confirmedAt: '2026-01-01T00:00:00Z', auto: true });
  assert.equal(run(ai, [{ id: 'a' }, { id: 'b' }]).setupApplied.moduleUrl, '/billing');
  assert.equal(ai.mod.setup.loginProfileId, 'b');
  assert.equal(run(ai, [{ id: 'a' }, { id: 'b' }]).setupApplied, undefined); // unchanged: nothing to write
});
