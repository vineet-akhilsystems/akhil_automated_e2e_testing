import { check } from './registry.mjs';
import { pluginFor } from './modules/index.mjs';

// Module readiness checklist (docs/superpowers/specs/2026-11-09-module-knowledge-pipeline-design.md sections 1-2).
// readiness() is a pure function: the server gathers live state and passes it in; nothing is cached.

export const NO_LOGIN_AUTOMATION = 'Application login automation for this product has not been built yet';
export const STAGE_LABELS = { sources: 'Sources', insights: 'Insights', cases: 'Reviewed cases', setup: 'Target setup', discovery: 'Discovery', automation: 'Automation package', smoke: 'Smoke run' };

const isUsable = f => f.extract === 'ok' || f.extract === 'partial' || f.kind === 'image';
const isApproved = c => (c.reviewStatus ?? 'approved') === 'approved' && c.enabled !== false;
const names = list => { const n = list.slice(0, 3).map(f => f.name).join(', '); return list.length > 3 ? `${n} and ${list.length - 3} more` : n; };

// Ids of the sources an insights document covers (legacy documents only have `sources`).
export const coveredIds = insights => new Set((insights?.coveredSources ?? insights?.sources ?? []).map(s => s.fileId));
// Usable current sources the latest insights do not cover (added after the analysis).
export const uncoveredSources = (sources, insights) => { const covered = coveredIds(insights); return sources.filter(f => isUsable(f) && !covered.has(f.id)); };

// 'new' | 'changed' | 'unchanged' for one source against the previous insights' coveredSources (by SHA-256, then by file id).
export function classifySource(file, insights) {
  if (!insights) return 'new';
  const covered = insights.coveredSources ?? (insights.sources ?? []).map(s => ({ fileId: s.fileId, name: s.name }));
  if (covered.some(c => (c.sha256 && file.sha256 && c.sha256 === file.sha256) || c.fileId === file.id)) return 'unchanged';
  if (covered.some(c => c.name === file.name)) return 'changed';
  return 'new';
}

// ---- Target setup validation ----
export function cleanModuleUrl(value) {
  check(typeof value === 'string', 'Module URL must be a path such as /registration.');
  const s = value.trim();
  check(s.length > 0 && s.length <= 200, 'Module URL must be 1-200 characters.');
  check(s.startsWith('/') && !s.startsWith('//'), 'Module URL must be a path starting with a single "/" (for example /registration), not a full address.');
  check(!/[\u0000-\u001f\u007f]/.test(s) && !s.includes('\\'), 'Module URL cannot contain backslashes or control characters.');
  check(!/\s/.test(s), 'Module URL cannot contain spaces.');
  check(!/:\/\//.test(s) && !s.includes('..') && !/%(2e|5c|00|0a|0d)/i.test(s), 'Module URL must be a plain path: no host, no "..", no encoded dots or backslashes.');
  return s;
}
export function cleanVariants(value) {
  check(Array.isArray(value), 'Variants must be a list of short labels.');
  check(value.length <= 20, 'Use at most 20 variants.');
  const out = [];
  for (const v of value) {
    check(typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(v), 'Each variant must be a short label (1-60 characters).');
    if (!out.some(x => x.toLowerCase() === v.trim().toLowerCase())) out.push(v.trim());
  }
  return out;
}

export function readiness({ module, product, sources = [], insights = null, cases = [], setup = null, discoveryExists = false, discoveryStale = false, adapterConnected = false, specExists = false, smokePassed = false, jobs = [] }) {
  const reference = typeof module?.id === 'string' && pluginFor(module.id)?.builtIn === true; // the built-in reference module is never locked out
  const productId = product?.id ?? module?.productId ?? 'augastam';
  const loginBuilt = productId === 'augastam';
  const sortedJobs = [...jobs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const running = kind => sortedJobs.find(j => j.kind === kind && j.status === 'running');
  const lastJob = kind => sortedJobs.find(j => j.kind === kind);
  const stage = (id, status, detail, action) => ({ id, label: STAGE_LABELS[id], status, detail, ...(action ? { action } : {}) });

  // 1. Sources
  const usable = sources.filter(isUsable), pending = sources.filter(f => f.extract === 'pending');
  let s1;
  if (!sources.length) s1 = reference ? stage('sources', 'ready', 'Reference module (built in). Uploads are optional.') : stage('sources', 'missing', 'Upload at least one document, spreadsheet, PDF, screenshot or walkthrough video.', { id: 'upload', label: 'Upload files' });
  else if (usable.length) s1 = stage('sources', 'ready', `${usable.length} usable source(s)${pending.length ? `, ${pending.length} still being processed` : ''}.`);
  else if (pending.length) s1 = stage('sources', 'running', `${pending.length} file(s) are being processed.`);
  else s1 = stage('sources', 'failed', `None of the uploaded files could be read (${names(sources)}). Upload a document, spreadsheet, PDF or screenshots, or add a transcript.`, { id: 'upload', label: 'Upload files' });

  // 2. Insights
  const hasInsights = Boolean(insights), stale = hasInsights ? uncoveredSources(sources, insights) : [];
  let s2;
  if (running('analyze')) s2 = stage('insights', 'running', 'An analysis is running.');
  else if (!hasInsights) {
    const last = lastJob('analyze');
    if (reference && !sources.length) s2 = stage('insights', 'ready', 'Reference module (built in).');
    else if (last && ['error', 'interrupted'].includes(last.status)) s2 = stage('insights', 'failed', last.message || 'The last analysis did not finish.', s1.status === 'ready' ? { id: 'analyse', label: 'Analyse sources' } : undefined);
    else s2 = stage('insights', 'missing', s1.status === 'ready' ? 'No analysis yet. Analyse the sources to extract fields, rules and draft cases.' : 'Needs a usable source first.', s1.status === 'ready' ? { id: 'analyse', label: 'Analyse sources' } : undefined);
  } else if (stale.length) s2 = stage('insights', 'stale', `Version ${insights.version ?? 1} does not cover ${stale.length} newer source(s): ${names(stale)}.`, { id: 'update-insights', label: 'Update insights' });
  else s2 = stage('insights', 'ready', `Version ${insights.version ?? 1} covers all current sources.`);

  // 3. Reviewed cases
  const approved = cases.filter(isApproved).length, drafts = cases.filter(c => c.reviewStatus === 'draft').length;
  const s3 = approved ? stage('cases', 'ready', `${approved} approved case(s).`)
    : stage('cases', 'missing', drafts ? `${drafts} draft case(s) are waiting for review. Approve at least one.` : 'No approved case yet. Write one or analyse the sources, then approve a draft.', { id: 'review', label: 'Review cases' });

  // 4. Target setup
  const setupDone = Boolean(setup?.moduleUrl && setup?.loginProfileId && setup?.confirmedAt);
  let s4;
  if (setupDone) s4 = stage('setup', 'ready', `${setup.moduleUrl}${setup.variants?.length ? `, ${setup.variants.length} variant(s)` : ''}, confirmed by ${setup.confirmedBy ?? 'a lead'}.`);
  else if (reference) s4 = stage('setup', 'ready', 'Reference module (built in).');
  else {
    const hint = insights?.suggestedSetup?.moduleUrl ? ` The analysis suggests ${insights.suggestedSetup.moduleUrl}; a lead must confirm it.` : '';
    s4 = stage('setup', 'missing', `The module URL, variants and login profile are not confirmed.${hint}`, { id: 'confirm-setup', label: 'Confirm target setup' });
  }

  // 5. Discovery
  let s5;
  if (reference) s5 = stage('discovery', 'ready', discoveryExists ? 'Discovery files are present.' : 'Built in.');
  else if (!loginBuilt) s5 = stage('discovery', 'blocked', NO_LOGIN_AUTOMATION);
  else if (discoveryExists) s5 = stage('discovery', 'ready', 'Discovery output is newer than the target setup.');
  else if (discoveryStale) s5 = stage('discovery', 'stale', 'The target setup was confirmed after the last discovery. Run discovery again.');
  else if (s4.status !== 'ready') s5 = stage('discovery', 'missing', 'Confirm the target setup first; discovery scans the page it names.');
  else s5 = stage('discovery', 'missing', 'Discovery has not been run. It must write qa/modules/<module>/discovery/fields-default.json.');

  const insightsOk = hasInsights || (reference && s2.status === 'ready');
  const canGenerateAi0 = s1.status === 'ready' && insightsOk;
  const canProposeAutomation = s1.status === 'ready' && insightsOk && s3.status === 'ready' && s4.status === 'ready' && s5.status === 'ready';

  // 6. Automation package
  let s6;
  if (!loginBuilt) s6 = stage('automation', 'blocked', NO_LOGIN_AUTOMATION);
  else if (adapterConnected && specExists) s6 = stage('automation', 'ready', 'An automation adapter is connected and its spec file exists.');
  else if (adapterConnected) s6 = stage('automation', 'failed', 'An adapter is set but its spec file is missing. Ask a developer to check the installation.');
  else if (running('automation')) s6 = stage('automation', 'running', 'An automation proposal is being written.');
  else if (sortedJobs.some(j => j.kind === 'automation' && j.status === 'done')) s6 = stage('automation', 'missing', 'A proposal exists. A developer must review and install it, then restart the portal.');
  else s6 = stage('automation', 'missing', 'No automation package yet.', canProposeAutomation ? { id: 'propose-automation', label: 'Generate automation proposal' } : undefined);

  // 7. Smoke run
  let s7;
  if (!loginBuilt) s7 = stage('smoke', 'blocked', NO_LOGIN_AUTOMATION);
  else if (smokePassed) s7 = stage('smoke', 'ready', 'An automated case has passed on a login profile of this product.');
  else if (reference) s7 = stage('smoke', 'ready', 'Reference module (built in).');
  else if (s6.status !== 'ready') s7 = stage('smoke', 'missing', 'Needs the automation package first.');
  else s7 = stage('smoke', 'missing', 'Run one approved automated case on a login profile of this product.', { id: 'run-smoke', label: 'Run a smoke test' });

  const stages = [s1, s2, s3, s4, s5, s6, s7];
  const by = Object.fromEntries(stages.map(s => [s.id, s]));
  const canGenerateAi = canGenerateAi0 && s6.status === 'ready';
  const why = ids => ids.filter(id => !(id === 'insights' ? insightsOk : by[id].status === 'ready')).map(id => `${by[id].label}: ${by[id].detail}`);
  const warnings = stale.length ? [`Insights are older than ${stale.length} uploaded source(s) (${names(stale)}). Update them for the best results.`] : [];
  return { stages, canGenerateAi, canProposeAutomation, blockers: why(['sources', 'insights', 'automation']), proposalBlockers: why(['sources', 'insights', 'cases', 'setup', 'discovery']), warnings };
}
