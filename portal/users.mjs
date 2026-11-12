import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { check, textValue } from './registry.mjs';

// users.role is only the platform role: 'admin' (everything) or 'member' (access comes from memberships).
// tester/ba/viewer are legacy values: still accepted, mapped by the server to an Augastam product membership.
export const LEGACY_ROLES = ['tester', 'ba', 'viewer'];
export const ROLES = ['admin', 'member', ...LEGACY_ROLES];

const MANAGED_MSG = 'This administrator account is fixed by the server settings (PORTAL_ADMIN_USER / PORTAL_ADMIN_PASSWORD). Change it there and restart the portal.';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Used so a missing user costs the same as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password');

export const publicUser = u => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName, disabled: Boolean(u.disabled), mustChangePassword: Boolean(u.mustChangePassword), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt ?? null });

export function createUsers(store, logger = null) {
  const now = () => new Date().toISOString();
  const checkPassword = p => check(typeof p === 'string' && p.length >= 8 && p.length <= 200, 'Password must be 8–200 characters.');
  const checkUsername = n => { check(typeof n === 'string' && /^[a-z0-9][a-z0-9._-]{1,39}$/i.test(n.trim()), 'Username must be 2–40 letters, numbers, dots, dashes or underscores.'); return n.trim().toLowerCase(); };
  const activeAdmins = exceptId => store.users().filter(u => u.role === 'admin' && !u.disabled && u.id !== exceptId).length;
  const api = {
    count: () => store.users().length,
    exists: () => store.users().length > 0,
    list: () => store.users().map(publicUser),
    get: id => store.user(id),
    create({ username, password, role, displayName }, extra = {}) {
      const name = checkUsername(username);
      checkPassword(password);
      check(ROLES.includes(role), `Role must be one of: ${ROLES.join(', ')}.`);
      check(!store.userByName(name), 'That username already exists.', 409);
      const user = { id: randomUUID(), username: name, role, displayName: textValue(displayName ?? name, 'Display name', 120, true), passwordHash: hashPassword(password), disabled: false, createdAt: now(), ...extra };
      store.saveUser(user);
      return user;
    },
    update(id, patch) {
      const user = store.user(id);
      check(user, 'User not found.', 404);
      const next = { ...user };
      check(!user.managed || (patch.password === undefined && patch.role === undefined && patch.disabled === undefined), MANAGED_MSG, 409);
      if (patch.role !== undefined) { check(ROLES.includes(patch.role), `Role must be one of: ${ROLES.join(', ')}.`); next.role = patch.role; }
      if (patch.displayName !== undefined) next.displayName = textValue(patch.displayName, 'Display name', 120, true);
      if (patch.disabled !== undefined) { check(typeof patch.disabled === 'boolean', 'disabled must be true or false.'); next.disabled = patch.disabled; }
      if (patch.password !== undefined) { checkPassword(patch.password); next.passwordHash = hashPassword(patch.password); next.mustChangePassword = false; next.passwordChangedAt = now(); }
      const losesAdmin = user.role === 'admin' && !user.disabled && (next.role !== 'admin' || next.disabled);
      check(!losesAdmin || activeAdmins(id) > 0, 'At least one active administrator is required.', 409);
      store.saveUser(next);
      return next;
    },
    remove(id) {
      const user = store.user(id);
      check(user, 'User not found.', 404);
      check(!user.managed, MANAGED_MSG, 409);
      check(!(user.role === 'admin' && !user.disabled) || activeAdmins(id) > 0, 'At least one active administrator is required.', 409);
      store.deleteUser(id);
      return user;
    },
    // Returns the user on success, otherwise null. Same work either way to blunt timing probes.
    authenticate(username, password) {
      const user = store.userByName(String(username ?? '').trim().toLowerCase());
      const ok = verifyPassword(String(password ?? ''), user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok || user.disabled) return null;
      store.saveUser({ ...user, lastLoginAt: now() });
      return user;
    },
    changePassword(id, current, next) {
      const user = store.user(id);
      check(user, 'User not found.', 404);
      check(!user.managed, MANAGED_MSG, 409);
      check(verifyPassword(String(current ?? ''), user.passwordHash), 'Current password is incorrect.', 403);
      checkPassword(next);
      check(next !== current, 'Choose a new password that differs from the current one.');
      store.saveUser({ ...user, passwordHash: hashPassword(next), mustChangePassword: false, passwordChangedAt: now() });
    },
    // A fixed administrator defined by PORTAL_ADMIN_USER / PORTAL_ADMIN_PASSWORD. Applied on EVERY start so the
    // login never drifts: created if missing, renamed and re-passworded to match, always an enabled admin.
    // The account is flagged `managed`, so the UI/API cannot change its password, role or status or delete it.
    reconcile({ username, password } = {}, kind = 'admin') {
      const name = checkUsername(username || kind);
      checkPassword(password);
      const mine = u => u.managed === kind || (kind === 'admin' && u.managed === true);
      const user = store.users().find(mine) ?? store.userByName(name);
      check(!user || mine(user) || !user.managed, `The username "${name}" belongs to another fixed account.`, 409);
      check(kind === 'admin' || !user || user.role !== 'admin', `The username "${name}" belongs to an administrator, so it cannot be the fixed ${kind} account.`, 409);
      const role = kind === 'admin' ? 'admin' : (user && user.role !== 'admin' ? user.role : 'ba');
      const label = kind === 'admin' ? 'administrator' : kind;
      const vars = kind === 'admin' ? 'PORTAL_ADMIN_USER/PORTAL_ADMIN_PASSWORD' : 'PORTAL_TESTER_USER/PORTAL_TESTER_PASSWORD (or the admin password)';
      if (!user) {
        const created = api.create({ username: name, password, role, displayName: kind === 'admin' ? 'Administrator' : 'Tester' }, { managed: kind });
        logger?.(`Fixed ${label} "${created.username}" created from ${vars}.`);
        return created;
      }
      const clash = store.userByName(name);
      check(!clash || clash.id === user.id, `Cannot rename the fixed ${label} to "${name}": that username is already used by another account.`, 409);
      const samePassword = verifyPassword(password, user.passwordHash);
      if (samePassword && user.managed === kind && user.username === name && user.role === role && !user.disabled && !user.mustChangePassword) return user;
      const next = { ...user, username: name, role, disabled: false, managed: kind, mustChangePassword: false, ...(samePassword ? {} : { passwordHash: hashPassword(password), passwordChangedAt: now() }) };
      store.saveUser(next);
      logger?.(`Fixed ${label} "${name}" synced from ${vars}${samePassword ? '' : ' (password restored)'}.`);
      return next;
    },
    // First start with no users: env-defined admin, else a generated one-time password in the log.
    bootstrap({ username, password } = {}) {
      if (api.exists()) return null;
      const generated = !password;
      const secret = password || randomBytes(15).toString('base64url');
      const user = api.create({ username: username || 'admin', password: secret, role: 'admin', displayName: 'Administrator' }, { mustChangePassword: generated });
      if (generated) logger?.(`First start: created administrator "${user.username}" with one-time password: ${secret}  (change it after signing in; this is shown only once)`);
      else logger?.(`First start: created administrator "${user.username}" from PORTAL_ADMIN_USER/PORTAL_ADMIN_PASSWORD.`);
      return user;
    },
  };
  return api;
}
