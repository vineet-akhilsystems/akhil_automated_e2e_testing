import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ROOT, check, HttpError } from './registry.mjs';
import { json, applySecurityHeaders } from './http/respond.mjs';
import { serveStatic } from './http/static.mjs';
import { createContext } from './app/context.mjs';
import { createRouter } from './http/router.mjs';
import { brandName } from './http/brand.mjs';
import auth, { password as authPassword } from './routes/auth.mjs';
import gate from './routes/gate.mjs';
import usersRoutes from './routes/users.mjs';
import access from './routes/access.mjs';
import teams from './routes/teams.mjs';
import products from './routes/products.mjs';
import modules from './routes/modules.mjs';
import agentRoutes from './routes/agent.mjs';
import intakeRoutes from './routes/intake.mjs';
import insightsRoutes from './routes/insights.mjs';
import cases from './routes/cases.mjs';
import environments from './routes/environments.mjs';
import runs from './routes/runs.mjs';

const PACKAGE_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
const publicDir = path.join(ROOT, 'portal/public');

export function createPortal(options = {}) {
  const ctx = createContext(options);
  const { host, store, queue, agent, lock, logger } = ctx;
  const dispatch = createRouter([auth, gate, authPassword, usersRoutes, access, teams, products, modules, agentRoutes, intakeRoutes, insightsRoutes, cases, environments, runs]);
  const server = http.createServer(async (req, res) => {
    if (logger) {
      // The UI polls GET endpoints every few seconds, so log only changes (non-GET) and failures.
      const started = Date.now();
      res.once('finish', () => {
        if (!['GET', 'HEAD'].includes(req.method) || res.statusCode >= 400) {
          logger(`${req.method} ${req.url.split('?')[0]} -> ${res.statusCode} (${Date.now() - started} ms)`, res.statusCode >= 500 ? 'stderr' : 'stdout');
        }
      });
    }
    applySecurityHeaders(res);
    try {
      if (req.url === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
        let ok = true; try { store.db.prepare('SELECT 1').get(); } catch { ok = false; }
        return json(res, ok ? 200 : 503, { status: ok ? 'ok' : 'unavailable', version: PACKAGE_VERSION, uptimeSeconds: Math.round(process.uptime()) });
      }
      const localAddresses = ['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), req.socket.localAddress?.replace('::ffff:', ''), process.env.PORTAL_PUBLIC_HOST];
      const hostname = new URL(`http://${req.headers.host}`).hostname.toLowerCase();
      check(localAddresses.includes(hostname), 'Unrecognized portal host.', 403);
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        check(new URL(req.headers.origin).host === req.headers.host, 'Cross-origin writes are not allowed.', 403);
      }
      const url = new URL(req.url, 'http://localhost');
      // rc.user / rc.acc are filled by routes/gate.mjs (after the unauthenticated auth routes) for /api requests.
      const rc = { req, res, url, route: url.pathname, method: req.method, user: undefined, acc: undefined };
      if (!await dispatch(ctx, rc)) {
        // Fall-through once no route handled the request: unknown /api/ paths are 404, everything else is a static file.
        if (rc.route.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
        await serveStatic(req, res, publicDir);
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (!error.status) { if (logger) logger(error.stack ?? String(error), 'stderr'); else console.error(error); }
      json(res, error.status ?? 500, { error: error.status ? error.message : 'The portal could not complete this request. Check the server log.', ...(error.status ? error.extra : {}) });
    }
  });
  server.once('listening', () => {
    const address = server.address();
    const displayHost = ['0.0.0.0', '::'].includes(host) ? 'localhost' : host.includes(':') ? `[${host}]` : host;
    lock.write({ pid: process.pid, url: `http://${displayHost}:${address.port}` });
  });
  // Raw intake uploads can be large; the default 30 s whole-request limit would cut them off.
  server.requestTimeout = Number(process.env.PORTAL_REQUEST_TIMEOUT_MS) || 30 * 60 * 1000;
  return { server, store, queue, host, async close() { agent.stop(); await queue.stop(); await new Promise(resolve => server.close(resolve)); store.close(); lock.release(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let portal;
  const dataDir = path.resolve(process.env.PORTAL_DATA_DIR ?? path.join(ROOT, '.portal'));
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, 'portal.log');
  // Every terminal line is also kept in .portal/portal.log so a second launch can follow it.
  const logger = (message, stream = 'stdout') => {
    const line = `${new Date().toLocaleTimeString()}  ${message}`;
    (stream === 'stderr' ? console.error : console.log)(line);
    try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* the terminal copy is enough */ }
  };
  // A live PID alone is not proof: Windows reuses PIDs after a reboot (e.g. the lock's PID now belongs to mongod.exe).
  // Treat the lock as stale unless a portal actually answers at the recorded URL.
  const portalResponds = async url => {
    if (!url) return false;
    try { await fetch(new URL('/api/bootstrap', url), { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
  };
  try {
    try {
      portal = createPortal({ logger, bootstrap: true });
    } catch (error) {
      if (error.code !== 'PORTAL_ALREADY_RUNNING' || await portalResponds(error.portalUrl ?? `http://127.0.0.1:${process.env.PORTAL_PORT ?? 4173}`)) throw error;
      console.log(`Removing stale portal lock (PID ${error.pid} is not serving the portal).`);
      fs.rmSync(path.join(dataDir, 'worker.lock'), { force: true });
      portal = createPortal({ logger, bootstrap: true });
    }
  } catch (error) {
    if (error.code === 'PORTAL_ALREADY_RUNNING') {
      const configuredHost = process.env.PORTAL_HOST ?? '127.0.0.1';
      const displayHost = ['0.0.0.0', '::'].includes(configuredHost) ? 'localhost' : configuredHost.includes(':') ? `[${configuredHost}]` : configuredHost;
      console.log(`${brandName()} Test Studio is already running.`);
      console.log(`Open: ${error.portalUrl ?? `http://${displayHost}:${process.env.PORTAL_PORT ?? 4173}`}`);
      console.log(`Using the existing server (PID ${error.pid}). No second server was started.`);
      if (process.env.PORTAL_FOLLOW_LOGS === '1') {
        // Show the running server's log here, starting with its recent history, then live.
        console.log(`\n--- Following ${logFile} (close this terminal to stop; the server keeps running) ---`);
        let position = 0;
        if (fs.existsSync(logFile)) {
          const size = fs.statSync(logFile).size;
          position = Math.max(0, size - 8000);
          const recent = fs.readFileSync(logFile, 'utf8').slice(-8000);
          process.stdout.write(position > 0 ? recent.slice(recent.indexOf('\n') + 1) : recent);
          position = size;
        }
        fs.watchFile(logFile, { interval: 500 }, current => {
          if (current.size < position) position = 0; // log was rotated
          if (current.size === position) return;
          const fd = fs.openSync(logFile, 'r'), chunk = Buffer.alloc(current.size - position);
          fs.readSync(fd, chunk, 0, chunk.length, position); fs.closeSync(fd);
          position = current.size; process.stdout.write(chunk);
        });
      }
    } else {
      console.error(error.status ? error.message : error);
      process.exitCode = 1;
    }
  }
  if (portal) {
    const port = Number(process.env.PORTAL_PORT ?? 4173);
    try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`); } catch { /* no log yet */ }
    portal.server.listen(port, portal.host, () => {
      logger(`${brandName()} Test Studio: http://${portal.host}:${port}  (PID ${process.pid})`);
      logger(`Logging test runs, changes and errors here and in ${logFile}`);
      portal.queue.pump();
    });
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await portal.close(); process.exit(0); });
  }
}
