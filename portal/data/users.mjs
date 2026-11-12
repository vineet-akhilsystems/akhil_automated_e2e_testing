import { decode } from './shared.mjs';

export const usersSchema = `
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, document TEXT NOT NULL);`;

export function createUsersRepo(db) {
  return {
    // Users (credentials are scrypt hashes inside the document; never returned by the API layer).
    users: () => db.prepare('SELECT document FROM users ORDER BY rowid').all().map(decode),
    user: id => decode(db.prepare('SELECT document FROM users WHERE id=?').get(id)),
    userByName: name => decode(db.prepare('SELECT document FROM users WHERE username=?').get(String(name).toLowerCase())),
    saveUser: user => db.prepare('INSERT INTO users VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username, document=excluded.document').run(user.id, user.username, JSON.stringify(user)),
    deleteUser: id => db.prepare('DELETE FROM users WHERE id=?').run(id),
  };
}
