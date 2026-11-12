import { timingSafeEqual } from 'node:crypto';
import { check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { brandName } from '../http/brand.mjs';

// Unauthenticated routes: they run before the principal check (see routes/gate.mjs).
export default async function handle(ctx, rc) {
  const { req, res, route } = rc;
  const { users, token, fixedAccounts, logger } = ctx;
  const { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts } = ctx.sessions;
      if (route === '/api/session' && req.method === 'GET') {
        const user = principal(req), accounts = users.exists();
        return json(res, 200, { authenticated: Boolean(user), authRequired: accounts || Boolean(token), mode: accounts ? 'users' : token ? 'token' : 'open',
          brand: brandName(), ...(user ? { user: sessionUser(user), mustChangePassword: Boolean(user.mustChangePassword) } : {}) });
      }
      if (route === '/api/login' && req.method === 'POST') {
        const key = req.socket.remoteAddress;
        const attempt = loginAttempts.get(key) ?? { count: 0, since: Date.now() };
        if (Date.now() - attempt.since > 60000) { attempt.count = 0; attempt.since = Date.now(); }
        check(attempt.count < 10, 'Too many login attempts. Wait one minute.', 429); loginAttempts.set(key, attempt);
        const body = await readJson(req);
        if (users.exists()) {
          let user = users.authenticate(body.username, body.password);
          if (!user) {
            // Fixed accounts heal themselves: if the supplied login is exactly the configured one but the stored password drifted, restore it and sign in.
            const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
            const fixed = fixedAccounts.find(a => same(a.username, String(body.username ?? '').trim().toLowerCase()) && same(a.password, body.password ?? ''));
            if (fixed) { try { users.reconcile({ username: fixed.username, password: fixed.password }, fixed.kind); user = users.authenticate(body.username, body.password); } catch (e) { logger?.(`Could not restore the fixed ${fixed.kind} account: ${e.message}`, 'stderr'); } }
          }
          if (!user) attempt.count++;
          check(user, 'Incorrect username or password.', 401);
          attempt.count = 0;
          startSession(req, res, user.id);
          return json(res, 200, { authenticated: true, user: sessionUser(user), mustChangePassword: Boolean(user.mustChangePassword) });
        }
        const supplied = Buffer.from(String(body.token ?? '')), expected = Buffer.from(token);
        const keyOk = !token || (supplied.length === expected.length && timingSafeEqual(supplied, expected)); if (!keyOk) attempt.count++;
        check(keyOk, 'Incorrect portal access key.', 401);
        startSession(req, res, null);
        return json(res, 200, { authenticated: true, user: sessionUser(LOCAL_USER) });
      }
      if (route === '/api/logout' && req.method === 'POST') {
        sessions.delete(sessionId(req)); res.setHeader('Set-Cookie', 'portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
      }
  return false;
}

// Needs rc.user, so it is registered after the gate.
export async function password(ctx, rc) {
  const { req, res, route, user } = rc;
  const { users, logger } = ctx;
  const { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts } = ctx.sessions;
  const { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless } = ctx.membership;
  
        if (route === '/api/me/password' && req.method === 'POST') {
          check(user.id !== 'local', 'Password changes apply to user accounts only.');
          const body = await readJson(req);
          users.changePassword(user.id, body.current, body.next);
          record(user, { action: 'user.password.change', scopeType: 'platform', scopeId: '', subject: { type: 'user', id: user.id, name: user.username }, detail: null });
          dropSessions(user.id, sessionId(req));
          return json(res, 200, { ok: true });
        }
  return false;
}
