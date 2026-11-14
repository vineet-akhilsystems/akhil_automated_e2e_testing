import { randomUUID } from 'node:crypto';
import { check, textValue } from './registry.mjs';

// Scheduled runs: "run this module's automated cases every weekday at 02:00". The portal checks every 30 seconds while it runs.
// A schedule fires at most once per calendar day. If the portal was off at the scheduled time, it fires when the portal next
// starts that day (catch-up), so a nightly smoke run is not silently skipped by a restart.
const KEY = 'schedules';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Pure: is this schedule due at `now`? (server local time) */
export function isDue(schedule, now = new Date()) {
  if (!schedule.enabled || schedule.lastFiredOn === dateKey(now)) return false;
  if (!schedule.days.includes(now.getDay())) return false;
  const [h, m] = schedule.time.split(':').map(Number);
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

export function createSchedules(store, { start, logger = null, users = () => [], now = () => new Date() } = {}) {
  const read = () => { try { return JSON.parse(store.db.prepare('SELECT value FROM meta WHERE key=?').get(KEY)?.value ?? '[]'); } catch { return []; } };
  const write = list => store.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(list));
  let timer = null, busy = false;

  function normalize(body, user) {
    const time = String(body.time ?? '');
    check(HHMM.test(time), 'Enter the time as HH:MM, for example 02:00.');
    const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
    check(days.length > 0, 'Choose at least one day.');
    check(typeof body.moduleId === 'string' && body.moduleId, 'Choose a module.');
    check(typeof body.environmentId === 'string' && body.environmentId, 'Choose a login profile.');
    return { name: textValue(body.name, 'Schedule name', 120, true), moduleId: body.moduleId, environmentId: body.environmentId, time, days,
      enabled: body.enabled !== false, createdBy: user.id, createdByName: user.username };
  }

  const api = {
    list: () => read(),
    create(body, user) {
      const item = { id: randomUUID(), ...normalize(body, user), createdAt: new Date().toISOString(), lastFiredOn: null, lastRunId: null, lastError: null };
      write([...read(), item]);
      return item;
    },
    /** `{ enabled }` alone just toggles; anything else is validated as a full edit. The creator stays the owner. */
    update(id, body, user) {
      const list = read(), at = list.findIndex(s => s.id === id);
      check(at >= 0, 'Schedule not found.', 404);
      const toggleOnly = body.enabled !== undefined && Object.keys(body).length === 1;
      const next = toggleOnly ? { ...list[at], enabled: Boolean(body.enabled) } : { ...list[at], ...normalize({ ...list[at], ...body }, user), createdBy: list[at].createdBy, createdByName: list[at].createdByName };
      list[at] = next;
      write(list);
      return next;
    },
    remove(id) {
      const list = read();
      check(list.some(s => s.id === id), 'Schedule not found.', 404);
      write(list.filter(s => s.id !== id));
    },
    /** Fire everything that is due. Returns the schedules that fired. */
    async tick() {
      if (busy) return [];
      busy = true;
      try {
        const fired = [];
        for (const schedule of read()) {
          if (!isDue(schedule, now())) continue;
          const patch = { lastFiredOn: dateKey(now()) };
          try {
            const owner = users().find(u => u.id === schedule.createdBy) ?? (schedule.createdBy === 'local' ? { id: 'local', username: 'local', role: 'admin', displayName: 'Local access' } : null);
            check(owner, 'The person who created this schedule no longer has an account.');
            const run = await start(schedule, owner);
            Object.assign(patch, { lastRunId: run.id, lastError: null });
            logger?.(`[schedule] "${schedule.name}" started run ${run.id.slice(0, 8)}`);
          } catch (error) {
            Object.assign(patch, { lastError: String(error.message ?? error).slice(0, 300) });
            logger?.(`[schedule] "${schedule.name}" could not start: ${patch.lastError}`, 'stderr');
          }
          write(read().map(s => (s.id === schedule.id ? { ...s, ...patch } : s)));
          fired.push({ ...schedule, ...patch });
        }
        return fired;
      } finally { busy = false; }
    },
    begin(intervalMs = 30000) {
      if (timer) return;
      timer = setInterval(() => { api.tick().catch(() => {}); }, intervalMs);
      timer.unref?.();
      setTimeout(() => api.tick().catch(() => {}), 2000).unref?.();
    },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}
