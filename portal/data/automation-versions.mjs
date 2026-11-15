import { decode } from './shared.mjs';

export const automationVersionsSchema = `
    CREATE TABLE IF NOT EXISTS automation_versions (module_id TEXT NOT NULL, number INTEGER NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL,
      UNIQUE(module_id, hash), UNIQUE(module_id, number));`;

export function createAutomationVersionsRepo(db) {
  return {
    // Automation versions: file paths and hashes only, never file contents. Newest first.
    automationVersions: moduleId => db.prepare('SELECT document FROM automation_versions WHERE module_id=? ORDER BY number DESC').all(String(moduleId)).map(decode),
    automationVersionByHash: (moduleId, hash) => decode(db.prepare('SELECT document FROM automation_versions WHERE module_id=? AND hash=?').get(String(moduleId), String(hash))),
    automationVersionByNumber: (moduleId, number) => decode(db.prepare('SELECT document FROM automation_versions WHERE module_id=? AND number=?').get(String(moduleId), Number(number))),
    // Inserts a new version; updates the document of an existing (module, number) row (used to annotate git details).
    saveAutomationVersion: record => db.prepare('INSERT INTO automation_versions VALUES (?,?,?,?,?) ON CONFLICT(module_id, number) DO UPDATE SET document=excluded.document')
      .run(record.moduleId, record.number, record.hash, record.createdAt, JSON.stringify(record)),
  };
}
