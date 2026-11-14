// Pure request building for the report pack dialog. No DOM and no imports, so node:test can load it.
export const PACK_REPORTS = [
  ['summary', 'Release summary', 'One page with the suggested verdict, key numbers and top findings. A person makes the final call.'],
  ['bugs', 'Bug report', 'The findings as a sheet and a PDF, with evidence for each.'],
  ['log', 'Execution log', 'Every case in the run with its result, in one sheet.'],
];
export const PACK_EVIDENCE = [
  ['none', 'None'],
  ['findings', 'Findings only (default)'],
  ['final', "Findings plus each case's final screenshot"],
  ['all', 'Everything'],
];
export const PACK_CLASSES = [
  ['failed', 'Failed'], ['review', 'Needs rule review'], ['execution', 'Execution error'], ['blocked', 'Blocked'], ['passed', 'Passed'],
  ['observed', 'Observed'], ['skipped', 'Skipped'], ['not-executed', 'Not executed'], ['flaky', 'Flaky'], ['quarantined', 'Quarantined'],
];
export const PACK_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

export const PACK_PRESETS = {
  developers: { label: 'For developers', hint: 'Bugs only, with evidence for each finding.', reports: ['bugs'], filter: { classes: ['failed', 'review'] }, evidence: 'findings' },
  release: { label: 'For the release decision', hint: 'A one-page summary with a suggested verdict.', reports: ['summary'], filter: {}, evidence: 'none' },
  testlead: { label: 'For the test lead', hint: 'Every case in a sheet.', reports: ['log'], filter: {}, evidence: 'none' },
  default: { label: 'Standard pack', hint: 'Summary, bug report and execution log together.', reports: ['summary', 'bugs', 'log'], filter: {}, evidence: 'findings' },
  custom: { label: 'Custom', hint: 'Choose reports, filters and evidence yourself.', reports: [], filter: {}, evidence: 'findings' },
};

const LIST_KEYS = ['classes', 'priorities', 'suites', 'requirements', 'severities', 'owners', 'caseIds'];
// Text boxes take comma or newline separated values; checkbox groups already give arrays.
const toList = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/)).map(x => String(x).trim()).filter(Boolean);

/** formState: { preset, reports?, filter?, evidence? }. Returns the API body { reports, filter, evidence }. */
export function buildPackRequest(formState = {}) {
  const source = formState.preset !== 'custom' && PACK_PRESETS[formState.preset] ? PACK_PRESETS[formState.preset] : formState;
  const known = PACK_REPORTS.map(r => r[0]);
  const reports = known.filter(k => (source.reports ?? []).includes(k));
  if (!reports.length) throw new Error('Choose at least one report.');
  const raw = source.filter ?? {}, filter = {};
  for (const k of LIST_KEYS) { const list = [...new Set(toList(raw[k]))]; if (list.length) filter[k] = list; }
  if (raw.mode === 'manual' || raw.mode === 'automated') filter.mode = raw.mode;
  const text = String(raw.text ?? '').trim();
  if (text) filter.text = text;
  return { reports, filter, evidence: source.evidence ?? 'findings' };
}
