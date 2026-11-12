import { randomUUID } from 'node:crypto';

export function createSessions({ store, users, token }) {
  const sessions = new Map(), loginAttempts = new Map();
  const sessionId = req => /(?:^|; )portal_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  // Without user accounts the portal behaves as before (open, or one shared access token) and the caller acts as admin.
  const LOCAL_USER = { id: 'local', username: 'local', role: 'admin', displayName: 'Local access' };
  const principal = req => {
    const s = sessions.get(sessionId(req));
    const live = s && s.expires > Date.now();
    if (users.exists()) {
      if (!live || !s.userId) return null;
      const u = store.user(s.userId);
      return u && !u.disabled ? u : null;
    }
    return !token || live ? LOCAL_USER : null;
  };
  const sessionUser = u => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName });
  const startSession = (req, res, userId) => {
    const id = randomUUID(); sessions.set(id, { userId, expires: Date.now() + 12 * 3600000 });
    for (const [old, s] of sessions) if (s.expires < Date.now()) sessions.delete(old);
    res.setHeader('Set-Cookie', `portal_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
  };
  const dropSessions = (userId, except) => { for (const [id, s] of sessions) if (s.userId === userId && id !== except) sessions.delete(id); };
  return { principal, startSession, start: startSession, dropSessions, drop: dropSessions, sessions, sessionId, sessionUser, LOCAL_USER, attempts: loginAttempts };
}
