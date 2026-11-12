import { decode } from './shared.mjs';

export const intakeSchema = `
    CREATE TABLE IF NOT EXISTS intake_files (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS intake_files_module ON intake_files(module_id);`;

// SHA-256 of each uploaded file (added after the table existed, so migrated in place).
export function migrateIntake(db) {
  if (!db.prepare('PRAGMA table_info(intake_files)').all().some(c => c.name === 'sha256')) db.exec('ALTER TABLE intake_files ADD COLUMN sha256 TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS intake_files_sha ON intake_files(module_id, sha256)');
}

export function createIntakeRepo(db) {
  return {
    // Intake file metadata.
    intakeFiles: moduleId => db.prepare('SELECT document FROM intake_files WHERE module_id=? ORDER BY rowid').all(moduleId).map(decode),
    intakeFile: (moduleId, id) => { const f = decode(db.prepare('SELECT document FROM intake_files WHERE id=?').get(id)); return f && f.moduleId === moduleId ? f : undefined; },
    saveIntakeFile: file => db.prepare('INSERT INTO intake_files (id,module_id,document,sha256) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document, sha256=excluded.sha256').run(file.id, file.moduleId, JSON.stringify(file), file.sha256 ?? null),
    intakeFileBySha: (moduleId, sha256) => decode(db.prepare('SELECT document FROM intake_files WHERE module_id=? AND sha256=? ORDER BY rowid LIMIT 1').get(moduleId, String(sha256))),
    intakeFilesWithoutSha: () => db.prepare('SELECT document FROM intake_files WHERE sha256 IS NULL ORDER BY rowid').all().map(decode),
    pendingIntakeFiles: () => db.prepare('SELECT document FROM intake_files ORDER BY rowid').all().map(decode).filter(f => f.extract === 'pending'),
    deleteIntakeFile: id => db.prepare('DELETE FROM intake_files WHERE id=?').run(id),
  };
}
