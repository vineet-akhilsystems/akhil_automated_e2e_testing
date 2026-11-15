import { describeVersion } from './versioning.mjs';

// Version matrix: one column per distinct (typed label, profile hash, automation number) among finished automated runs of ONE module;
// each cell is the case's result in the latest run of that combination. Linear in the total number of results.
const FINISHED = new Set(['passed', 'failed', 'error', 'blocked']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const timeOf = r => r.finishedAt ?? r.createdAt ?? '';

export function columnKey(run) {
  const label = run.appVersion?.label ?? '', hash = run.profile?.hash ?? '', number = run.automationVersion?.number ?? null;
  if (!label && !hash && number === null) return 'unknown';
  return `${label || 'unknown'}|${hash ? String(hash).slice(0, 12) : 'unknown'}|${number ?? 'unknown'}`;
}

export function buildMatrix(runs, { maxColumns = 8, onlyDifferences = false } = {}) {
  const groups = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.kind !== 'tests' || run.mode !== 'automated' || !FINISHED.has(run.status)) continue;
    const key = columnKey(run), at = timeOf(run), g = groups.get(key);
    if (!g) groups.set(key, { key, run, at });
    else if (at > g.at || (at === g.at && String(run.id) > String(g.run.id))) { g.run = run; g.at = at; }
  }
  const picked = [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, Math.max(1, maxColumns));
  const columns = picked.map(g => ({ key: g.key, label: describeVersion(g.run), appVersion: g.run.appVersion ?? null, profile: g.run.profile ? { hash: g.run.profile.hash } : null,
    automationVersion: g.run.automationVersion ?? null, runId: g.run.id, at: g.at }));
  const rows = new Map();
  picked.forEach((g, ci) => {
    const status = new Map();
    for (const r of g.run.results ?? []) if (r && r.id !== undefined) status.set(r.id, r.status);
    const seen = new Set();
    for (const c of g.run.cases ?? []) {
      if (!c || c.id === undefined || seen.has(c.id)) continue;
      seen.add(c.id);
      let row = rows.get(c.id);
      if (!row) { row = { caseId: c.id, title: c.title ?? '', cells: Object.fromEntries(columns.map(x => [x.key, null])), titleFrom: ci }; rows.set(c.id, row); }
      row.cells[columns[ci].key] = status.get(c.id) ?? null;
    }
    for (const id of status.keys()) {
      if (seen.has(id)) continue;
      let row = rows.get(id);
      if (!row) { row = { caseId: id, title: '', cells: Object.fromEntries(columns.map(x => [x.key, null])), titleFrom: ci }; rows.set(id, row); }
      row.cells[columns[ci].key] = status.get(id);
    }
  });
  let out = [...rows.values()].sort((a, b) => collator.compare(String(a.caseId), String(b.caseId))).map(({ titleFrom, ...row }) => ({ ...row, differs: new Set(Object.values(row.cells).filter(v => v !== null)).size > 1 }));
  if (onlyDifferences) out = out.filter(r => r.differs);
  return { columns, rows: out };
}
