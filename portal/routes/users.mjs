import { check } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { publicUser } from '../users.mjs';

export default async function handle(ctx, rc) {
  const { req, res, route, user } = rc;
  const { store, users } = ctx;
  const { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts } = ctx.sessions;
  const { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless } = ctx.membership;
        const userMatch = /^\/api\/users(?:\/([\w-]+))?$/.exec(route);
        if (userMatch) {
          const [, uid] = userMatch;
          if (!uid && req.method === 'GET') return json(res, 200, users.list());
          if (!uid && req.method === 'POST') { const body = await readJson(req); check(users.exists() || body.role === 'admin', 'The first account must be an administrator.', 409);
            const created = store.transaction(() => { const u = users.create(body); syncLegacyMembership(u.id, u.role, user); record(user, { action: 'user.create', scopeType: 'platform', scopeId: '', subject: { type: 'user', id: u.id, name: u.username }, detail: { role: u.role } }); return u; });
            return json(res, 201, publicUser(created)); }
          if (uid && req.method === 'PATCH') {
            const body = await readJson(req);
            const before = store.user(uid), watch = body.disabled === true || body.role !== undefined, reach = watch ? modulesReachable({ userId: uid }) : [], leadsBefore = watch ? modulesWithLead(reach) : new Set();
            const saved = store.transaction(() => {
              const s = users.update(uid, Object.fromEntries(['role', 'password', 'disabled', 'displayName'].filter(k => body[k] !== undefined).map(k => [k, body[k]])));
              const sub = { type: 'user', id: uid, name: s.username }, platform = { scopeType: 'platform', scopeId: '', subject: sub };
              if (body.role !== undefined) { syncLegacyMembership(uid, s.role, user); record(user, { action: 'user.role', ...platform, detail: { role: s.role } }); auditLeaderless(user, leadsBefore, 'role changed', sub, reach); }
              if (body.displayName !== undefined && s.displayName !== before.displayName) record(user, { action: 'user.displayName', ...platform, detail: { from: before.displayName ?? null, to: s.displayName } });
              if (Boolean(before.disabled) !== Boolean(s.disabled)) record(user, { action: s.disabled ? 'user.disable' : 'user.enable', ...platform, detail: null });
              if (body.password !== undefined) record(user, { action: 'user.password.reset', ...platform, detail: null });
              if (s.disabled && !before.disabled) auditLeaderless(user, leadsBefore, 'account disabled', sub, reach);
              return s;
            });
            if (saved.disabled || body.password !== undefined || body.role !== undefined) dropSessions(uid);
            return json(res, 200, publicUser(saved));
          }
          if (uid && req.method === 'DELETE') {
            check(uid !== user.id, 'You cannot delete your own account.', 409);
            const target = store.user(uid), reach = modulesReachable({ userId: uid }), leadsBefore = modulesWithLead(reach);
            const mine = store.memberships().filter(m => m.subjectType === 'user' && m.subjectId === uid), seats = store.teamIdsOfUser(uid).map(id => store.team(id)).filter(Boolean);
            store.transaction(() => {
              users.remove(uid);
              const sub = { type: 'user', id: uid, name: target.username };
              for (const team of seats) {
                recordViaTeam(user, team, 'membership.remove', sub, { userDeleted: true });
                record(user, { action: 'team.member.remove', scopeType: 'team', scopeId: team.id, subject: sub, detail: { userDeleted: true } });
              }
              for (const ms of mine) record(user, { action: 'membership.remove', scopeType: ms.scopeType, scopeId: ms.scopeId, subject: sub, detail: { role: ms.role, userDeleted: true } });
              store.deleteMembershipsForSubject('user', uid); store.removeUserFromAllTeams(uid);
              record(user, { action: 'user.delete', scopeType: 'platform', scopeId: '', subject: sub, detail: { membershipsRemoved: mine.length, teamSeatsRemoved: seats.length } });
              auditLeaderless(user, leadsBefore, 'account deleted', sub, reach);
            });
            dropSessions(uid); return json(res, 200, { deleted: uid });
          }
        }
  return false;
}
