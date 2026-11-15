// Output hygiene for MCP tool results: never pass on a login profile's keys or any query text, and cap long lists.
export function stripSecrets(v, parent = '') {
  if (Array.isArray(v)) return v.map(x => stripSecrets(x, parent));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'query' || (k === 'keys' && parent === 'profile')) continue;
    out[k] = stripSecrets(x, k);
  }
  return out;
}

/** Cuts `obj[field]` (an array) to `max` entries; adds `truncated` and `<field>Total` only when something was cut. */
export function capField(obj, field, max) {
  if (!obj || !Array.isArray(obj[field]) || obj[field].length <= max) return obj;
  return { ...obj, [field]: obj[field].slice(0, max), truncated: true, [`${field}Total`]: obj[field].length };
}
