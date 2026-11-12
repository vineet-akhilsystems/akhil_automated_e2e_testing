import { decode } from './shared.mjs';

export const runsSchema = `
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, document TEXT NOT NULL);`;

export function createRunsRepo(db) {
  return {
    runs: () => db.prepare('SELECT document FROM runs ORDER BY rowid DESC').all().map(decode),
    run: id => decode(db.prepare('SELECT document FROM runs WHERE id=?').get(id)),
    saveRun: run => db.prepare('INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(run.id, JSON.stringify(run)),
  };
}
