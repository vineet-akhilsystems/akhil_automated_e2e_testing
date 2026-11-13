// Creates the default Miracle UAT login profile in the portal's encrypted settings store (.portal/).
// The password is never kept in the repo: pass it for this one run, e.g.
//   MIRACLE_SEED_PASS='...' node qa/tools/seed-miracle-profile.mjs        (add --force to overwrite)
// Then restart the portal (it reads profiles at startup) and press "Refresh application login".
import path from 'node:path';
import { ROOT } from '../../portal/registry.mjs';
import { environmentSettings } from '../../portal/environment-settings.mjs';

const dataDir = path.resolve(process.env.PORTAL_DATA_DIR || path.join(ROOT, '.portal'));
const settings = environmentSettings(dataDir);
const existing = settings.list().find(e => e.id === 'miracle-uat');
if (existing && !process.argv.includes('--force')) { console.log('Profile "miracle-uat" already exists. Use --force to overwrite.'); process.exit(0); }
const password = process.env.MIRACLE_SEED_PASS;
if (!password) { console.error('Set MIRACLE_SEED_PASS for this run.'); process.exit(1); }

const saved = settings.save({
  id: 'miracle-uat', name: 'Miracle UAT', productId: 'miracle', url: 'https://uatbilling.miracleoncloud.com', version: existing?.version ?? 0,
  credentials: { username: 'Admin', password, facility: 'Akhil System Pvt.Ltd', group: 'ADMINISTRATION', entrySite: 'Cardiology' },
});
console.log(`Saved profile "${saved.id}" (${saved.productId}, v${saved.version}) in ${dataDir}. Restart the portal to load it.`);
