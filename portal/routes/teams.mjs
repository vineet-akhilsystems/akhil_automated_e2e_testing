import { randomUUID } from 'node:crypto';
import { check, textValue, HttpError } from '../registry.mjs';
import { readJson } from '../http/body.mjs';
import { json } from '../http/respond.mjs';
import { permissionsOf } from '../access.mjs';

export default async function handle(ctx, rc) {
  const { req, res, route, user, acc } = rc;
  const { store } = ctx;
  const { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless } = ctx.membership;
  const { now, sorted } = ctx.helpers;
        const teamView = t => { const members = store.teamMemberIds(t.id).map(id => store.user(id)).filter(Boolean).map(u => ({ id: u.id, username: u.username, displayName: u.displayName }));
          return { id: t.id, name: t.name, description: t.description ?? '', createdBy: t.createdBy, memberCount: members.length, members }; };
        if (route === '/api/teams' && req.method === 'GET') return json(res, 200, store.teams().map(teamView));
        if (route === '/api/teams' && req.method === 'POST') {
          const body = await readJson(req), name = textValue(body.name, 'Team name', 80, true);
          check(!store.teams().some(t => t.name.toLowerCase() === name.toLowerCase()), 'A team with that name already exists.', 409);
          const team = { id: randomUUID(), name, description: textValue(body.description ?? '', 'Description', 500), createdBy: user.username, createdById: user.id, createdAt: now() };
          store.transaction(() => { store.saveTeam(team); record(user, { action: 'team.create', scopeType: 'team', scopeId: team.id, subject: { type: 'team', id: team.id, name }, detail: null }); });
          return json(res, 201, teamView(team));
        }
        const teamMatch = /^\/api\/teams\/([\w-]+)(?:\/members(?:\/([\w-]+))?)?$/.exec(route);
        if (teamMatch) {
          const team = store.team(teamMatch[1]);
          check(team, 'Team not found.', 404);
          check(acc.admin || team.createdById === user.id, 'Only an administrator or the person who created the team can change it.', 403);
          const tsub = { type: 'team', id: team.id, name: team.name }, isMembers = route.includes('/members');
          if (!isMembers && req.method === 'PATCH') {
            const body = await readJson(req), next = { ...team };
            if (body.name !== undefined) { next.name = textValue(body.name, 'Team name', 80, true); check(!store.teams().some(t => t.id !== team.id && t.name.toLowerCase() === next.name.toLowerCase()), 'A team with that name already exists.', 409); }
            if (body.description !== undefined) next.description = textValue(body.description, 'Description', 500);
            if (next.name === team.name && next.description === team.description) return json(res, 200, teamView(team));   // nothing changed: no write, no audit row
            store.transaction(() => { store.saveTeam(next); record(user, { action: 'team.update', scopeType: 'team', scopeId: team.id, subject: tsub, detail: { name: next.name, description: next.description } }); });
            return json(res, 200, teamView(next));
          }
          if (!isMembers && req.method === 'DELETE') {
            assertTeamManage(acc, team);
            keepingLeads(user, acc, modulesReachable({ teamId: team.id }), () => {
              for (const ms of teamMemberships(team.id)) record(user, { action: 'membership.remove', scopeType: ms.scopeType, scopeId: ms.scopeId, subject: tsub, detail: { role: ms.role, teamDeleted: true, members: memberNames(team.id) } });
              store.deleteTeam(team.id); record(user, { action: 'team.delete', scopeType: 'team', scopeId: team.id, subject: tsub, detail: null });
            });
            return json(res, 200, { deleted: team.id });
          }
          if (isMembers && !teamMatch[2] && req.method === 'POST') {
            const body = await readJson(req), member = store.user(String(body.userId ?? ''));
            check(member, 'That person does not exist.', 404);
            assertTeamAdd(user, acc, team, member.id);
            const msub = { type: 'user', id: member.id, name: member.username };
            store.transaction(() => { store.addTeamMember(team.id, member.id); record(user, { action: 'team.member.add', scopeType: 'team', scopeId: team.id, subject: msub, detail: null }); recordViaTeam(user, team, 'membership.add', msub); });
            return json(res, 201, teamView(team));
          }
          if (isMembers && teamMatch[2] && req.method === 'DELETE') {
            const member = store.user(teamMatch[2]), msub = { type: 'user', id: teamMatch[2], name: member?.username ?? teamMatch[2] };
            assertTeamManage(acc, team);
            keepingLeads(user, acc, modulesReachable({ teamId: team.id }), () => { store.removeTeamMember(team.id, teamMatch[2]); record(user, { action: 'team.member.remove', scopeType: 'team', scopeId: team.id, subject: msub, detail: null }); recordViaTeam(user, team, 'membership.remove', msub); });
            return json(res, 200, teamView(team));
          }
          throw new HttpError(404, 'API route not found.');
        }
        const membershipMatch = /^\/api\/memberships\/([\w-]+)$/.exec(route);
        if (membershipMatch) {
          const ms = store.membership(membershipMatch[1]);
          check(!isSelf(user, acc, ms.subjectType, ms.subjectId), 'You cannot change your own access.', 403);
          const sub = subjectOf(ms.subjectType, ms.subjectId);
          const auditScope = scopeAudit(ms.scopeType, ms.scopeId);
          if (req.method === 'PATCH') {
            const body = await readJson(req), next = { ...ms, ...parseRole(body, ms.scopeType, ms) };
            if (body.expiresAt === null || body.expiresAt === '') delete next.expiresAt;
            delete next.legacy;   // a deliberately edited membership is never touched by the legacy role mapping again
            // 8b: an edit that changes nothing is refused and leaves no audit row
            check(next.role !== ms.role || JSON.stringify(sorted(next.overrides ?? {})) !== JSON.stringify(sorted(ms.overrides ?? {})) || (next.expiresAt ?? null) !== (ms.expiresAt ?? null), 'Nothing to change.');
            const oldPerms = permissionsOf(ms.role, ms.overrides), newPerms = permissionsOf(next.role, next.overrides);
            // Reducing access (fewer permissions, expiry not later) is always allowed to someone who covers it, even when their own access is about to end.
            const reduces = [...newPerms].every(p => oldPerms.has(p)) && (!ms.expiresAt || (next.expiresAt && Date.parse(next.expiresAt) <= Date.parse(ms.expiresAt)));
            if (!reduces) assertWithinCap(grantCap(user, acc, ms.scopeType, ms.scopeId, grantNeed(newPerms)), next.expiresAt);
            assertCovers(acc, ms.scopeType, ms.scopeId, new Set([...permissionsOf(ms.role, ms.overrides), ...permissionsOf(next.role, next.overrides)]));
            keepingLeads(user, acc, modulesOfScope(ms.scopeType, ms.scopeId), () => { store.saveMembership(next);
              record(user, { action: 'membership.update', ...auditScope, subject: sub, detail: { from: { role: ms.role, overrides: ms.overrides, expiresAt: ms.expiresAt ?? null }, to: { role: next.role, overrides: next.overrides, expiresAt: next.expiresAt ?? null } } }); });
            return json(res, 200, memberView(next));
          }
          if (req.method === 'DELETE') {
            assertCovers(acc, ms.scopeType, ms.scopeId, permissionsOf(ms.role, ms.overrides));
            keepingLeads(user, acc, modulesOfScope(ms.scopeType, ms.scopeId), () => { store.deleteMembership(ms.id); record(user, { action: 'membership.remove', ...auditScope, subject: sub, detail: { role: ms.role, ...(ms.subjectType === 'team' ? { members: memberNames(ms.subjectId) } : {}) } }); });
            return json(res, 200, { deleted: ms.id });
          }
          throw new HttpError(404, 'API route not found.');
        }
        const membersMatch = /^\/api\/(modules|products)\/([\w-]+)\/members$/.exec(route);
        if (membersMatch) {
          const scopeType = membersMatch[1] === 'modules' ? 'module' : 'product', scopeId = membersMatch[2];
          if (req.method === 'GET') {
            // Additive: noLead marks a module nobody can currently manage (also sent as the X-No-Lead header, which works for an empty list).
            const noLead = scopeType === 'module' && !modulesWithLead([store.module(scopeId)]).has(scopeId);
            res.setHeader('X-No-Lead', String(noLead));
            return json(res, 200, store.membershipsFor(scopeType, scopeId).map(m => ({ ...memberView(m), noLead })));
          }
          if (req.method === 'POST') return json(res, 201, memberView(addMember(user, acc, scopeType, scopeId, await readJson(req))));
          throw new HttpError(404, 'API route not found.');
        }
  return false;
}
