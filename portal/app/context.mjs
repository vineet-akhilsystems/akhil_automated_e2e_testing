import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveModuleFolder } from '../module-layout.mjs';
import { registerAutomationVersion, annotateAutomationVersion } from '../automation-versions.mjs';
import { ROOT, adapters, check, textValue, validateCase, resolveCases, HttpError } from '../registry.mjs';
import { openStore } from '../store.mjs';
import { pluginFor, plugins } from '../modules/index.mjs';
import { createQueue } from '../queue.mjs';
import { TERMINAL } from '../quality.mjs';
import { loginSchema } from '../environment-settings.mjs';
import { normalizeAppVersion } from '../versioning.mjs';
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
import { createNotifications } from '../notifications.mjs';
import { createSchedules } from '../schedules.mjs';
import { createTickets } from '../tickets.mjs';
import { createReportJobs } from '../reports/jobs.mjs';

const now = () => new Date().toISOString();

// Builds every dependency of the portal once. Route modules receive this object and never construct their own.
export function createContext(options = {}) {
  const config = loadConfig(options);
  const { dataDir, host, token, isLocalHost, environments, settings } = config;
  const lock = acquireLock(dataDir);
  const store = openStore(dataDir, { snapshotFile: options.snapshotFile, log: options.logger });
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
  // Repo-like roots (they contain the qa/ and tests/ folders): module discovery output lives in <layoutRoot>/<resolveModuleFolder('qa', product, id)>/discovery,
  // generated specs under specRoot. Both injectable for tests.
  const layoutRoot = path.resolve(options.layoutRoot ?? ROOT), specRoot = path.resolve(options.specRoot ?? ROOT);
  const intake = createIntake({ dataDir, store, maxMb: options.intakeMaxMb, exec: options.exec });
  // Startup housekeeping (never blocks the server): fingerprint older uploads, then re-queue extractions left 'pending' by a restart.
  setImmediate(() => { intake.backfill().catch(() => {}).then(() => intake.resume()).catch(() => {}); });
  const jobs = new Map();
  const knowledgeRoot = path.resolve(options.knowledgeRoot ?? ROOT);
  const agent = options.agent ?? createAgentRunner({ dataDir, store, intake, ingest: args => saveExternalInsights({ ...args, environments: envsFor(args.module?.productId ?? 'augastam') }), knowledgeRootDir: knowledgeRoot, referenceDir: path.join(ROOT, ...(plugins().find(p => p.agent?.referenceDir)?.agent.referenceDir ?? resolveModuleFolder(ROOT, 'tests', 'augastam', 'registration')).split('/')), discoveryRoot: layoutRoot, env: options.env ?? process.env, logger, ...options.agentOptions });
  const credentialsFor = e => e.managed ? settings.credentials(e.id)
    : Object.fromEntries(Object.entries(loginSchema(e.productId)?.fields ?? {}).map(([key, variable]) => [key, process.env[variable] ?? '']));
  // Alerts fire when a run ends; `notifications` is created below, before any run can finish.
  const queue = createQueue(store, dataDir, environments, options.launch, logger, credentialsFor, { retries: options.retries, workers: options.workers, onFinish: run => notifications.runFinished(run), beforeStart: run => restampAutomationVersion(run) });
  const reportJobs = createReportJobs({ store, dirFor: queue.dirFor, logger, ...options.reportJobOptions }); // reportJobOptions: test seam (build, maxRunning)
  const { principal, startSession, dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts } = createSessions({ store, users, token });
  const audit = user => ({ user: user.username, at: now() });
  const { accessFor, authorize, modulePermission, runPermission, enforce, pidOf, DENIED } = createAccess({ store, users, environments });
  const fourEyes = module => module.settings?.requireSecondApprover !== false;
  // With no accounts (open or access-key mode) there is only one local user, so a second approver cannot exist: the rule applies once accounts exist.
  const fourEyesActive = module => fourEyes(module) && users.exists();
  // Per person: the rule is strict for you unless you hold 'case.approve.own' (Admins by default; anyone else when granted it).
  // Holding it does not make you a reviewer: approving still needs 'case.review'.
  const mayApproveOwn = (module, acc) => acc.module(module).has('case.approve.own');
  const strictFor = (module, acc) => fourEyesActive(module) && !mayApproveOwn(module, acc);
  // Fields that change what a case does or means. Metadata (priority, category, enabled, notes) can change without a new approval.
  const CONTENT_FIELDS = ['title', 'steps', 'input', 'action', 'base', 'expected', 'target', 'requirement', 'preconditions', 'registrationType', 'mode'];
  const emptyToNull = v => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) ? null : v);
  const sorted = v => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);
  // `input` keeps the order of its keys (fields are filled in that order), so reordering it counts as a change; everything else ignores key order.
  const caseContent = c => JSON.stringify([sorted(Object.fromEntries(CONTENT_FIELDS.filter(k => k !== 'input').map(k => [k, emptyToNull(c?.[k])]))), JSON.stringify(emptyToNull(c?.input) ?? null)]);
  // What a content change does to the stored decision (c = the changed case, prev = the case before the change).
  // Strict users: back to draft. Holders of case.approve.own + case.review (rule active): if they created the case or are its approver of record the
  // change is covered by a NEW approval in their name (self: true); on someone else's approved case it goes back to draft, and they can approve it at once through the review route.
  function reviewAfterContentChange(c, prev, user, module, acc) {
    if (strictFor(module, acc)) { c.reviewStatus = 'draft'; delete c.reviewedBy; return c; }
    if (fourEyesActive(module) && acc.module(module).has('case.review') && (prev.reviewStatus ?? 'approved') === 'approved') {
      const mine = who => who?.user === user.username;
      if (mine(prev.createdBy) || mine(prev.reviewedBy)) { c.reviewStatus = 'approved'; c.reviewedBy = { ...audit(user), decision: 'approved', self: true }; }
      else { c.reviewStatus = 'draft'; delete c.reviewedBy; }
    }
    return c;
  }
  // Cases a non-reviewer touches always return to review; reviewers keep the stored decision.
  // With the second-approver rule a case is never auto-approved for its own author.
  function stampCase(validated, existing, user, module, acc) {
    const reviewer = acc.module(module).has('case.review'), stamp = audit(user), strict = strictFor(module, acc), selfRule = fourEyesActive(module) && !strict;
    const c = { ...validated };
    delete c.reviewStatus; delete c.reviewedBy; delete c.createdBy; delete c.contentBy;
    // contentBy: who last changed what the case does. They can never approve it, even if someone else edits metadata afterwards.
    if (!existing) {
      const want = ['draft', 'rejected'].includes(validated.reviewStatus) ? validated.reviewStatus : 'approved';
      c.reviewStatus = reviewer && !strict ? want : 'draft'; c.createdBy = stamp; c.contentBy = stamp;
      // self: true marks an approval the rule would otherwise have refused: the author approved their own work under 'case.approve.own'.
      if (reviewer && !strict && want === 'approved') c.reviewedBy = { ...stamp, decision: 'approved', ...(selfRule ? { self: true } : {}) };
    } else {
      if (existing.createdBy) c.createdBy = existing.createdBy;
      if (existing.contentBy) c.contentBy = existing.contentBy;
      if (existing.reviewedBy) c.reviewedBy = existing.reviewedBy;
      if (caseContent(existing) !== caseContent(c)) c.contentBy = stamp;
      if (existing.reviewStatus !== undefined) c.reviewStatus = existing.reviewStatus;
      if (!reviewer && (existing.reviewStatus ?? 'approved') !== 'draft') { c.reviewStatus = 'draft'; delete c.reviewedBy; }
      // An approval covers the content that was approved: changing it sends the case back to review, whoever edits it.
      if (caseContent(existing) !== caseContent(c)) reviewAfterContentChange(c, existing, user, module, acc);
    }
    c.updatedBy = stamp;
    return c;
  }
  const { subjectOf, memberView, record, trail, inModule, parseGrant, parseRole, assertCovers, leadState, modulesWithLead, modulesReachable, keepingLeads, modulesOfScope, scopeAudit, isSelf, grantCap, grantNeed, assertWithinCap, teamMemberships, memberNames, assertTeamAdd, assertTeamManage, recordViaTeam, addMember, syncLegacyMembership, auditLeaderless } = createMembership({ store, access: { pidOf, DENIED }, users, audit });
  // Login-profile identity fields (username, tenant, facility, role) are shown only to people who run tests there; others get name, url and session status.
  const publicEnvironment = (e, showLogin = true) => {
    let session = 'missing';
    const schema = loginSchema(e.productId), file = schema?.expiryFile ? path.join(e.authDir, schema.expiryFile) : null;
    if (schema && schema.sessionFiles.every(f => fs.existsSync(path.join(e.authDir, f)))) {
      session = 'saved';
      if (file) try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const jwt = String(saved.token ?? '').replace(/^Bearer /, '');
        const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        if (claims.exp && claims.exp * 1000 < Date.now()) session = 'expired';
      } catch { /* A saved opaque token can only be verified by the application. */ }
    }
    const credentials = credentialsFor(e);
    return { id: e.id, name: e.name, productId: e.productId ?? 'augastam', url: e.url, appVersion: e.appVersion ?? '', session, version: e.version ?? 0,
      loginConfigured: Boolean(schema) && Object.keys(schema.fields).every(k => Boolean(credentials?.[k])),
      loginSource: e.managed ? 'settings' : 'server', passwordSaved: Boolean(credentials?.password),
      login: Object.fromEntries(Object.keys(schema?.fields ?? {}).filter(k => k !== 'password').map(k => [k, showLogin ? credentials?.[k] ?? '' : ''])) };
  };
  const getModule = id => { const m = store.module(id); check(m, 'Not found.', 404); return m; };
  // The readiness checklist, computed from live state on every call (nothing cached).
  function readinessFor(module) {
    const id = module.id, productId = module.productId ?? 'augastam', setup = module.setup ?? null;
    let moduleDirRel; try { moduleDirRel = resolveModuleFolder(layoutRoot, 'qa', productId, id); } catch (e) { throw new HttpError(409, `The folder for module "${module.name ?? id}" cannot be located: ${e.message}`); }
    const discoveryDir = path.join(layoutRoot, ...moduleDirRel.split('/'), 'discovery'), fieldsFile = path.join(discoveryDir, 'fields-default.json');
    let discoveryExists = false, discoveryStale = false, discoveryEmpty = false;
    if (pluginFor(id)?.discovery) { try { discoveryExists = fs.readdirSync(discoveryDir).length > 0; } catch { /* none */ } }
    else {
      try {
        const mtime = fs.statSync(fieldsFile).mtimeMs, confirmed = setup?.confirmedAt ? Date.parse(setup.confirmedAt) : NaN;
        if (Number.isFinite(confirmed) && mtime >= confirmed) {
          // A discovery run that found nothing still writes the file; it only counts once it holds at least one field.
          let found = 0; try { const f = JSON.parse(fs.readFileSync(fieldsFile, 'utf8')); found = Array.isArray(f) ? f.length : Object.keys(f ?? {}).length; } catch { /* unreadable: treated as empty */ }
          if (found > 0) discoveryExists = true; else discoveryEmpty = true;
        } else discoveryStale = true;
      } catch { /* no discovery file */ }
    }
    const adapter = module.adapter ? adapters[module.adapter] : null;
    const specPath = adapter?.spec ? path.resolve(specRoot, adapter.spec) : null;
    const specExists = Boolean(specPath && specPath.startsWith(specRoot + path.sep) && fs.existsSync(specPath));
    const smokePassed = store.runs().some(r => r.module?.id === id && r.kind !== 'authentication' && r.mode === 'automated' && (r.productId ?? 'augastam') === productId
      && TERMINAL.includes(r.status) && (r.results ?? []).some(x => x.status === 'PASS') && r.cases?.some(c => c.mode === 'automated' && c.action !== 'unavailable'));
    return readiness({ module, product: store.product(productId) ?? { id: productId }, sources: store.intakeFiles(id), insights: store.insights(id), cases: store.cases(id), setup,
      discoveryExists, discoveryStale, discoveryEmpty, adapterConnected: Boolean(adapter), specExists, smokePassed, jobs: agent.list(id) });
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
    const { cases, module, profile, ...rest } = r;
    // The list carries the profile summary only; the per-response keys (hundreds) stay in the single-run detail.
    if (profile) { const { keys, ...brief } = profile; rest.profile = { ...brief, keyCount: Object.keys(keys ?? {}).length }; }
    return { ...rest, module: { id: module.id, name: module.name, area: module.area }, total: cases.length };
  };
  // Test-only seams (never set in production): options.automationRoot (repo root to fingerprint), options.automationFingerprint (replaces the fingerprint function), options.automationGit (replaces the git helper).
  // Registers (or finds) the automation version for the files as they are now. Failing to do so must never block a run: returns undefined.
  function stampAutomationVersion(module, by) {
    try {
      const root = options.automationRoot ?? ROOT;
      const version = registerAutomationVersion({ store, root, productId: module.productId ?? 'augastam', moduleId: module.id, dir: module.adapter ?? module.id, by, trigger: 'run', fingerprint: options.automationFingerprint });
      if (version.pendingGit) annotateAutomationVersion({ store, root, moduleId: module.id, number: version.number, git: options.automationGit }).catch(e => logger?.(`Automation version git details failed: ${e.message}`, 'stderr'));
      return { number: version.number, hash: version.hash };
    } catch (e) { logger?.(`Automation version not recorded: ${e.message}`, 'stderr'); return undefined; }
  }
  // Runs wait in the queue; the files may change before one starts. The queue calls this just before it starts Playwright: if the
  // files no longer match the queue-time stamp, the run is restamped. If fingerprinting fails, the queue-time stamp stays.
  function restampAutomationVersion(run) {
    if (run.kind !== 'tests' || run.mode !== 'automated') return;
    const fresh = stampAutomationVersion(run.module, run.createdBy?.user ?? null);
    if (fresh && fresh.hash !== run.automationVersion?.hash) run.automationVersion = fresh;
  }
  function createRun(body, user = LOCAL_USER, { inheritVersion, ...extra } = {}) {
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
    // A re-run (inheritVersion is set by the server only, never read from the request) keeps the original run's version, even when that was none.
    const typed = normalizeAppVersion(body.appVersion), appVersion = inheritVersion !== undefined ? inheritVersion : typed ? { label: typed, source: 'run' } : environment.appVersion ? { label: environment.appVersion, source: 'profile' } : null;
    // Validate the name before anything is registered, so a rejected request never creates an automation version.
    const runName = textValue(body.name, 'Run name', 200, true);
    const automationVersion = body.mode === 'automated' ? stampAutomationVersion(module, user?.username ?? null) : undefined;
    const run = { id: randomUUID(), name: runName, environmentId: environment.id,
      environmentName: environment.name, environmentUrl: environment.url, mode: body.mode, kind: 'tests', productId, productName: productName(productId),
      module: structuredClone(module), ...(appVersion ? { appVersion } : {}), ...(automationVersion ? { automationVersion } : {}), cases, results: [], ...(body.accessibility === true && body.mode === 'automated' ? { accessibility: true } : {}), status: body.mode === 'manual' ? 'manual' : 'queued', createdAt: now(), createdBy: audit(user), ...extra,
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
  const notifications = createNotifications(store, { fetchImpl: options.fetch, logger, baseUrl: () => process.env.PORTAL_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORTAL_PORT ?? 4173}` });
  // A schedule starts a run of the module's approved, executable automated cases, as the person who created the schedule.
  const startAll = async (target, owner, extra = {}) => {
    const caseIds = store.cases(target.moduleId).filter(c => c.mode === 'automated' && c.enabled !== false && (c.reviewStatus ?? 'approved') === 'approved' && c.action !== 'unavailable').map(c => c.id);
    check(caseIds.length > 0, 'This module has no approved automated cases to run.');
    return createRun({ moduleId: target.moduleId, environmentId: target.environmentId, mode: 'automated', caseIds, name: target.name }, owner, extra);
  };
  const startScheduled = async (schedule, owner) => {
    check(!store.runs().some(r => r.scheduleId === schedule.id && ['queued', 'running'].includes(r.status)), 'The previous scheduled run is still in progress.');
    return startAll({ moduleId: schedule.moduleId, environmentId: schedule.environmentId, name: `${schedule.name} (${new Date().toLocaleDateString()})` }, owner, { scheduleId: schedule.id });
  };
  const tickets = createTickets(store, { fetchImpl: options.fetch, logger, baseUrl: () => process.env.PORTAL_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORTAL_PORT ?? 4173}` });
  const schedules = createSchedules(store, { start: startScheduled, logger, users: () => store.users(), now: options.now });
  const helpers = { now, audit, credentialsFor, publicEnvironment, getModule, getProduct, productName, productList, envsFor, readinessFor, gateError, record, inModule, stampCase, reviewAfterContentChange, fourEyes, fourEyesActive, strictFor, mayApproveOwn, CONTENT_FIELDS, emptyToNull, sorted, caseContent, runScope, runEvent, getRun, visibleRun, summaryRun, createRun, startAll, sendPack };
  return { config, options, dataDir, host, token, isLocalHost, lock, store, users, intake, agent, queue, notifications, schedules, tickets, reportJobs, knowledgeRoot, jobs, fixedAccounts, sessions: sessionsService, access: accessService, membership,
    environments, settings, logger, layoutRoot, specRoot, helpers };
}
