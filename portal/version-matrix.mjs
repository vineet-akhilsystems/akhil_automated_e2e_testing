import { describeVersion } from './versioning.mjs';

// Version matrix: one column per distinct (typed label, profile hash, automation number) among finished automated runs of ONE module;
// each cell is the case's newest result across the runs of that combination (runs without results are ignored). Linear in the total number of results.
const FINISHED = new Set(['passed', 'failed', 'error', 'blocked']);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const timeOf = r => r.finishedAt ?? r.createdAt ?? '';

export function columnKey(run) {
  const label = run.appVersion?.label ?? '', hash = run.profile?.hash ?? '', number = run.automationVersion?.number ?? null;
  if (!label && !hash && number === null) return 'unknown';
  return `${label || 'unknown'}|${hash ? String(hash).slice(0, 12) : 'unknown'}|${number ?? 'unknown'}`;
}

const newer = (a, b) => (timeOf(a) < timeOf(b) ? 1 : timeOf(a) > timeOf(b) ? -1 : String(b.id).localeCompare(String(a.id)));

export function buildMatrix(runs, { maxColumns = 8, onlyDifferences = false } = {}) {
  // A run with no results (cancelled early, errored before any case ran) says nothing about any case, so it never forms or fills a column.
  const groups = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.kind !== 'tests' || run.mode !== 'automated' || !FINISHED.has(run.status) || !Array.isArray(run.results) || !run.results.some(r => r && r.id !== undefined)) continue;
    const key = columnKey(run), g = groups.get(key);
    if (g) g.runs.push(run); else groups.set(key, { key, runs: [run] });
  }
  // Newest run first inside a column; a column is as recent as its newest run.
  for (const g of groups.values()) { g.runs.sort(newer); g.run = g.runs[0]; g.at = timeOf(g.run); }
  const picked = [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, Math.max(1, maxColumns));
  const columns = picked.map(g => ({ key: g.key, label: describeVersion(g.run), appVersion: g.run.appVersion ?? null, profile: g.run.profile ? { hash: g.run.profile.hash } : null,
    automationVersion: g.run.automationVersion ?? null, runId: g.run.id, at: g.at }));
  const rows = new Map();
  const rowFor = (id, title, ci) => {
    let row = rows.get(id);
    if (!row) { row = { caseId: id, title: title ?? '', cells: Object.fromEntries(columns.map(x => [x.key, null])), titleFrom: ci }; rows.set(id, row); }
    return row;
  };
  picked.forEach((g, ci) => {
    // Per case, the newest result across the runs of this column wins (a partial re-run only replaces the cases it ran).
    const status = new Map();
    for (const run of g.runs) for (const r of run.results) if (r && r.id !== undefined && !status.has(r.id)) status.set(r.id, r.status);
    const seen = new Set();
    for (const run of g.runs) for (const c of run.cases ?? []) {
      if (!c || c.id === undefined || seen.has(c.id)) continue;
      seen.add(c.id);
      rowFor(c.id, c.title, ci).cells[columns[ci].key] = status.get(c.id) ?? null;
    }
    for (const [id, st] of status) if (!seen.has(id)) rowFor(id, '', ci).cells[columns[ci].key] = st;
  });
  let out = [...rows.values()].sort((a, b) => collator.compare(String(a.caseId), String(b.caseId))).map(({ titleFrom, ...row }) => ({ ...row, differs: new Set(Object.values(row.cells).filter(v => v !== null)).size > 1 }));
  if (onlyDifferences) out = out.filter(r => r.differs);
  return { columns, rows: out };
}
