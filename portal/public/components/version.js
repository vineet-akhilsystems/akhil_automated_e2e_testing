// Browser copy of describeVersion in portal/versioning.mjs (the browser cannot import server code). Keep both in sync.
export function describeVersion(run) {
  const parts = [];
  if (run?.appVersion?.label) parts.push(`${run.appVersion.label} (typed)`);
  if (run?.profile?.hash) parts.push(`profile ${String(run.profile.hash).slice(0, 6)} (detected)`);
  if (run?.automationVersion?.number) parts.push(`automation v${run.automationVersion.number}`);
  return parts.length ? parts.join(' · ') : 'version unknown';
}

// Pure helpers for the Versions and Tree tabs (no DOM, so they are unit tested from node).
// Matrix column heading parts: typed version, profile (first 6 characters) and automation number. Missing parts read "unknown".
export function columnParts(col) {
  const typed = col?.appVersion?.label ? String(col.appVersion.label) : 'unknown';
  const profile = col?.profile?.hash ? String(col.profile.hash).slice(0, 6) : 'unknown';
  const n = col?.automationVersion?.number;
  return { typed, profile, automation: Number.isInteger(n) ? `v${n}` : 'unknown' };
}
export const passRateText = rate => (typeof rate === 'number' && Number.isFinite(rate) ? `${rate}%` : 'unknown');
export const triggerText = v => (v?.createdBy ? String(v.createdBy) : v?.trigger === 'run' ? 'a run' : v?.trigger === 'manual' ? 'manual' : 'unknown');
// changedFiles compares with the previous number, so the label says so.
export function changedFilesSummary(v) {
  const c = v?.changedFiles;
  if (!c || typeof c !== 'object') return { count: null, label: 'unknown' };
  const count = (c.added?.length ?? 0) + (c.changed?.length ?? 0) + (c.removed?.length ?? 0);
  return { count, label: `${count} file${count === 1 ? '' : 's'} changed since previous number` };
}
// The current version is the one whose hash is the current automation hash, never the highest number (a revert reuses an old number).
export const currentVersion = (list, current) => (current?.hash ? (list ?? []).find(v => v.hash === current.hash) ?? null : null);
// Colour class for a tree node's counts: red when anything failed, amber when blocked, green when every case passed, grey otherwise.
export function nodeTone(counts) {
  const c = counts ?? {};
  if ((c.failed ?? 0) > 0) return 'fail';
  if ((c.blocked ?? 0) > 0) return 'blocked';
  if ((c.total ?? 0) > 0 && c.passed === c.total) return 'pass';
  return 'none';
}
export const cellTone = status => (status === 'PASS' ? 'pass' : status === null || status === undefined ? 'none' : /^(FAIL|ERROR)/.test(status) ? 'fail' : status === 'BLOCKED' ? 'blocked' : 'none');
