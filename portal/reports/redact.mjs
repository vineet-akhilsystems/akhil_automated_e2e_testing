import { safeReportText, secretKey } from '../quality.mjs';

/** Deep copy of a run with every string redacted and every secret-keyed value masked. The input is never mutated. */
export function redactRun(run) {
  const walk = value => {
    if (typeof value === 'string') return safeReportText(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretKey.test(k) ? '[REDACTED]' : walk(v)]));
    return value;
  };
  return walk(run);
}
