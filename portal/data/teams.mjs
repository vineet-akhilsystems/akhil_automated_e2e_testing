import { decode } from './shared.mjs';

export const teamsSchema = `
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(team_id,user_id));
    CREATE INDEX IF NOT EXISTS team_members_user ON team_members(user_id);`;

export function createTeamsRepo(db) {
  return {
    // Teams and their members (access control).
    teams: () => db.prepare('SELECT document FROM teams ORDER BY rowid').all().map(decode),
    team: id => decode(db.prepare('SELECT document FROM teams WHERE id=?').get(String(id))),
    saveTeam: team => db.prepare('INSERT INTO teams VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(team.id, JSON.stringify(team)),
    deleteTeam(id) {
      db.prepare('DELETE FROM team_members WHERE team_id=?').run(id);
      db.prepare("DELETE FROM memberships WHERE subject_type='team' AND subject_id=?").run(id);
      db.prepare('DELETE FROM teams WHERE id=?').run(id);
    },
    teamMemberIds: teamId => db.prepare('SELECT user_id FROM team_members WHERE team_id=? ORDER BY rowid').all(teamId).map(r => r.user_id),
    teamMemberRows: () => db.prepare('SELECT team_id, user_id FROM team_members').all(),
    teamIdsOfUser: userId => db.prepare('SELECT team_id FROM team_members WHERE user_id=?').all(String(userId)).map(r => r.team_id),
    addTeamMember: (teamId, userId) => db.prepare('INSERT OR IGNORE INTO team_members VALUES (?,?)').run(teamId, userId),
    removeTeamMember: (teamId, userId) => db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(teamId, userId),
    removeUserFromAllTeams: userId => db.prepare('DELETE FROM team_members WHERE user_id=?').run(userId),
  };
}
