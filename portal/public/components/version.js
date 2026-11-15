// Browser copy of describeVersion in portal/versioning.mjs (the browser cannot import server code). Keep both in sync.
export function describeVersion(run) {
  const parts = [];
  if (run?.appVersion?.label) parts.push(`${run.appVersion.label} (typed)`);
  if (run?.profile?.hash) parts.push(`profile ${String(run.profile.hash).slice(0, 6)} (detected)`);
  if (run?.automationVersion?.number) parts.push(`automation v${run.automationVersion.number}`);
  return parts.length ? parts.join(' · ') : 'version unknown';
}
