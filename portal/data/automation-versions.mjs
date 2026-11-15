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
    latestAutomationVersion: moduleId => decode(db.prepare('SELECT document FROM automation_versions WHERE module_id=? ORDER BY number DESC LIMIT 1').get(String(moduleId))),
    // Plain INSERT: a duplicate (module, number) or (module, hash) THROWS, an existing version is never overwritten.
    insertAutomationVersion: record => db.prepare('INSERT INTO automation_versions VALUES (?,?,?,?,?)').run(record.moduleId, record.number, record.hash, record.createdAt, JSON.stringify(record)),
    // Merges a patch into one stored document (keys set to undefined are dropped); never touches the hash or number.
    updateAutomationVersion(moduleId, number, patch) {
      const current = decode(db.prepare('SELECT document FROM automation_versions WHERE module_id=? AND number=?').get(String(moduleId), Number(number)));
      if (!current) return undefined;
      const text = JSON.stringify({ ...current, ...patch, moduleId: current.moduleId, number: current.number, hash: current.hash });
      db.prepare('UPDATE automation_versions SET document=? WHERE module_id=? AND number=?').run(text, String(moduleId), Number(number));
      return JSON.parse(text);
    },
  };
}
