// Pure CSV helpers. Every free-text field goes through safeCell so spreadsheet apps never evaluate it as a formula.
const MAX_CELL = 32000;
const PRIORITY = { P0: 'Highest', P1: 'High', P2: 'Medium', P3: 'Low' };
const SEVERITY = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' };

export function safeCell(value) {
  const s = value == null ? '' : String(value);
  return (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).slice(0, MAX_CELL);
}

export function toCsv(rows) {
  const field = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map(r => r.map(field).join(',')).join('\r\n');
}

const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'general';

/** Jira import CSV: one row per listed finding that is not quarantined. */
export function jiraCsv(model, listing) {
  const rows = [['Summary', 'Description', 'Priority', 'Labels', 'Labels', 'Issue Type']];
  for (const f of listing.findings) {
    if (f.quarantined) continue;
    const priority = SEVERITY[f.severity] ?? PRIORITY[f.priority] ?? 'Medium';
    const description = [
      `Classification: ${f.classification}`, `Requirement: ${f.requirement}`, `Priority: ${f.priority}; Severity: ${f.severity}`,
      'Steps:', ...(f.steps ?? []).map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` (expect: ${s.expected})` : ''}`),
      `Expected: ${f.expected}`, `Actual: ${f.actual}`, ...(f.mismatches?.length ? ['Mismatches:', ...f.mismatches.map(m => `- ${m}`)] : []),
    ].join('\n');
    rows.push([safeCell(`[${f.caseId}] ${f.title}`), safeCell(description), priority, 'test-studio', slug(f.suite), f.kind === 'failure' ? 'Bug' : 'Task']);
  }
  return toCsv(rows);
}
