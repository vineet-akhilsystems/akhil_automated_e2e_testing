import { decode } from './shared.mjs';
import { check } from '../registry.mjs';

export const modulesSchema = `
    CREATE TABLE IF NOT EXISTS modules (id TEXT PRIMARY KEY, document TEXT NOT NULL);`;

export function createModulesRepo(db, store) {
  return {
    modules: () => db.prepare('SELECT document FROM modules ORDER BY rowid').all().map(decode),
    module: id => decode(db.prepare('SELECT document FROM modules WHERE id=?').get(id)),
    saveModule(module, version) {
      const old = store.module(module.id);
      check(!old || old.version === version, 'This module changed. Reload before saving.', 409);
      const result = { ...module, settings: { requireSecondApprover: true, ...(old?.settings ?? {}), ...(module.settings ?? {}) }, version: (old?.version ?? 0) + 1, createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.prepare('INSERT INTO modules VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(result.id, JSON.stringify(result));
      return result;
    },
  };
}
