import { decode } from './shared.mjs';

export const membershipsSchema = `
    CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(subject_type,subject_id,scope_type,scope_id));
    CREATE INDEX IF NOT EXISTS memberships_scope ON memberships(scope_type,scope_id);`;

export function createMembershipsRepo(db) {
  return {
    memberships: () => db.prepare('SELECT document FROM memberships ORDER BY rowid').all().map(decode),
    membershipsFor: (scopeType, scopeId) => db.prepare('SELECT document FROM memberships WHERE scope_type=? AND scope_id=? ORDER BY rowid').all(scopeType, scopeId).map(decode),
    membership: id => decode(db.prepare('SELECT document FROM memberships WHERE id=?').get(String(id))),
    saveMembership: m => db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(m.id, m.subjectType, m.subjectId, m.scopeType, m.scopeId, JSON.stringify(m)),
    deleteMembership: id => db.prepare('DELETE FROM memberships WHERE id=?').run(id),
    deleteMembershipsForSubject: (type, id) => db.prepare('DELETE FROM memberships WHERE subject_type=? AND subject_id=?').run(type, id),
  };
}
