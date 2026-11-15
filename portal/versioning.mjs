import { HttpError } from './registry.mjs';

// The version a person types for the application under test. Free text, but only plain characters, so it is safe to store and show.
export function normalizeAppVersion(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'Application version must be text, for example 1.58.');
  const label = value.trim();
  if (label.length > 40) throw new HttpError(400, 'Application version must be 40 characters or fewer.');
  if (!/^[A-Za-z0-9 ._+/-]*$/.test(label)) throw new HttpError(400, 'Application version can use English letters, digits, spaces and . _ + / - only.');
  return label;
}

// One line telling a reader which version a run covered. Keep in sync with public/components/version.js (the browser copy).
export function describeVersion(run) {
  const parts = [];
  if (run?.appVersion?.label) parts.push(`${run.appVersion.label} (typed)`);
  if (run?.profile?.hash) parts.push(`profile ${String(run.profile.hash).slice(0, 6)} (detected)`);
  if (run?.automationVersion?.number) parts.push(`automation v${run.automationVersion.number}`);
  return parts.length ? parts.join(' · ') : 'version unknown';
}
