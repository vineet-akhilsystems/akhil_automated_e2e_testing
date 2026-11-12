// Resets a Test Studio portal account's password directly in the portal database.
// Use it when every admin is locked out. Run from the project folder:
//   node qa/tools/reset-portal-password.mjs --user admin                 (prints a new random password)
//   node qa/tools/reset-portal-password.mjs --user admin --password "Your-own-pass-123"
// It only changes that one user's password hash (and re-enables the account). It does not touch roles,
// memberships or any other data, and it works while the portal is running (the next sign-in uses it).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../../portal/users.mjs';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbFile = path.resolve(arg('db') ?? path.join(root, '.portal', 'portal.sqlite'));
const username = String(arg('user') ?? '').trim().toLowerCase();
if (!username) { console.error('Usage: node qa/tools/reset-portal-password.mjs --user <username> [--password <new>]'); process.exit(2); }

const password = arg('password') ?? `Ts-${randomBytes(9).toString('base64url')}`;
if (password.length < 8 || password.length > 200) { console.error('Password must be 8-200 characters.'); process.exit(2); }

const db = new DatabaseSync(dbFile);
db.exec('PRAGMA busy_timeout = 5000');
const row = db.prepare('SELECT id, document FROM users WHERE username = ?').get(username);
if (!row) {
  const names = db.prepare('SELECT username FROM users ORDER BY username').all().map(r => r.username);
  console.error(`No user "${username}". Existing users: ${names.join(', ') || '(none)'}`);
  process.exit(1);
}
const user = JSON.parse(row.document);
const next = { ...user, passwordHash: hashPassword(password), disabled: false, mustChangePassword: false, passwordChangedAt: new Date().toISOString() };
db.prepare('UPDATE users SET document = ? WHERE id = ?').run(JSON.stringify(next), row.id);
db.close();

console.log(`Password reset for "${username}" (role: ${user.role}).`);
console.log(`New password: ${password}`);
console.log('Sign in, then change it with the Password button (top right). Existing sessions for this user stay signed in until they expire.');
