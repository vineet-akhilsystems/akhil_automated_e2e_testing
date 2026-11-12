import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { plugins } from './modules/index.mjs';
import './modules/registration/index.mjs'; // registers the built-in registration plugin (seed hook) before openStore runs
import { modulesSchema, createModulesRepo } from './data/modules.mjs';
import { casesSchema, createCasesRepo } from './data/cases.mjs';
import { runsSchema, createRunsRepo } from './data/runs.mjs';
import { usersSchema, createUsersRepo } from './data/users.mjs';
import { intakeSchema, migrateIntake, createIntakeRepo } from './data/intake.mjs';
import { insightsSchema, createInsightsRepo } from './data/insights.mjs';
import { productsSchema, createProductsRepo } from './data/products.mjs';
import { teamsSchema, createTeamsRepo } from './data/teams.mjs';
import { membershipsSchema, createMembershipsRepo } from './data/memberships.mjs';
import { auditSchema, createAuditRepo } from './data/audit.mjs';
import { agentJobsSchema, createAgentJobsRepo } from './data/agent-jobs.mjs';

// Facade over portal/data/*: opens the database, creates the schema, runs the migrations and
// returns one object composed from the per-table repositories.
export function openStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'portal.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;${modulesSchema}${casesSchema}${runsSchema}${usersSchema}${intakeSchema}${insightsSchema}${productsSchema}${teamsSchema}${membershipsSchema}${auditSchema}${agentJobsSchema}
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  migrateIntake(db);
  // Repositories that call other store methods get the composed object (filled in below, used lazily).
  const store = { db };
  Object.assign(store,
    createProductsRepo(db),
    createModulesRepo(db, store),
    createCasesRepo(db, store),
    createRunsRepo(db),
    createUsersRepo(db),
    createIntakeRepo(db),
    createInsightsRepo(db, store),
    createAgentJobsRepo(db),
    createTeamsRepo(db),
    createMembershipsRepo(db),
    createAuditRepo(db),
    {
      transaction(fn) {
        db.exec('BEGIN IMMEDIATE');
        try { const result = fn(); db.exec('COMMIT'); return result; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      },
      close: () => db.close(),
    });
  // Products: seed idempotently, then give anything created before products existed to Augastam (keeps data and versions).
  for (const p of [{ id: 'augastam', name: 'Augastam', description: 'Augastam EMR' }, { id: 'miracle', name: 'Miracle', description: 'Miracle' }]) {
    if (!store.product(p.id)) store.saveProduct(p);
  }
  db.exec(`UPDATE modules SET document=json_set(document,'$.productId','augastam') WHERE json_extract(document,'$.productId') IS NULL;
    UPDATE runs SET document=json_set(document,'$.productId',COALESCE(json_extract(document,'$.module.productId'),'augastam')) WHERE json_extract(document,'$.productId') IS NULL;`);
  for (const run of store.runs()) {
    if (run.productName !== undefined) continue;
    const name = store.product(run.productId)?.name;
    if (name) store.saveRun({ ...run, productName: name });
  }
  // Access control migration (idempotent): module settings default, and one-time conversion of legacy user roles
  // into product-level memberships on Augastam so day-one behaviour is unchanged.
  db.exec(`UPDATE modules SET document=json_set(document,'$.settings',json('{"requireSecondApprover":true}')) WHERE json_extract(document,'$.settings') IS NULL;`);
  if (!db.prepare("SELECT 1 FROM meta WHERE key='access-migration-1'").get()) {
    const preset = { tester: 'tester', ba: 'ba', viewer: 'viewer' };
    store.transaction(() => {
      for (const u of store.users()) {
        if (!preset[u.role]) continue;
        if (store.memberships().some(m => m.subjectType === 'user' && m.subjectId === u.id && m.scopeType === 'product' && m.scopeId === 'augastam')) continue;
        store.saveMembership({ id: randomUUID(), subjectType: 'user', subjectId: u.id, scopeType: 'product', scopeId: 'augastam', role: preset[u.role], overrides: {}, legacy: true, createdBy: 'migration', createdAt: new Date().toISOString() });
      }
      db.prepare("INSERT INTO meta VALUES ('access-migration-1', ?)").run(new Date().toISOString());
    });
  }
  // Cases saved before contentBy existed: treat whoever last saved (or created) them as the content author, once.
  if (!db.prepare("SELECT 1 FROM meta WHERE key='contentby-backfill-1'").get()) {
    store.transaction(() => {
      for (const row of db.prepare('SELECT module_id, id, document FROM cases').all()) {
        const doc = JSON.parse(row.document), author = doc.updatedBy ?? doc.createdBy;
        if (!doc.contentBy && author) db.prepare('UPDATE cases SET document=? WHERE module_id=? AND id=?').run(JSON.stringify({ ...doc, contentBy: author }), row.module_id, row.id);
      }
      db.prepare("INSERT INTO meta VALUES ('contentby-backfill-1', ?)").run(new Date().toISOString());
    });
  }
  // Insights saved before versioning: number them per module in save order (idempotent, one time).
  if (!db.prepare("SELECT 1 FROM meta WHERE key='insights-versions-1'").get()) {
    store.transaction(() => {
      const last = new Map(), count = new Map();
      for (const row of db.prepare('SELECT id, module_id, document FROM insights ORDER BY rowid').all()) {
        const doc = JSON.parse(row.document), n = (count.get(row.module_id) ?? 0) + 1; count.set(row.module_id, n);
        if (doc.version === undefined) {
          const next = { ...doc, version: n, basedOn: last.get(row.module_id) ?? null, coveredSources: (doc.sources ?? []).map(x => ({ fileId: x.fileId, sha256: null, name: x.name })) };
          db.prepare('UPDATE insights SET document=? WHERE id=?').run(JSON.stringify(next), row.id);
        }
        last.set(row.module_id, row.id);
      }
      db.prepare("INSERT INTO meta VALUES ('insights-versions-1', ?)").run(new Date().toISOString());
    });
  }
  // Only seed a brand-new database. The original JSON/Excel datasets stay untouched.
  if (!store.modules().length) store.transaction(() => {
    for (const plugin of plugins()) plugin.seed?.(store);
  });
  return store;
}
