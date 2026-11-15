import { createHash } from 'node:crypto';

// One source of truth for the configuration fingerprint. Imported by the Playwright fixture (tests/fixtures/profile.ts)
// and re-exported by portal/profile.mjs, so both sides always hash the same way. Pure: no I/O.
export const VOLATILE_KEYS = ['createdAt', 'updatedAt', 'modifiedAt', 'lastModified', 'timestamp', 'requestId', 'traceId', 'etag', 'token'];
const volatile = new Set(VOLATILE_KEYS.map(k => k.toLowerCase()));

export const PROFILE_URL = /configuration-service\/(workflow\/get-workflow|webpart\/latest-version|form-schema\/latest-version|reference-lookup\/latest-version)/;
const PART_BY_PATH = { 'workflow/get-workflow': 'workflow', 'webpart/latest-version': 'webpart', 'form-schema/latest-version': 'formSchema', 'reference-lookup/latest-version': 'lookups' };

export function partForUrl(url) {
  const m = PROFILE_URL.exec(String(url));
  return m ? PART_BY_PATH[m[1]] : undefined;
}

// Recursively drops volatile keys and sorts object keys. Array order is kept (it is meaningful in a form).
export function normalizeConfig(value) {
  if (Array.isArray(value)) return value.map(normalizeConfig);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) if (!volatile.has(key.toLowerCase())) out[key] = normalizeConfig(value[key]);
    return out;
  }
  return value;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');

// Key for one captured response: part plus path plus sorted, non-volatile query, so arrival order never matters.
export function responseKey(url) {
  const u = new URL(url);
  const query = [...u.searchParams.entries()].filter(([k]) => !volatile.has(k.toLowerCase())).map(([k, v]) => `${k}=${v}`).sort().join('&');
  return `${partForUrl(url)}:${u.pathname}${query ? '?' + query : ''}`;
}

// Overall hash from per-part hashes: sha256 over the sorted "name:partHash" lines.
export function combineHashes(parts) {
  return sha256(Object.keys(parts).sort().map(name => `${name}:${parts[name]}`).join('\n'));
}

export function profileFingerprint(parts) {
  const hashes = {};
  for (const name of Object.keys(parts ?? {}).sort()) hashes[name] = sha256(JSON.stringify(normalizeConfig(parts[name])));
  return { hash: combineHashes(hashes), parts: hashes };
}
