import fs from 'node:fs';
import path from 'node:path';
import { ROOT, check } from '../registry.mjs';
import { environmentSettings } from '../environment-settings.mjs';

export function loadConfig(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? process.env.PORTAL_DATA_DIR ?? path.join(ROOT, '.portal'));
  const host = options.host ?? process.env.PORTAL_HOST ?? '127.0.0.1';
  const token = options.token ?? process.env.PORTAL_ACCESS_TOKEN ?? process.env.PORTAL_TOKEN ?? '';
  const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(host);
  fs.mkdirSync(dataDir, { recursive: true });
  const environments = structuredClone(options.environments ?? JSON.parse(process.env.PORTAL_ENVIRONMENTS ?? JSON.stringify([
    { id: 'demo', name: 'Demo', url: process.env.BASE_URL ?? 'https://demo.augastam.com', authDir: path.join(ROOT, '.auth') },
  ])));
  const settings = environmentSettings(dataDir);
  for (const saved of settings.list()) {
    const index = environments.findIndex(e => e.id === saved.id);
    const value = { ...saved, authDir: path.join(dataDir, 'auth', saved.id, `v${saved.version}`), managed: true };
    if (index < 0) environments.push(value); else environments[index] = value;
  }
  check(environments.length > 0, 'Configure at least one environment.');
  const envIds = new Set();
  for (const e of environments) {
    check(/^[a-z0-9-]+$/.test(e.id) && !envIds.has(e.id), 'Environment IDs must be unique lowercase slugs.');
    check(['http:', 'https:'].includes(new URL(e.url).protocol), 'Environment URL must use HTTP or HTTPS.');
    e.productId ??= 'augastam';
    e.authDir = path.resolve(e.authDir ?? path.join(dataDir, 'auth', e.id)); envIds.add(e.id);
  }
  return { dataDir, host, token, isLocalHost, environments, settings };
}
