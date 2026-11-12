// Appends the portal's new settings (DEMO values) to .env without touching existing lines.
// Run it yourself:  node qa/tools/add-portal-env.mjs
// It only adds keys that are missing, never prints existing values, and makes a .env.bak copy first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(root, '.env');

const DEMO = [
  ['# --- Test Studio portal (DEMO values; change before sharing with the team) ---'],
  ['PORTAL_ADMIN_USER', 'admin'],
  ['PORTAL_ADMIN_PASSWORD', 'Demo@12345'],
  ['PORTAL_WORKERS', '4'],
  ['PORTAL_CASE_TIMEOUT_MS', '120000'],
  ['INTAKE_MAX_MB', '2048'],
  ['PORTAL_REQUEST_TIMEOUT_MS', '1800000'],
  ['ANTHROPIC_API_KEY', ''],
  ['INSIGHTS_MODEL', 'claude-sonnet-5-5'],
  ['PORTAL_HOST', '127.0.0.1'],
  ['PORTAL_PORT', '4173'],
  ['PORTAL_PUBLIC_HOST', ''],
  ['PORTAL_PORT_PUBLISHED', '4173'],
  ['PORTAL_PYTHON', 'python'],
];

const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const have = new Set(current.split(/\r?\n/).map(l => /^\s*([A-Za-z_][\w]*)\s*=/.exec(l)?.[1]).filter(Boolean));

const added = [], skipped = [], lines = [];
for (const [key, value] of DEMO) {
  if (value === undefined) { lines.push(key); continue; } // comment line
  if (have.has(key)) { skipped.push(key); continue; }
  lines.push(`${key}=${value}`); added.push(key);
}

if (!added.length) { console.log('Nothing to add: every key already exists in .env.'); process.exit(0); }

if (current) fs.copyFileSync(envFile, `${envFile}.bak`);
const sep = current && !current.endsWith('\n') ? '\n' : '';
fs.appendFileSync(envFile, `${sep}${current ? '\n' : ''}${lines.join('\n')}\n`);

console.log(`Added ${added.length} key(s): ${added.join(', ')}`);
if (skipped.length) console.log(`Left unchanged (already set): ${skipped.join(', ')}`);
if (current) console.log('Backup written to .env.bak (delete it when you are happy; it holds your credentials).');
console.log('DEMO admin login: admin / Demo@12345. Change PORTAL_ADMIN_PASSWORD before real use.');
