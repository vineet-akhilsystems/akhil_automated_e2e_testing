import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { check, textValue } from './registry.mjs';

// What a login profile holds per product: field -> env variable the Playwright login setup reads, the setup project to run,
// and the files that prove a saved session. Keep the field list in sync with LOGIN_FIELDS in public/pages/settings.js.
export const LOGIN_SCHEMAS = {
  augastam: { project: 'setup', sessionFiles: ['session.json', 'admin.json'], expiryFile: 'session.json',
    fields: { username: 'AUGASTAM_USER', password: 'AUGASTAM_PASS', tenant: 'AUGASTAM_TENANT', facility: 'AUGASTAM_FACILITY', role: 'AUGASTAM_ROLE' } },
  miracle: { project: 'setup-miracle', sessionFiles: ['miracle.json'], expiryFile: null,
    fields: { username: 'MIRACLE_USER', password: 'MIRACLE_PASS', facility: 'MIRACLE_FACILITY', group: 'MIRACLE_GROUP', entrySite: 'MIRACLE_ENTRY_SITE' } },
};
const FIELD_LABELS = { username: 'username', password: 'password', tenant: 'tenant', facility: 'facility', role: 'application role', group: 'group', entrySite: 'entry site' };
export const loginSchema = productId => LOGIN_SCHEMAS[productId ?? 'augastam'] ?? null;
export const LOGIN_KEYS = LOGIN_SCHEMAS.augastam.fields;

// Secrets stay outside SQLite, run snapshots, exports and public environment DTOs.
export function environmentSettings(directory) {
  const file = path.join(directory, 'environment-settings.json');
  const keyFile = path.join(directory, 'environment-settings.key');
  const key = () => {
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
    return fs.readFileSync(keyFile);
  };
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const decrypt = value => {
    if (!value) return null;
    if (!fs.existsSync(keyFile)) throw new Error('Environment credential key is missing. Restore the matching settings key from the server backup.');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString());
  };
  return {
    list: () => read().map(({ secret, ...e }) => ({ ...e, productId: e.productId ?? 'augastam' })),
    credentials: id => decrypt(read().find(e => e.id === id)?.secret),
    save(body, previous, existingCredentials = null) {
      check(body && typeof body === 'object' && !Array.isArray(body), 'Environment settings are required.');
      const id = textValue(body.id, 'Profile ID', 80, true);
      check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), 'Use lowercase letters, numbers and single dashes for the profile ID.');
      const name = textValue(body.name, 'Profile name', 120, true);
      const productId = textValue(body.productId ?? previous?.productId ?? 'augastam', 'Product', 80, true);
      check(/^[a-z][a-z0-9-]*$/.test(productId), 'Choose a valid product.');
      let url;
      try { url = new URL(textValue(body.url, 'Website URL', 2000, true)); } catch { check(false, 'Enter a valid HTTP or HTTPS website URL.'); }
      check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Use a website origin such as https://demo.augastam.com, without credentials, path, query or fragment.');
      const old = read(), saved = old.find(e => e.id === id);
      check(body.version === (saved?.version ?? 0), 'This profile changed. Reload Settings before saving.', 409);
      const schema = loginSchema(productId);
      check(schema, 'Login automation for this product has not been built yet. Manual testing and intake work now; ask a developer to add the login adapter.', 409);
      const input = body.credentials;
      check(input && typeof input === 'object' && !Array.isArray(input), 'Enter the application login fields.');
      const credentials = Object.fromEntries(Object.keys(schema.fields).map(k => [k, k === 'password' && input[k] === '' && previous && new URL(previous.url).origin === url.origin
        ? this.credentials(id)?.password ?? existingCredentials?.password ?? '' : input[k]]));
      for (const k of Object.keys(schema.fields)) {
        check(typeof credentials[k] === 'string' && credentials[k].trim().length > 0 && credentials[k].length <= 1000, `Enter the ${FIELD_LABELS[k] ?? k}${k === 'password' ? ' (required for a new profile or website)' : ''}.`);
        if (k !== 'password') credentials[k] = credentials[k].trim();
      }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
      const result = { id, name, productId, url: url.origin, version: (saved?.version ?? 0) + 1, secret: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') } };
      const next = [...old.filter(e => e.id !== id), result];
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temp, file);
      return { id, name, productId, url: result.url, version: result.version };
    },
  };
}
