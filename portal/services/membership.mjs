import { randomUUID } from 'node:crypto';
import { check } from '../registry.mjs';
import { LEGACY_ROLES } from '../users.mjs';
import { PERMISSION_IDS, PRODUCT_ONLY, rolesForScope, permissionsOf, effectiveModulePermissions, effectiveProductPermissions } from '../access.mjs';

const now = () => new Date().toISOString();

export function createMembership({ store, access, users, audit }) {
  const { pidOf, DENIED } = access;
  const LEAD_CAPABILITIES = ['module.view', 'module.settings', 'members.manage'];
  // ---- Memberships, teams and the audit log ----
  const subjectOf = (type, id) => {
    if (type === 'team') { const t = store.team(id); return t ? { type, id, name: t.name } : null; }
    const u = store.user(id); return u ? { type: 'user', id, name: u.displayName || u.username } : null;
  };
  const memberView = m => ({ id: m.id, subject: subjectOf(m.subjectType, m.subjectId) ?? { type: m.subjectType, id: m.subjectId, name: m.subjectId }, role: m.role, overrides: m.overrides ?? {},
    expiresAt: m.expiresAt ?? null, createdBy: m.createdBy ?? null, createdAt: m.createdAt, effective: [...permissionsOf(m.role, m.overrides)].sort() });
  const record = (user, entry) => store.audit({ actor: user.username, ...entry });
  const trail = record;
  const inModule = (user, action, id, detail) => record(user, { action, scopeType: 'module', scopeId: id, subject: null, detail });
  function parseGrant(body, scopeType) {
    check(['user', 'team'].includes(body.subjectType), 'subjectType must be user or team.');
    check(typeof body.subjectId === 'string' && subjectOf(body.subjectType, body.subjectId), 'That person or team does not exist.', 404);
    return { subjectType: body.subjectType, subjectId: body.subjectId, ...parseRole(body, scopeType) };
  }
  function parseRole(body, scopeType, current) {
    const out = {};
    const role = body.role ?? current?.role;
    check(rolesForScope(scopeType).includes(role), `Role must be one of: ${rolesForScope(scopeType).join(', ')}.`);
    out.role = role;
    const overrides = body.overrides === undefined ? (current?.overrides ?? {}) : body.overrides;
    check(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'overrides must be an object of permission ids to true/false.');
    for (const [k, v] of Object.entries(overrides)) {
      check(PERMISSION_IDS.includes(k), `Unknown permission: ${k}.`);
      check(typeof v === 'boolean', `Override ${k} must be true or false.`);
      check(scopeType === 'product' || !PRODUCT_ONLY.includes(k), `${k} only applies at product scope.`);
    }
    out.overrides = { ...overrides };
    const expiresAt = body.expiresAt === undefined ? current?.expiresAt : body.expiresAt;
    if (expiresAt) {
      check(typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt)), 'expiresAt must be a date.');
      // A newly given expiry must lie in the future (an unchanged, already-passed one on an existing membership is left as it is).
      check(body.expiresAt === undefined || Date.parse(expiresAt) > Date.now(), 'expiresAt must be in the future. To end access now, remove the membership.');
      out.expiresAt = new Date(expiresAt).toISOString();
    }
    return out;
  }
  // No privilege escalation: the granter's own effective permissions must include everything given or taken over.
  function assertCovers(acc, scopeType, scopeId, perms) {
    const have = scopeType === 'module' ? acc.module(store.module(scopeId)) : acc.product(scopeId);
    const missing = [...perms].filter(p => !have.has(p));
    check(!missing.length, `You cannot grant or change permissions you do not have yourself: ${missing.join(', ')}.`, 403);
  }
  // ---- Who leads a module ----
  // Computed with the real effective-permission rules (expiry, direct-beats-team, disabled accounts) from lookups built once per call,
  // and only for the modules asked about, so large installations stay fast. Only subjects holding at least one membership that can
  // provide members.manage are considered (everyone else cannot complete the lead set), and each is evaluated against just their own memberships.
  const FAR = 8.64e15;   // "after every expiry"
  function leadState() {
    const all = store.memberships(), now0 = Date.now();
    const byModule = new Map(), byProduct = new Map();
    for (const m of all) {
      const map = m.scopeType === 'module' ? byModule : m.scopeType === 'product' ? byProduct : null;
      if (!map) continue;
      if (!map.has(m.scopeId)) map.set(m.scopeId, []);
      map.get(m.scopeId).push(m);
    }
    // product-level memberships indexed by subject, so a candidate's own entries are found without scanning the whole product
    const productBySubject = new Map();
    for (const [pid, list] of byProduct) for (const m of list) { const key = `${pid}|${m.subjectType}|${m.subjectId}`; if (!productBySubject.has(key)) productBySubject.set(key, []); productBySubject.get(key).push(m); }
    const accounts = new Map(store.users().map(u => [u.id, u])), members = new Map(), teamsOf = new Map();
    for (const row of store.teamMemberRows()) {
      if (!members.has(row.team_id)) members.set(row.team_id, []);
      members.get(row.team_id).push(row.user_id);
      if (!teamsOf.has(row.user_id)) teamsOf.set(row.user_id, []);
      teamsOf.get(row.user_id).push(row.team_id);
    }
    const canManage = m => permissionsOf(m.role, m.overrides).has('members.manage');
    const candidatesOf = m => {
      const modMs = byModule.get(m.id) ?? [], pid = pidOf(m), found = new Set();
      for (const ms of [...modMs, ...(byProduct.get(pid) ?? [])].filter(canManage)) {
        if (ms.subjectType === 'user') found.add(ms.subjectId); else for (const id of members.get(ms.subjectId) ?? []) found.add(id);
      }
      return { modMs, pid, found };
    };
    const hasLead = (m, when, ctx = candidatesOf(m)) => {
      for (const id of ctx.found) {
        const account = accounts.get(id);
        if (!account || account.disabled) continue;
        const teams = teamsOf.get(id) ?? [];
        const mine = [...ctx.modMs.filter(x => (x.subjectType === 'user' && x.subjectId === id) || (x.subjectType === 'team' && teams.includes(x.subjectId))),
          ...(productBySubject.get(`${ctx.pid}|user|${id}`) ?? []), ...teams.flatMap(t => productBySubject.get(`${ctx.pid}|team|${t}`) ?? [])];
        // An administrator counts only through an actual lead membership (their blanket access is not leadership).
        const perms = effectiveModulePermissions({ id, role: account.role === 'admin' ? 'member' : account.role }, m, mine, teams, when);
        if (LEAD_CAPABILITIES.every(p => perms.has(p))) return true;
      }
      return false;
    };
    // the modules that have a lead at `when` (default: now)
    const state = (modules, when = now0) => new Set(modules.filter(m => hasLead(m, when)).map(m => m.id));
    // the last instant at which a module still has a lead (null = none now; FAR = never ends)
    state.leadUntil = m => {
      const ctx = candidatesOf(m);
      if (hasLead(m, FAR, ctx)) return FAR;
      const ends = new Set();
      for (const x of [...ctx.modMs, ...(byProduct.get(ctx.pid) ?? [])]) if (x.expiresAt && Date.parse(x.expiresAt) > now0) ends.add(Date.parse(x.expiresAt));
      for (const end of [...ends].sort((a, b) => b - a)) if (hasLead(m, end - 1, ctx)) return end;
      return hasLead(m, now0, ctx) ? now0 : null;
    };
    return state;
  }
  const modulesWithLead = modules => leadState()(modules);
  // Modules whose leadership can depend on this user (directly or through their teams) or on this team.
  function modulesReachable({ userId, teamId }) {
    const teams = new Set(teamId ? [teamId] : userId ? store.teamIdsOfUser(userId) : []);
    const scopes = store.memberships().filter(m => (userId && m.subjectType === 'user' && m.subjectId === userId) || (m.subjectType === 'team' && teams.has(m.subjectId)));
    const modScopes = new Set(scopes.filter(m => m.scopeType === 'module').map(m => m.scopeId)), prodScopes = new Set(scopes.filter(m => m.scopeType === 'product').map(m => m.scopeId));
    return store.modules().filter(m => modScopes.has(m.id) || prodScopes.has(pidOf(m)));
  }
  // A module with a lead must keep one, now and once every expiring grant has ended. A non-admin change that would leave a module
  // leaderless (now, or permanently because the remaining leads all expire) is refused. Administrators are not blocked, but it is always audited.
  function keepingLeads(user, acc, modules, fn) {
    const beforeState = leadState(), before = beforeState(modules), beforeFar = beforeState(modules, FAR);
    return store.transaction(() => {
      const result = fn();
      const afterState = leadState(), after = afterState(modules), afterFar = afterState(modules, FAR);
      const lost = [...before].filter(id => !after.has(id)), lostLater = [...beforeFar].filter(id => !afterFar.has(id) && after.has(id));
      if (lost.length || lostLater.length) {
        check(acc.admin, 'A module must keep at least one lead or product owner. Add another lead first (a lead whose access expires does not count as permanent).', 403);
        for (const id of lost) record(user, { action: 'module.noLead', scopeType: 'module', scopeId: id, subject: null, detail: { reason: 'access changed by an administrator' } });
        for (const id of lostLater) {
          const until = afterState.leadUntil(store.module(id));
          record(user, { action: 'module.noLead', scopeType: 'module', scopeId: id, subject: null, detail: { reason: `access changed by an administrator; the module will have no lead after ${new Date(until).toISOString()}`, leaderlessAfter: new Date(until).toISOString() } });
        }
      }
      return result;
    });
  }
  const modulesOfScope = (scopeType, scopeId) => scopeType === 'module' ? [store.module(scopeId)].filter(Boolean) : store.modules().filter(m => pidOf(m) === scopeId);
  const scopeAudit = (scopeType, scopeId) => ({ scopeType, scopeId });
  // Acting on yourself, directly or through a team you belong to, is never allowed (administrators already hold everything).
  const isSelf = (user, acc, subjectType, subjectId) => !acc.admin && ((subjectType === 'user' && subjectId === user.id) || (subjectType === 'team' && store.teamMemberIds(subjectId).includes(user.id)));
  // The latest moment until which the actor keeps ALL of the `need` permissions on this scope (null = no end). Evaluated with the real
  // effective-permission functions at every instant where one of the actor's memberships ends, so shadowed or unrelated grants cannot extend it.
  // Nobody can hand out access that outlives their own. If they do not hold the permissions at all, the cap is "now" (nothing may be granted).
  function grantCap(user, acc, scopeType, scopeId, need) {
    if (acc.admin) return null;
    const teams = store.teamIdsOfUser(user.id), module = scopeType === 'module' ? store.module(scopeId) : null, at = Date.now(), pid = scopeType === 'module' ? pidOf(module ?? {}) : scopeId;
    // Only the actor's own direct and team memberships on this module or its product can matter; everything else in the system is ignored.
    const ms = store.memberships().filter(m => ((m.subjectType === 'user' && m.subjectId === user.id) || (m.subjectType === 'team' && teams.includes(m.subjectId)))
      && ((m.scopeType === 'product' && m.scopeId === pid) || (scopeType === 'module' && m.scopeType === 'module' && m.scopeId === scopeId)));
    const holds = when => { const perms = scopeType === 'module' ? effectiveModulePermissions(user, module, ms, teams, when) : effectiveProductPermissions(user, scopeId, ms, teams, when); return [...need].every(p => perms.has(p)); };
    if (holds(FAR)) return null;
    const ends = [...new Set(ms.filter(m => m.expiresAt && Date.parse(m.expiresAt) > at).map(m => Date.parse(m.expiresAt)))].sort((a, b) => b - a);
    for (const end of ends) if (holds(end - 1)) return end;
    return at;
  }
  const grantNeed = perms => new Set(['members.manage', ...perms]);
  const assertWithinCap = (cap, expiresAt) => check(cap === null || (expiresAt && Date.parse(expiresAt) <= cap), `Your own access${cap === null ? '' : ` ends ${new Date(cap).toISOString()}`}; you cannot give access that lasts longer. Set an earlier expiry.`, 403);
  const teamMemberships = teamId => store.memberships().filter(m => m.subjectType === 'team' && m.subjectId === teamId);
  const memberNames = teamId => store.teamMemberIds(teamId).map(id => store.user(id)?.username ?? id);
  // Adding someone to a team gives them everything the team holds, on every scope it is attached to (expired grants included, so nobody joins freely).
  // Nobody adds themselves to a team.
  function assertTeamAdd(user, acc, team, memberId) {
    if (acc.admin) return;
    check(memberId !== user.id, 'You cannot add yourself to a team.', 403);
    assertTeamManage(acc, team);   // whoever adds people must also be able to remove them again
    for (const ms of teamMemberships(team.id)) {
      const perms = permissionsOf(ms.role, ms.overrides);
      assertCovers(acc, ms.scopeType, ms.scopeId, perms);
      if (ms.expiresAt && Date.parse(ms.expiresAt) <= Date.now()) continue;
      assertWithinCap(grantCap(user, acc, ms.scopeType, ms.scopeId, perms), ms.expiresAt);
    }
  }
  // Removing members or deleting a team revokes access on every scope it is attached to, so the actor must manage all of them.
  function assertTeamManage(acc, team) {
    if (acc.admin) return;
    for (const ms of teamMemberships(team.id)) {
      const have = ms.scopeType === 'module' ? (store.module(ms.scopeId) ? acc.module(store.module(ms.scopeId)) : new Set()) : acc.product(ms.scopeId);
      check(have.has('members.manage'), 'This team is attached to places you do not manage, so only an administrator can change it.', 403);
    }
  }
  // Mirror a team change into the audit log of every scope the team is attached to, so leads can see who gained or lost access.
  function recordViaTeam(user, team, action, subject, extra = {}) {
    for (const ms of teamMemberships(team.id)) record(user, { action, scopeType: ms.scopeType, scopeId: ms.scopeId, subject, detail: { viaTeam: { id: team.id, name: team.name }, role: ms.role, ...extra } });
  }
  function addMember(user, acc, scopeType, scopeId, body) {
    const grant = parseGrant(body, scopeType), perms = permissionsOf(grant.role, grant.overrides);
    check(!isSelf(user, acc, grant.subjectType, grant.subjectId), 'You cannot change your own access.', 403);
    assertCovers(acc, scopeType, scopeId, perms);
    assertWithinCap(grantCap(user, acc, scopeType, scopeId, grantNeed(perms)), grant.expiresAt);
    check(!store.memberships().some(x => x.subjectType === grant.subjectType && x.subjectId === grant.subjectId && x.scopeType === scopeType && x.scopeId === scopeId), 'They already have access here. Edit the existing entry instead.', 409);
    const ms = { id: randomUUID(), ...grant, scopeType, scopeId, createdBy: user.username, createdAt: now() };
    keepingLeads(user, acc, modulesOfScope(scopeType, scopeId), () => {
      store.saveMembership(ms);
      record(user, { action: 'membership.add', ...scopeAudit(scopeType, scopeId), subject: subjectOf(ms.subjectType, ms.subjectId), detail: { role: ms.role, overrides: ms.overrides, expiresAt: ms.expiresAt ?? null, ...(ms.subjectType === 'team' ? { members: memberNames(ms.subjectId) } : {}) } });
    });
    return ms;
  }
  // Legacy users.role values tester/ba/viewer map to an Augastam product membership; admin/member have none.
  // Only memberships created by this mapping (flagged legacy) are ever changed; a membership someone set up deliberately is left alone and the audit says so.
  function syncLegacyMembership(userId, role, actor) {
    const target = store.user(userId), sub = { type: 'user', id: userId, name: target?.username ?? userId };
    const existing = store.memberships().find(m => m.subjectType === 'user' && m.subjectId === userId && m.scopeType === 'product' && m.scopeId === 'augastam');
    const where = { scopeType: 'product', scopeId: 'augastam', subject: sub };
    if (existing && !existing.legacy) {
      record(actor, { action: 'membership.kept', ...where, detail: { legacy: true, note: 'kept existing membership', requestedRole: role, existingRole: existing.role } });
      return;
    }
    if (!LEGACY_ROLES.includes(role)) {
      if (existing) { store.deleteMembership(existing.id); record(actor, { action: 'membership.remove', ...where, detail: { role: existing.role, legacy: true } }); }
      return;
    }
    if (existing) {
      if (existing.role === role) return;
      store.saveMembership({ ...existing, role });
      record(actor, { action: 'membership.update', ...where, detail: { legacy: true, from: { role: existing.role, overrides: existing.overrides, expiresAt: existing.expiresAt ?? null }, to: { role, overrides: existing.overrides, expiresAt: existing.expiresAt ?? null } } });
      return;
    }
    store.saveMembership({ id: randomUUID(), subjectType: 'user', subjectId: userId, scopeType: 'product', scopeId: 'augastam', role, overrides: {}, legacy: true, createdBy: actor.username, createdAt: now() });
    record(actor, { action: 'membership.add', ...where, detail: { role, overrides: {}, expiresAt: null, legacy: true } });
  }
  // A module that had a lead and now has none is reported in the audit log (never silent). `modules` limits the check to what the change could affect.
  function auditLeaderless(user, before, reason, subject, modules = store.modules()) {
    const after = modulesWithLead(modules);
    for (const id of before) if (!after.has(id)) record(user, { action: 'module.noLead', scopeType: 'module', scopeId: id, subject, detail: { reason } });
  }
  return { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless, LEAD_CAPABILITIES };
}
