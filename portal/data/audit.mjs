import { decode } from './shared.mjs';

export const auditSchema = `
    CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_scope ON audit_log(scope_type,scope_id);
    CREATE INDEX IF NOT EXISTS audit_scope_seq ON audit_log(scope_type,scope_id,seq);`;

export function createAuditRepo(db) {
  return {
    audit(entry) {
      const doc = { at: new Date().toISOString(), actor: '', action: '', scopeType: '', scopeId: '', subject: null, detail: null, ...entry };
      db.prepare('INSERT INTO audit_log (scope_type,scope_id,document) VALUES (?,?,?)').run(doc.scopeType, doc.scopeId, JSON.stringify(doc));
      return doc;
    },
    auditLog({ scopeType, scopeId, limit = 200 } = {}) {
      const where = [], args = [];
      if (scopeType) { where.push('scope_type=?'); args.push(scopeType); }
      if (scopeId) { where.push('scope_id=?'); args.push(scopeId); }
      return db.prepare(`SELECT document FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`).all(...args, Math.min(limit, 200)).map(decode);
    },
  };
}
