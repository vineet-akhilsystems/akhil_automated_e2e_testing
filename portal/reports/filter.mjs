// Pure report-row filtering. Totals are never filtered: callers keep model.counts / totalsByClass as-is.
const CLASSES = ['failed', 'review', 'execution', 'blocked', 'passed', 'observed', 'skipped', 'not-executed', 'flaky', 'quarantined'];
const LIST_KEYS = { classes: 'Result', priorities: 'Priority', suites: 'Suite', requirements: 'Requirement', severities: 'Severity', owners: 'Owner', caseIds: 'Cases' };
const BOOL_KEYS = { assumedOnly: 'Assumed rules only', newFailuresOnly: 'New failures only', missingEvidenceOnly: 'Missing evidence only' };
const MAX_LIST = 200, MAX_TEXT = 200;
const KIND_CLASS = { failure: 'failed', assumption: 'review', execution: 'execution', blocked: 'blocked' };
const STATUS_CLASS = { PASS: 'passed', OBSERVED: 'observed', SKIPPED: 'skipped', 'NOT EXECUTED': 'not-executed' };

export const PRESETS = {
  bugs: { label: 'Bugs', filter: { classes: ['failed', 'review'] } },
  failures: { label: 'All failures', filter: { classes: ['failed', 'review', 'execution', 'blocked'] } },
  'needs-triage': { label: 'Needs triage', filter: { classes: ['failed'], severities: ['Not assessed'] } },
  p0p1: { label: 'P0 and P1', filter: { priorities: ['P0', 'P1'] } },
  everything: { label: 'Everything', filter: {} },
};

const strList = v => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))].slice(0, MAX_LIST) : [];

export function normalizeFilter(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(LIST_KEYS)) {
    let list = strList(raw[k]);
    if (k === 'classes') list = list.filter(x => CLASSES.includes(x));
    if (list.length) out[k] = list;
  }
  if (raw.mode === 'manual' || raw.mode === 'automated') out.mode = raw.mode;
  for (const k of Object.keys(BOOL_KEYS)) if (raw[k] === true) out[k] = true;
  if (typeof raw.text === 'string') { const t = raw.text.trim().slice(0, MAX_TEXT); if (t) out.text = t; }
  return out;
}

function rowClasses(row) {
  const set = new Set();
  const k = KIND_CLASS[row.findingKind];
  if (k) set.add(k);
  const s = STATUS_CLASS[row.rawStatus];
  if (s) set.add(s);
  if (row.flaky) set.add('flaky');
  if (row.quarantined) set.add('quarantined');
  return set;
}

function describe(f) {
  const parts = [];
  for (const [k, label] of Object.entries(LIST_KEYS)) if (f[k]) parts.push(`${label}: ${f[k].join(', ')}`);
  if (f.mode) parts.push(`Mode: ${f.mode}`);
  for (const [k, label] of Object.entries(BOOL_KEYS)) if (f[k]) parts.push(label);
  if (f.text) parts.push(`Search: "${f.text}"`);
  return parts.length ? parts.join('; ') : 'All cases';
}

export function applyFilter(model, filter, ctx = {}) {
  const f = normalizeFilter(filter);
  const rows = model.cases ?? [];
  const active = Object.keys(f).length > 0;
  if (!active) return { cases: rows, findings: model.findings ?? [], shown: rows.length, total: rows.length, active, description: 'All cases' };
  const sets = {};
  for (const k of Object.keys(LIST_KEYS)) if (f[k]) sets[k] = new Set(f[k]);
  const needle = f.text?.toLowerCase();
  const prev = ctx.previousFailedIds;
  const test = row => {
    if (sets.classes) { const rc = rowClasses(row); if (![...sets.classes].some(c => rc.has(c))) return false; }
    if (sets.priorities && !sets.priorities.has(row.priority)) return false;
    if (sets.suites && !sets.suites.has(row.suite)) return false;
    if (sets.requirements && !sets.requirements.has(row.requirement)) return false;
    if (sets.severities && !sets.severities.has(row.severity)) return false;
    if (sets.owners && !sets.owners.has(row.owner)) return false;
    if (sets.caseIds && !sets.caseIds.has(row.id)) return false;
    if (f.mode && row.mode !== f.mode) return false;
    if (f.assumedOnly && !row.assumed) return false;
    if (f.newFailuresOnly && (!row.findingKind || prev?.has(row.id))) return false;
    if (f.missingEvidenceOnly && !(row.executed && !row.screenshotCount)) return false;
    if (needle && ![row.id, row.title, row.requirement].some(v => String(v ?? '').toLowerCase().includes(needle))) return false;
    return true;
  };
  const cases = rows.filter(test);
  const kept = new Set(cases.map(r => r.id));
  const findings = (model.findings ?? []).filter(x => kept.has(x.caseId));
  return { cases, findings, shown: cases.length, total: rows.length, active, description: describe(f) };
}
