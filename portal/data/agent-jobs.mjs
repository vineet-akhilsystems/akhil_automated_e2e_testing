import { decode } from './shared.mjs';

export const agentJobsSchema = `
    CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY, module_id TEXT NOT NULL, started_at TEXT NOT NULL, document TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS agent_jobs_module ON agent_jobs(module_id, started_at);`;

export function createAgentJobsRepo(db) {
  return {
    // Agent job history (survives restarts).
    saveAgentJob: job => db.prepare('INSERT INTO agent_jobs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(job.id, job.moduleId, job.startedAt, JSON.stringify(job)),
    agentJob: id => decode(db.prepare('SELECT document FROM agent_jobs WHERE id=?').get(String(id))),
    agentJobs: (moduleId, limit = 20) => db.prepare('SELECT document FROM agent_jobs WHERE module_id=? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(moduleId, limit).map(decode),
    // Jobs still 'running' belong to a process that no longer exists: keep them with their log, mark them interrupted.
    interruptAgentJobs(message) {
      let count = 0;
      for (const row of db.prepare("SELECT id, document FROM agent_jobs WHERE json_extract(document,'$.status')='running'").all()) {
        const job = JSON.parse(row.document), at = new Date().toISOString();
        job.status = 'interrupted'; job.message = message; job.finishedAt = at;
        job.log = [...(job.log ?? []), { t: at, text: message }].slice(-400);
        db.prepare('UPDATE agent_jobs SET document=? WHERE id=?').run(JSON.stringify(job), row.id); count++;
      }
      return count;
    },
  };
}
