// Shared portal data <-> git.
//   node qa/tools/portal-snapshot.mjs export          write portal-data/snapshot.json from .portal/portal.sqlite
//   node qa/tools/portal-snapshot.mjs import --force  replace the local shared data with the snapshot (stop the portal first)
// A brand-new portal database loads the snapshot automatically on first start; this is for later syncs.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from '../../portal/registry.mjs';
import { writeSnapshotFile, importSnapshot } from '../../portal/snapshot.mjs';

const dataDir = path.resolve(process.env.PORTAL_DATA_DIR || path.join(ROOT, '.portal'));
const file = path.join(ROOT, 'portal-data', 'snapshot.json');
const [command] = process.argv.slice(2);
const dbFile = path.join(dataDir, 'portal.sqlite');
if (!fs.existsSync(dbFile)) { console.error(`No portal database at ${dbFile}. Start the portal once first.`); process.exit(1); }

if (command === 'export') {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  writeSnapshotFile(db, file); db.close();
  console.log(`Wrote ${path.relative(ROOT, file)}. Review it, then commit it.`);
} else if (command === 'import') {
  if (!process.argv.includes('--force')) { console.error('This replaces users, modules, cases and teams in the local database. Stop the portal, then add --force.'); process.exit(1); }
  const db = new DatabaseSync(dbFile);
  importSnapshot(db, JSON.parse(fs.readFileSync(file, 'utf8'))); db.close();
  console.log('Imported the snapshot. Start the portal.');
} else { console.error('Usage: node qa/tools/portal-snapshot.mjs export | import --force'); process.exit(1); }
