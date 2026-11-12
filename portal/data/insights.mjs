import { decode } from './shared.mjs';

export const insightsSchema = `
    CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS insights_module ON insights(module_id);`;

const keyOf = v => String(v?.name ?? v?.text ?? '').trim().toLowerCase();
// Counts what a new insights document adds compared with the previous one.
function changeSummary(prev, doc) {
  const known = (list, ) => new Set((list ?? []).map(keyOf));
  const added = key => { const seen = known(prev?.[key]); return (doc[key] ?? []).filter(x => !seen.has(keyOf(x))).length; };
  const addedFields = added('fields'), addedRules = added('rules'), addedCases = (doc.draftCaseIds ?? []).length;
  return { addedFields, addedRules, addedCases, summary: `${prev ? 'Compared with the previous version' : 'First version'}: +${addedFields} field(s), +${addedRules} rule(s), +${addedCases} draft case(s).` };
}

export function createInsightsRepo(db, store) {
  return {
    insights: moduleId => decode(db.prepare('SELECT document FROM insights WHERE module_id=? ORDER BY rowid DESC LIMIT 1').get(moduleId)),
    insightsHistory: moduleId => db.prepare('SELECT document FROM insights WHERE module_id=? ORDER BY rowid DESC').all(moduleId).map(decode),
    // Every saved insights document is a new version: version, basedOn (previous id), coveredSources (this analysis plus what the previous version covered) and changeSummary.
    // Returns the stored document.
    saveInsights(doc) {
      const existing = decode(db.prepare('SELECT document FROM insights WHERE id=?').get(doc.id));
      let out = doc;
      if (!existing && doc.version === undefined) {
        const prev = store.insights(doc.moduleId), covered = doc.coveredSources ?? [], now = new Set(covered.map(c => c.fileId));
        const carried = (prev?.coveredSources ?? (prev?.sources ?? []).map(x => ({ fileId: x.fileId, sha256: null, name: x.name }))).filter(c => !now.has(c.fileId));
        const version = (prev ? (prev.version ?? db.prepare('SELECT COUNT(*) AS n FROM insights WHERE module_id=?').get(doc.moduleId).n) : 0) + 1;
        out = { ...doc, version, basedOn: prev?.id ?? null, coveredSources: [...covered, ...carried], changeSummary: changeSummary(prev, doc) };
      }
      db.prepare('INSERT INTO insights VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(out.id, out.moduleId, JSON.stringify(out));
      return out;
    },
  };
}
