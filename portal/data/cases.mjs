import { decode } from './shared.mjs';
import { check } from '../registry.mjs';

export const casesSchema = `
    CREATE TABLE IF NOT EXISTS cases (module_id TEXT NOT NULL REFERENCES modules(id), id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(module_id,id));`;

export function createCasesRepo(db, store) {
  return {
    cases: id => db.prepare('SELECT document FROM cases WHERE module_id=? ORDER BY rowid').all(id).map(decode),
    case: (moduleId, id) => decode(db.prepare('SELECT document FROM cases WHERE module_id=? AND id=?').get(moduleId, id)),
    saveCase(moduleId, value, version) {
      const old = store.case(moduleId, value.id);
      check(!old || old.version === version, 'This case changed or its ID already exists. Reload before saving.', 409);
      const result = { ...value, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.prepare('INSERT INTO cases VALUES (?,?,?) ON CONFLICT(module_id,id) DO UPDATE SET document=excluded.document').run(moduleId, result.id, JSON.stringify(result));
      return result;
    },
    deleteCase(moduleId, id, ignoreIds = new Set()) {
      const old = store.case(moduleId, id);
      check(old, 'Case not found.', 404);
      const refPattern = new RegExp(`\\{\\{\\w+@${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`);
      const dependents = store.cases(moduleId).filter(c => c.id !== id && !ignoreIds.has(c.id) && refPattern.test(JSON.stringify(c))).map(c => c.id);
      check(!dependents.length, `Cannot delete ${id} because other cases depend on it: ${dependents.join(', ')}.`, 409);
      db.prepare('DELETE FROM cases WHERE module_id=? AND id=?').run(moduleId, id);
      return { deleted: id };
    },
  };
}
