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

const LIST_KEYS = ['classes', 'priorities', 'suites', 'requirements', 'severities', 'owners', 'variants', 'caseIds'];
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

/** An estimate response only applies if the form still produces the request it was asked for. */
export const estimateIsCurrent = (sent, now) => Boolean(sent && now) && JSON.stringify(sent) === JSON.stringify(now);

const seconds = s => s < 60 ? `about ${Math.max(1, Math.round(s))} second${Math.round(s) === 1 ? '' : 's'}` : `about ${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? '' : 's'}`;
const bytesText = n => n < 1024 ? 'under 1 KB' : n < 1048576 ? `about ${Math.round(n / 1024)} KB` : `about ${n >= 104857600 ? Math.round(n / 1048576) : (n / 1048576).toFixed(1).replace(/.0$/, '')} MB`;
/** "37 of 1,000 cases, 61 screenshots, about 14 MB, about 40 seconds". Without a known run total, just the count. */
export function describeEstimate(e, total) {
  const known = Number.isFinite(total) && total > 0;
  return `${e.cases.toLocaleString('en-US')}${known ? ` of ${total.toLocaleString('en-US')}` : ''} case${known || e.cases !== 1 ? 's' : ''}, ${e.screenshots.toLocaleString('en-US')} screenshot${e.screenshots === 1 ? '' : 's'}, ${bytesText(e.bytes)}, ${seconds(e.seconds)}`;
}
