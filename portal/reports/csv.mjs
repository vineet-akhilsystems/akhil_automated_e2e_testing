// Pure CSV helpers. Every free-text field goes through safeCell so spreadsheet apps never evaluate it as a formula.
import { safeReportText } from '../quality.mjs';
const MAX_CELL = 32000;
const PRIORITY = { P0: 'Highest', P1: 'High', P2: 'Medium', P3: 'Low' };
const SEVERITY = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' };

export function safeCell(value) {
  const s = typeof value === 'string' ? safeReportText(value) : value == null ? '' : String(value);
  const out = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (out.length <= MAX_CELL) return out;
  let end = MAX_CELL;
  const last = out.charCodeAt(end - 1);
  if (last >= 0xD800 && last <= 0xDBFF) end--; // never split a surrogate pair
  return out.slice(0, end);
}

export function toCsv(rows) {
  const field = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map(r => r.map(field).join(',')).join('\r\n');
}

const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'general';

/** The captured inputs of a finding as "key: value" lines (values already redacted by the report model). */
export const inputLines = f => (f.input ?? []).map(({ key, value }) => `${key}: ${value}`);

/** Jira import CSV: one row per listed failed assertion or business-rule review that is not quarantined
 * (the same findings as the defect register; execution issues and blocked cases are not bugs to file). */
export function jiraCsv(model, listing) {
  const rows = [['Summary', 'Description', 'Priority', 'Labels', 'Labels', 'Issue Type']];
  for (const f of listing.findings) {
    if (f.quarantined || (f.kind !== 'failure' && f.kind !== 'assumption')) continue;
    const priority = SEVERITY[f.severity] ?? PRIORITY[f.priority] ?? 'Medium';
    const inputs = inputLines(f);
    const description = [
      `Classification: ${f.classification}`, `Requirement: ${f.requirement}`, `Priority: ${f.priority}; Severity: ${f.severity}`,
      'Steps:', ...(f.steps ?? []).map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` (expect: ${s.expected})` : ''}`),
      inputs.length ? 'Inputs:' : 'Inputs: none recorded', ...inputs.map(line => `- ${line}`),
      `Expected: ${f.expected}`, `Actual: ${f.actual}`, ...(f.mismatches?.length ? ['Mismatches:', ...f.mismatches.map(m => `- ${m}`)] : []),
    ].join('\n');
    rows.push([safeCell(`[${f.caseId}] ${f.title}`), safeCell(description), priority, 'test-studio', slug(f.suite), f.kind === 'failure' ? 'Bug' : 'Task']);
  }
  return toCsv(rows);
}
