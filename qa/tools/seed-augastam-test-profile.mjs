// Creates the Augastam "Test" login profile (test.augastam.com) in the portal's encrypted settings store (.portal/).
// The password is never kept in the repo: pass it for this one run, e.g.
//   AUGASTAM_SEED_PASS='...' node qa/tools/seed-augastam-test-profile.mjs        (add --force to overwrite)
// Then restart the portal (it reads profiles at startup) and press "Refresh application login".
import path from 'node:path';
import { ROOT } from '../../portal/registry.mjs';
import { environmentSettings } from '../../portal/environment-settings.mjs';

const dataDir = path.resolve(process.env.PORTAL_DATA_DIR || path.join(ROOT, '.portal'));
const settings = environmentSettings(dataDir);
const existing = settings.list().find(e => e.id === 'augastam-test');
if (existing && !process.argv.includes('--force')) { console.log('Profile "augastam-test" already exists. Use --force to overwrite.'); process.exit(0); }
const password = process.env.AUGASTAM_SEED_PASS;
if (!password) { console.error('Set AUGASTAM_SEED_PASS for this run.'); process.exit(1); }

const saved = settings.save({
  id: 'augastam-test', name: 'Augastam Test', productId: 'augastam', url: 'https://test.augastam.com', version: existing?.version ?? 0,
  credentials: { username: 'pooja.joshi@akhilsystems.com', password, tenant: 'AKHIL-TEST', facility: 'Akhil Demo2 Delhi', role: 'Admin' },
});
console.log(`Saved profile "${saved.id}" (${saved.productId}, v${saved.version}) in ${dataDir}. Restart the portal to load it.`);
