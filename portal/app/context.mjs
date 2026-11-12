import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, adapters, check, textValue, validateCase, resolveCases, HttpError } from '../registry.mjs';
import { openStore } from '../store.mjs';
import { pluginFor, plugins } from '../modules/index.mjs';
import { createQueue } from '../queue.mjs';
import { TERMINAL } from '../quality.mjs';
import { LOGIN_KEYS } from '../environment-settings.mjs';
import { createUsers } from '../users.mjs';
import { createIntake } from '../intake.mjs';
import { saveExternalInsights } from '../insights.mjs';
import { createAgentRunner } from '../agent.mjs';
import { readiness } from '../readiness.mjs';
import { zipStream } from '../zip.mjs';
import { loadConfig } from './config.mjs';
import { acquireLock } from './lock.mjs';
import { createSessions } from '../services/session.mjs';
import { createAccess } from '../services/access.mjs';
import { createMembership } from '../services/membership.mjs';

const now = () => new Date().toISOString();

// Builds every dependency of the portal once. Route modules receive this object and never construct their own.
export function createContext(options = {}) {
  const config = loadConfig(options);
  const { dataDir, host, token, isLocalHost, environments, settings } = config;
  const lock = acquireLock(dataDir);
  const store = openStore(dataDir);
  const logger = options.logger ?? null;
  const users = createUsers(store, logger);
  // options.bootstrap: undefined = never create users automatically (token/open mode, used by tests);
  // true = create the first admin from PORTAL_ADMIN_USER/PORTAL_ADMIN_PASSWORD, or (without a legacy token) a generated one.
  const fixedAccounts = []; // configured fixed logins (kind, username, password) kept in memory only, used to self-heal at sign-in
  try {
    const boot = options.bootstrap;
    if (boot === true) {
      const env = { username: process.env.PORTAL_ADMIN_USER, password: process.env.PORTAL_ADMIN_PASSWORD };
      if (env.password) {
        // Fixed administrator: reconciled on every real start (see users.reconcile). A bad value must not stop the portal.
        try { users.reconcile(env); fixedAccounts.push({ kind: 'admin', username: String(env.username || 'admin').trim().toLowerCase(), password: env.password }); } catch (e) { logger?.(`Could not apply PORTAL_ADMIN_USER/PORTAL_ADMIN_PASSWORD: ${e.message}`, 'stderr'); if (!users.exists()) throw e; }
      } else if (!users.exists() && !token) users.bootstrap(env);
    } else if (boot && !users.exists()) {
      users.bootstrap(boot); // explicit credentials passed by a caller or test: create once, not fixed
    }
    check(isLocalHost || token.length >= 16 || users.exists(), 'Set PORTAL_ACCESS_TOKEN to at least 16 characters (or create portal users) before allowing team access.');
  } catch (error) { store.close(); lock.release(); throw error; }
  // Where module discovery output (qa/modules/<id>/discovery) and generated specs (tests/modules/...) live; injectable for tests.
  const qaRoot = path.resolve(options.qaRoot ?? path.join(ROOT, 'qa', 'modules')), specRoot = path.resolve(options.specRoot ?? ROOT);
  const intake = createIntake({ dataDir, store, maxMb: options.intakeMaxMb, exec: options.exec });
  // Startup housekeeping (never blocks the server): fingerprint older uploads, then re-queue extractions left 'pending' by a restart.
  setImmediate(() => { intake.backfill().catch(() => {}).then(() => intake.resume()).catch(() => {}); });
  const jobs = new Map();
  const agent = options.agent ?? createAgentRunner({ dataDir, store, intake, ingest: saveExternalInsights, referenceDir: path.join(ROOT, ...(plugins().find(p => p.agent?.referenceDir)?.agent.referenceDir ?? 'tests/modules/registration').split('/')), discoveryRoot: qaRoot, env: options.env ?? process.env, logger, ...options.agentOptions });
  const credentialsFor = e => e.managed ? settings.credentials(e.id)
    : Object.fromEntries(Object.entries(LOGIN_KEYS).map(([key, variable]) => [key, process.env[variable] ?? '']));
  const queue = createQueue(store, dataDir, environments, options.launch, logger, credentialsFor);
  const { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts } = createSessions({ store, users, token });
  const audit = user => ({ user: user.username, at: now() });
  const { accessFor, authorize, modulePermission, runPermission, enforce, pidOf, DENIED } = createAccess({ store, users, environments });
  const fourEyes = module => module.settings?.requireSecondApprover !== false;
  // With no accounts (open or access-key mode) there is only one local user, so a second approver cannot exist: the rule applies once accounts exist.
  const fourEyesActive = module => fourEyes(module) && users.exists();
  // Fields that change what a case does or means. Metadata (priority, category, enabled, notes) can change without a new approval.
  const CONTENT_FIELDS = ['title', 'steps', 'input', 'action', 'base', 'expected', 'target', 'requirement', 'preconditions', 'registrationType', 'mode'];
  const emptyToNull = v => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) ? null : v);
  const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  // `input` keeps the order of its keys (fields are filled in that order), so reordering it counts as a change; everything else ignores key order.
  const caseContent = c => JSON.stringify([sorted(Object.fromEntries(CONTENT_FIELDS.filter(k => k !== 'input').map(k => [k, emptyToNull(c?.[k])]))), JSON.stringify(emptyToNull(c?.input) ?? null)]);
  // Cases a non-reviewer touches always return to review; reviewers keep the stored decision.
  // With the second-approver rule a case is never auto-approved for its own author.
  function stampCase(validated, existing, user, module, acc) {
    const reviewer = acc.module(module).has('case.review'), stamp = audit(user), strict = fourEyesActive(module);
    const c = { ...validated };
    delete c.reviewStatus; delete c.reviewedBy; delete c.createdBy; delete c.contentBy;
    // contentBy: who last changed what the case does. They can never approve it, even if someone else edits metadata afterwards.
    if (!existing) {
      const want = ['draft', 'rejected'].includes(validated.reviewStatus) ? validated.reviewStatus : 'approved';
      c.reviewStatus = reviewer && !strict ? want : 'draft'; c.createdBy = stamp; c.contentBy = stamp;
      if (reviewer && !strict && want === 'approved') c.reviewedBy = { ...stamp, decision: 'approved' };
    } else {
      if (existing.createdBy) c.createdBy = existing.createdBy;
      if (existing.contentBy) c.contentBy = existing.contentBy;
      if (existing.reviewedBy) c.reviewedBy = existing.reviewedBy;
      if (caseContent(existing) !== caseContent(c)) c.contentBy = stamp;
      if (existing.reviewStatus !== undefined) c.reviewStatus = existing.reviewStatus;
      if (!reviewer && (existing.reviewStatus ?? 'approved') !== 'draft') { c.reviewStatus = 'draft'; delete c.reviewedBy; }
      // An approval covers the content that was approved: changing it sends the case back to review, whoever edits it.
      if (strict && caseContent(existing) !== caseContent(c)) { c.reviewStatus = 'draft'; delete c.reviewedBy; }
    }
    c.updatedBy = stamp;
    return c;
  }
  const { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless } = createMembership({ store, access: { pidOf, DENIED }, users, audit });
  // Login-profile identity fields (username, tenant, facility, role) are shown only to people who run tests there; others get name, url and session status.
  const publicEnvironment = (e, showLogin = true) => {
    let session = 'missing';
    const file = path.join(e.authDir, 'session.json');
    if (fs.existsSync(file) && fs.existsSync(path.join(e.authDir, 'admin.json'))) {
      session = 'saved';
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const jwt = String(saved.token ?? '').replace(/^Bearer /, '');
        const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        if (claims.exp && claims.exp * 1000 < Date.now()) session = 'expired';
      } catch { /* A saved opaque token can only be verified by the application. */ }
    }
    const credentials = credentialsFor(e);
    return { id: e.id, name: e.name, productId: e.productId ?? 'augastam', url: e.url, session, version: e.version ?? 0,
      loginConfigured: Object.keys(LOGIN_KEYS).every(k => Boolean(credentials?.[k])),
      loginSource: e.managed ? 'settings' : 'server', passwordSaved: Boolean(credentials?.password),
      login: Object.fromEntries(['username', 'tenant', 'facility', 'role'].map(k => [k, showLogin ? credentials?.[k] ?? '' : ''])) };
  };
  const getModule = id => { const m = store.module(id); check(m, 'Not found.', 404); return m; };
  // The readiness checklist, computed from live state on every call (nothing cached).
  function readinessFor(module) {
    const id = module.id, productId = module.productId ?? 'augastam', setup = module.setup ?? null;
    const discoveryDir = path.join(qaRoot, id, 'discovery'), fieldsFile = path.join(discoveryDir, 'fields-default.json');
    let discoveryExists = false, discoveryStale = false;
    if (pluginFor(id)?.discovery) { try { discoveryExists = fs.readdirSync(discoveryDir).length > 0; } catch { /* none */ } }
    else {
      try {
        const mtime = fs.statSync(fieldsFile).mtimeMs, confirmed = setup?.confirmedAt ? Date.parse(setup.confirmedAt) : NaN;
        if (Number.isFinite(confirmed) && mtime >= confirmed) discoveryExists = true; else discoveryStale = true;
      } catch { /* no discovery file */ }
    }
    const adapter = module.adapter ? adapters[module.adapter] : null;
    const specPath = adapter?.spec ? path.resolve(specRoot, adapter.spec) : null;
    const specExists = Boolean(specPath && specPath.startsWith(specRoot + path.sep) && fs.existsSync(specPath));
    const smokePassed = store.runs().some(r => r.module?.id === id && r.kind !== 'authentication' && r.mode === 'automated' && (r.productId ?? 'augastam') === productId
      && TERMINAL.includes(r.status) && (r.results ?? []).some(x => x.status === 'PASS') && r.cases?.some(c => c.mode === 'automated' && c.action !== 'unavailable'));
    return readiness({ module, product: store.product(productId) ?? { id: productId }, sources: store.intakeFiles(id), insights: store.insights(id), cases: store.cases(id), setup,
      discoveryExists, discoveryStale, adapterConnected: Boolean(adapter), specExists, smokePassed, jobs: agent.list(id) });
  }
  const gateError = (message, state) => Object.assign(new HttpError(409, message), { extra: { readiness: state } });
  const productName = id => store.product(id ?? 'augastam')?.name ?? id ?? 'Augastam';
  const getProduct = id => { const p = store.product(id); check(p, 'Not found.', 404); return p; };
  // Products as listed to clients, with live counts.
  const productList = acc => {
    const modules = acc.visibleModules(), seen = new Set(modules.map(m => m.id)), runs = store.runs().filter(r => r.kind !== 'authentication' && seen.has(r.module?.id));
    return acc.visibleProducts().map(p => {
      const mine = runs.filter(r => (r.productId ?? 'augastam') === p.id);
      return { id: p.id, name: p.name, description: p.description ?? '',
        moduleCount: modules.filter(m => (m.productId ?? 'augastam') === p.id).length, runCount: mine.length,
        environmentCount: environments.filter(e => (e.productId ?? 'augastam') === p.id).length,
        lastRunAt: mine.reduce((latest, r) => (!latest || r.createdAt > latest ? r.createdAt : latest), null) };
    });
  };
  const envsFor = productId => environments.filter(e => (e.productId ?? 'augastam') === productId);
  const runScope = r => (r.kind === 'authentication' ? { scopeType: 'product', scopeId: r.productId ?? 'augastam' } : { scopeType: 'module', scopeId: r.module?.id });
  const runEvent = (user, action, r, detail) => record(user, { action, ...runScope(r), subject: null, detail: { runId: r.id, ...detail } });
  const getRun = id => { const r = store.run(id); check(r, 'Not found.', 404); return r; };
  const visibleRun = (acc, r) => r.kind === 'authentication' ? acc.runStartIn(r.productId ?? 'augastam') : Boolean(store.module(r.module?.id)) && acc.module(store.module(r.module.id)).has('report.view');
  const summaryRun = r => {
    const { cases, module, ...rest } = r;
    return { ...rest, module: { id: module.id, name: module.name, area: module.area }, total: cases.length };
  };
  function createRun(body, user = LOCAL_USER, extra = {}) {
    check(typeof body?.moduleId === 'string' && body.moduleId, 'Choose a module.');
    const { acc: runAcc } = authorize(user, 'run.start', { module: body.moduleId });
    // A profile of a product the caller cannot see is reported exactly like a missing one.
    const environment = environments.find(e => e.id === body.environmentId);
    check(environment && runAcc.productVisible(environment.productId ?? 'augastam'), 'Choose a configured environment.');
    const module = getModule(body.moduleId);
    const productId = module.productId ?? 'augastam';
    check((environment.productId ?? 'augastam') === productId, `Login profile "${environment.name}" belongs to product "${productName(environment.productId)}", but module "${module.name}" belongs to "${productName(productId)}". Choose a profile from the same product.`, 409);
    check(['manual', 'automated'].includes(body.mode), 'Choose manual or automated execution.');
    const requested = body.caseIds;
    check(Array.isArray(requested) && requested.length > 0 && requested.length <= 5000, 'Select between 1 and 5,000 cases.');
    let cases = resolveCases(store.cases(module.id), requested);
    const unapproved = cases.filter(c => (c.reviewStatus ?? 'approved') !== 'approved');
    // Platform administrators may run any case, including drafts awaiting review.
    check(runAcc.admin || !unapproved.length, `Only approved cases can be run. Awaiting approval: ${unapproved.slice(0, 8).map(c => c.id).join(', ')}${unapproved.length > 8 ? ` and ${unapproved.length - 8} more` : ''}.`, 409);
    check(cases.every(c => c.mode === body.mode), 'Select cases with the same execution type. Prerequisites must have the same type.');
    cases = cases.map(c => validateCase(c, module));
    if (body.mode === 'automated') {
      check(adapters[module.adapter], 'This module has no automation connection.');
      if (cases.some(c => c.action !== 'unavailable')) check(publicEnvironment(environment).session === 'saved', 'The application session is missing or expired. Open Settings, check this profile and refresh application login first.', 409);
    }
    const run = { id: randomUUID(), name: textValue(body.name, 'Run name', 200, true), environmentId: environment.id,
      environmentName: environment.name, environmentUrl: environment.url, mode: body.mode, kind: 'tests', productId, productName: productName(productId),
      module: structuredClone(module), cases, results: [], status: body.mode === 'manual' ? 'manual' : 'queued', createdAt: now(), createdBy: audit(user), ...extra,
      scope: { repositoryCases: store.cases(module.id).length, enabledCases: store.cases(module.id).filter(c => c.enabled !== false).length,
        disabledCases: store.cases(module.id).filter(c => c.enabled === false).length, plannedCases: cases.length },
      requestedCount: new Set(requested).size, addedDependencies: cases.filter(c => !requested.includes(c.id)).map(c => c.id) };
    store.saveRun(run);
    record(user, { action: extra.rerunOf ? 'run.rerun' : 'run.create', scopeType: 'module', scopeId: module.id, subject: null, detail: { runId: run.id, mode: run.mode, cases: cases.length, ...(extra.rerunOf ? { rerunOf: extra.rerunOf } : {}) } });
    setImmediate(queue.pump); return summaryRun(run);
  }
  function sendPack(req, res, module, url, user) {
    const mid = module.id, files = intake.list(mid), insights = store.insights(mid), cases = store.cases(mid);
    const approved = cases.filter(c => (c.reviewStatus ?? 'approved') === 'approved'), pending = cases.filter(c => c.reviewStatus === 'draft');
    const stored = store.intakeFiles(mid).filter(f => fs.existsSync(intake.filePath(f)));
    const rawBytes = stored.reduce((n, f) => n + f.size, 0);
    const includeRaw = url.searchParams.get('files') !== '0' && rawBytes < 3.5 * 1024 ** 3;
    const entries = [], zipName = f => `${f.id.slice(0, 8)}-${f.name}`;
    const md = d => d ? [`# Insights: ${module.name}`, `Product: ${productName(module.productId)}`, `Mode: ${d.mode} | Created: ${d.createdAt}`, '', '## Summary', d.summary, '',
      '## Fields', ...d.fields.map(f => `- ${f.name} (${f.type}${f.required ? ', required' : ''}) ${f.description ?? ''} [${f.source}]`), '',
      '## Business rules', ...d.rules.map(r => `- ${r.text} [${r.source}]`), '', '## Flows', ...d.flows.flatMap(f => [`### ${f.name} [${f.source}]`, ...f.steps.map((s, i) => `${i + 1}. ${s}`)]), '',
      '## Edge cases', ...d.edgeCases.map(r => `- ${r.text} [${r.source}]`), '', '## Open questions', ...d.openQuestions.map(r => `- ${r.text} [${r.source}]`)].join('\n') : '';
    entries.push({ name: 'manifest.json', data: JSON.stringify({ format: 'augastam-module-pack/1', generatedAt: now(), generatedBy: user.username,
      product: { id: module.productId ?? 'augastam', name: productName(module.productId) },
      module: { id: module.id, productId: module.productId ?? 'augastam', productName: productName(module.productId), name: module.name, prefix: module.prefix, area: module.area, description: module.description, adapter: module.adapter ?? null },
      insights: insights ? { id: insights.id, mode: insights.mode, createdAt: insights.createdAt } : null,
      counts: { files: files.length, approvedCases: approved.length, draftCases: pending.length, totalCases: cases.length },
      rawFilesIncluded: includeRaw, files: files.map(f => ({ ...f, packPath: includeRaw ? `files/${zipName(f)}` : null, extractPath: (f.extract === 'ok' || f.extract === 'partial') ? `extracts/${zipName(f)}.txt` : null })) }, null, 2) });
    entries.push({ name: 'config/module.json', data: JSON.stringify({ bases: module.config?.bases ?? {}, requirements: module.config?.requirements ?? [] }, null, 2) });
    entries.push({ name: 'cases/approved-cases.json', data: JSON.stringify(approved, null, 2) });
    entries.push({ name: 'cases/draft-cases.json', data: JSON.stringify(pending, null, 2) });
    if (insights) { entries.push({ name: 'insights/insights.json', data: JSON.stringify(insights, null, 2) }); entries.push({ name: 'insights/insights.md', data: md(insights) }); }
    for (const f of stored) {
      if (f.extract === 'ok' || f.extract === 'partial') { try { entries.push({ name: `extracts/${zipName(f)}.txt`, data: JSON.parse(fs.readFileSync(`${intake.filePath(f)}.extract.json`, 'utf8')).text }); } catch { /* extract missing */ } }
      if (includeRaw) entries.push({ name: `files/${zipName(f)}`, file: intake.filePath(f), size: f.size });
    }
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${mid}-module-pack.zip"` });
    const stream = zipStream(entries);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
  // Fixed tester account (real starts only): username PORTAL_TESTER_USER (default "tester"), password PORTAL_TESTER_PASSWORD
  // or, if unset, the administrator's password. Applied when configured, or when a "tester" account already exists.
  if (options.bootstrap === true) {
    const testerUser = process.env.PORTAL_TESTER_USER, testerPassword = process.env.PORTAL_TESTER_PASSWORD || process.env.PORTAL_ADMIN_PASSWORD;
    const wanted = testerUser || process.env.PORTAL_TESTER_PASSWORD || store.userByName('tester');
    if (wanted && testerPassword) {
      try { const t = users.reconcile({ username: testerUser || 'tester', password: testerPassword }, 'tester'); syncLegacyMembership(t.id, t.role, { username: 'system' }); fixedAccounts.push({ kind: 'tester', username: t.username, password: testerPassword }); }
      catch (e) { logger?.(`Could not apply the fixed tester account: ${e.message}`, 'stderr'); }
    }
  }
  const sessionsService = { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts };
  const accessService = { accessFor, authorize, modulePermission, runPermission, enforce, pidOf, DENIED };
  const membership = { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless };
  const helpers = { now, audit, credentialsFor, publicEnvironment, getModule, getProduct, productName, productList, envsFor, readinessFor, gateError, record, inModule, stampCase, fourEyes, fourEyesActive, CONTENT_FIELDS, emptyToNull, sorted, caseContent, runScope, runEvent, getRun, visibleRun, summaryRun, createRun, sendPack };
  return { config, options, dataDir, host, token, isLocalHost, lock, store, users, intake, agent, queue, jobs, fixedAccounts, sessions: sessionsService, access: accessService, membership,
    environments, settings, logger, qaRoot, specRoot, helpers };
}
