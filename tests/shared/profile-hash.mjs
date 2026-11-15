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

// Cache-buster query parameters change on every request without the configuration changing.
const BUSTER_PARAMS = ['_', 't', 'ts', 'v', 'cb', 'nocache', 'timestamp'];
const ignoredParam = k => volatile.has(k.toLowerCase()) || BUSTER_PARAMS.includes(k.toLowerCase());

// Key for one captured response: path plus sorted, non-volatile query, so arrival order never matters.
// If the same key is seen twice in one test the last response wins (the page re-fetched it).
export function responseKey(url) {
  const u = new URL(url);
  const query = [...u.searchParams.entries()].filter(([k]) => !ignoredParam(k)).map(([k, v]) => `${k}=${v}`).sort().join('&');
  return `${u.pathname}${query ? '?' + query : ''}`;
}

// "<part>|<path?query>": the identity of one captured configuration response.
export function entryKey(url) {
  return `${partForUrl(url)}|${responseKey(url)}`;
}

// sha256 of one response body after normalization. Only this hash ever leaves the browser process.
export function hashBody(body) {
  return sha256(JSON.stringify(normalizeConfig(body)));
}

// Per part: sha256 over the sorted "key:sha" lines of that part's keys.
export function partsFromKeys(keys) {
  const lines = {};
  for (const key of Object.keys(keys ?? {})) (lines[key.split('|')[0]] ??= []).push(`${key}:${keys[key]}`);
  const parts = {};
  for (const name of Object.keys(lines).sort()) parts[name] = sha256(lines[name].sort().join('\n'));
  return parts;
}

export function profileFromKeys(keys) {
  const parts = partsFromKeys(keys);
  return { hash: combineHashes(parts), parts };
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
