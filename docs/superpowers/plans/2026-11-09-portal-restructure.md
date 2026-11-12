# Portal Restructure (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `portal/server.mjs`, `portal/store.mjs` and `portal/public/app.js` into focused layers with zero behavior change.

**Architecture:** `createPortal()` keeps its signature and return shape but only composes a `ctx` (dependency container) and a router. Route groups move to `portal/routes/*.mjs`, rules to `portal/services/*.mjs`, request plumbing to `portal/http/*.mjs`. `store.mjs` stays as a facade over `portal/data/*.mjs`. `app.js` becomes an ES-module entry plus `pages/` and `components/`.

**Tech Stack:** Node `node:http`, `node:sqlite`, `node:test`, Playwright (browser tests), plain browser ES modules (no bundler).

**Spec:** `docs/superpowers/specs/2026-11-09-codebase-structure-design.md`. This plan covers spec steps 1-2. Plan 2 (module plugin + removing hard-coded `registration`, steps 3-4) and Plan 3 (team sharing, step 5) are written after this lands, because they depend on the final layer layout.

## Global Constraints
- No behavior change: HTTP status codes, JSON shapes, cookies, headers (CSP, nosniff, Referrer-Policy) and DB schema stay identical.
- `createPortal(options)` keeps its signature and returns `{ server, store, queue, host, close }` (`portal/server.mjs:1432-1436`); tests import it.
- Stay on `node:http` and `node:sqlite`; add no dependencies. Portal code stays `.mjs`.
- CSP is `script-src 'self'` (no inline scripts, no inline styles).
- Route matching is first-match in the existing order; `/api/modules/:id/...` regexes must keep their relative order.
- Hidden or unknown resource returns 404, visible-but-not-allowed returns 403 (`server.mjs:159` comment).
- Project is not a git repo: instead of commits, each task ends with a checkpoint copy to `tmp/refactor-checkpoints/task-N/`.
- Baseline command that must pass after every task: `npm run portal:test`; also `npm run portal:check`.

## Review Focus
- A hidden module still gives 404 (not 403) to a non-member after routes move to the router.
- If `createPortal` throws during construction, `worker.lock` is still removed and the store closed (`server.mjs:106`).
- Raw large uploads (`POST /api/modules/:id/intake/files`) still stream to disk, not through `readJson`, and honor `requestTimeout`.
- Module-split frontend adds no inline script/style and still loads under the CSP; nested static paths are served.
- Route precedence: `/api/modules` exact routes (`/api/modules` POST) vs `/api/modules/:id/...` regex give the same result as before.

## File Structure
```
portal/server.mjs            compose + listen + CLI entry only
portal/app/config.mjs        env, environments, data dir, host/token validation
portal/app/lock.mjs          worker.lock acquire/release
portal/app/context.mjs       createContext(options) -> ctx
portal/http/body.mjs         readJson, raw body helpers (from server.mjs:30-44)
portal/http/respond.mjs      json(), sendError mapping, security headers
portal/http/router.mjs       createRouter(routeModules) -> async (ctx, rc) => boolean   (router signature is (ctx, rc); routes/environments.mjs and routes/gate.mjs exist in addition to the files listed here)
portal/http/static.mjs       static file serving for portal/public
portal/services/session.mjs  sessions, principal, login throttle
portal/services/access.mjs   accessFor, authorize, modulePermission, enforce
portal/services/membership.mjs  addMember, grants, leads, team rules (server.mjs:281-496)
portal/routes/{auth,users,access,teams,products,modules,agent,intake,insights,cases,runs}.mjs
portal/data/{users,modules,memberships,intake,insights,cases,runs,audit}.mjs
portal/public/{app.js,api.js,state.js,pages/*.js,components/*.js}
```

### Task 0: Baseline, backup, golden route snapshot
**Files:**
- Create: `portal/test/route-snapshot.test.mjs`, `portal/test/route-snapshot.golden.json`
- Create: `tmp/refactor-checkpoints/task-0/` (copy of `portal/`)

**Interfaces:**
- Produces: `route-snapshot.test.mjs` which starts a portal via `portal/test/support.mjs`, signs in as admin, and requests a fixed list of `[method, path, body?]` entries; records `{ key: "GET /api/bootstrap", status, topLevelKeys: [...] }` per entry and compares to the golden file. Later tasks must keep it green.

- [ ] **Step 1:** Run `npm run portal:test` and `npm run portal:check` on untouched code; record pass/fail counts in `tmp/refactor-checkpoints/baseline.txt`. If anything fails already, stop and tell the user.
- [ ] **Step 2:** Copy `portal/` to `tmp/refactor-checkpoints/task-0/portal`.
- [ ] **Step 3:** Write `route-snapshot.test.mjs` covering at least one request per route group in `server.mjs` (session, login, users, access/roles, teams, products, bootstrap, modules CRUD, agent status, intake list, insights, cases list/create/delete, coverage, templates, export, runs list, health) plus a non-member request to a hidden module expecting 404 and to a visible module's admin-only route expecting 403. Mode `UPDATE_GOLDEN=1` writes the file.
- [ ] **Step 4:** Run `UPDATE_GOLDEN=1 node --test portal/test/route-snapshot.test.mjs`, then run without the flag. Expected: PASS.
- [ ] **Step 5:** Checkpoint copy as `task-0b`.

### Task 1: Extract HTTP plumbing and app bootstrap
**Files:**
- Create: `portal/http/body.mjs`, `portal/http/respond.mjs`, `portal/http/static.mjs`, `portal/app/config.mjs`, `portal/app/lock.mjs`
- Modify: `portal/server.mjs:27-135` and static serving section near the end of the request handler

**Interfaces:**
- `readJson(req, limit?) -> Promise<object>` and `readRaw` exactly as today; `json(res, status, body)`; `applySecurityHeaders(res)` (the three headers at `server.mjs:649-651`); `serveStatic(req, res, publicDir) -> boolean`.
- `loadConfig(options) -> { dataDir, host, token, isLocalHost, environments, settings }` (lines 47-68, same `check` messages).
- `acquireLock(dataDir) -> { release(), write(info) }` (lines 69-87, same 409 `PORTAL_ALREADY_RUNNING` error with `portalUrl`/`pid`).

- [ ] **Step 1:** Move the functions listed above verbatim; `server.mjs` imports them. No logic edits.
- [ ] **Step 2:** `npm run portal:check && npm run portal:test`. Expected: all PASS including route snapshot.
- [ ] **Step 3:** Checkpoint copy `task-1`.

### Task 2: Session and access services
**Files:**
- Create: `portal/services/session.mjs`, `portal/services/access.mjs`, `portal/services/membership.mjs`
- Modify: `portal/server.mjs:117-246` and `:281-496`

**Interfaces:**
- `createSessions({ store, users, token }) -> { principal(req), start(req,res,userId), drop(userId, except?), attempts }`
- `createAccess({ store, users }) -> { accessFor(user), authorize(user, permission, scope?, acc?), modulePermission(method, rest), enforce(user, method, route), DENIED }`
- `createMembership({ store, access, users, audit }) -> { addMember, parseGrant, parseRole, assertCovers, leadState, keepingLeads, ... }` (every helper currently defined in `server.mjs:281-496`, same names).
- Consumes: `portal/access.mjs` exports (unchanged).

- [ ] **Step 1:** Move code verbatim into factories closed over their dependencies; keep the existing names so call sites in `server.mjs` change only by destructuring.
- [ ] **Step 2:** Run `node --test portal/test/access*.test.mjs portal/test/users.test.mjs portal/test/route-snapshot.test.mjs`. Expected: PASS.
- [ ] **Step 3:** `npm run portal:test`. Expected: PASS. Checkpoint `task-2`.

### Task 3: Context and router skeleton
**Files:**
- Create: `portal/app/context.mjs`, `portal/http/router.mjs`
- Modify: `portal/server.mjs`

**Interfaces:**
- `createContext(options) -> ctx` holding `{ config, store, users, intake, agent, queue, sessions, access, membership, environments, settings, logger, qaRoot, specRoot, helpers }` where `helpers` contains the remaining small closures (`getModule`, `getProduct`, `productList`, `readinessFor`, `record`, `inModule`, `stampCase`, ...).
- `createRouter(routes: Array<(ctx, rc) => Promise<boolean>>) -> (ctx, req, res) => Promise<boolean>`; `rc = { req, res, url, route, method, user, acc }`. A route function returns `true` when it handled the request; the router tries them in array order, then falls through to the existing 404.
- The existing inline request handler body becomes one temporary route function `legacy` so behavior is unchanged.

- [ ] **Step 1:** Build ctx and router; register only `legacy`. Preserve the order: health check, host check, origin check, `enforce`, then routes (`server.mjs:655-668`, `:218-234`).
- [ ] **Step 2:** Run `npm run portal:test`. Expected: PASS. Checkpoint `task-3`.

### Tasks 4-9: Move route groups out of `legacy` (one task each, same recipe)
Order and source lines (read `server.mjs` for exact boundaries): 
4. `routes/auth.mjs`: `/api/session`, `/api/login`, `/api/logout`, `/api/me/password` (lines ~667-714).
5. `routes/users.mjs`, `routes/access.mjs`: users CRUD, `/api/access/roles`, `/api/me/access`, `/api/directory`, `/api/audit` (~715-776).
6. `routes/teams.mjs`, `routes/products.mjs`: teams and team members, scope members, products, `/api/bootstrap` (~777-902).
7. `routes/modules.mjs`: `POST /api/modules` and module-level GET/PUT (setup, readiness, requirements, templates, export, import, ai-generate, coverage) (~883-902, ~1024-1067, ~1127-1233).
8. `routes/agent.mjs`, `routes/intake.mjs`, `routes/insights.mjs` (~903-1023). `intake.mjs` keeps the raw streaming upload path and the delete rule `record.uploadedBy === user.username || permission` (`:960-962`).
9. `routes/cases.mjs`, `routes/runs.mjs`: cases list/review/bulk/create/delete, `/api/runs*` and remaining handlers to the end of the handler.

**Interfaces (all):** each file `export default async function handle(ctx, rc) -> boolean`; append to the router array in the same relative order as the code appeared; remove the moved block from `legacy`. When `legacy` is empty, delete it.

- [ ] **Step 1 (per task):** Move the block verbatim, replacing closure names by `ctx.*` / `rc.*`; do not reorder conditions.
- [ ] **Step 2 (per task):** `npm run portal:test`. Expected: PASS incl. route snapshot. Checkpoint `task-N`.

### Task 10: Split the store behind a facade
**Files:**
- Create: `portal/data/{users,modules,memberships,intake,insights,cases,runs,audit}.mjs`
- Modify: `portal/store.mjs`

**Interfaces:**
- `openStore(dataDir)` unchanged (`portal/store.mjs:18`), returns the same object with the same method names; each `data/*.mjs` exports `createXRepo(db) -> { ...methods }` and `openStore` spreads them. Table DDL moves with its repo; migration order unchanged.

- [ ] **Step 1:** Move methods and DDL per table (schema at `store.mjs:19-39`, insights `:101-112`, intake `:92`). No SQL edits.
- [ ] **Step 2:** `npm run portal:test`. Expected: PASS. Open an existing `.portal` copy (use `.portal-backup-*`) with `openStore` and confirm it opens without migration changes. Checkpoint `task-10`.

### Task 11: Split `public/app.js`
**Files:**
- Create: `portal/public/api.js`, `state.js`, `pages/*.js`, `components/*.js`
- Modify: `portal/public/app.js`, `portal/public/index.html:script tag`, `portal/http/static.mjs`

**Interfaces:**
- `api.js` exports the fetch wrapper used by `app.js` today; each page exports `render(root, state)`; `app.js` keeps only router/bootstrap. `index.html` uses `<script type="module" src="/app.js">`.
- Static server must serve nested files with correct MIME (`text/javascript` for `.js`) and keep nosniff.

- [ ] **Step 1:** Split by screen in the order they appear in `app.js`; one page per commit-sized pass, running `node --check` on each file.
- [ ] **Step 2:** `npm run portal:test` (browser tests `*-browser.test.mjs` exercise the UI). Expected: PASS. Manually open the portal, log in, open a module, upload page, runs page; the browser console shows no CSP errors. Checkpoint `task-11`.

### Task 12: Cleanup and docs
**Files:**
- Modify: `package.json` (`portal:check` runs `node --check` over every new file via a glob script `qa/tools/check-syntax.mjs`), `README.md` (new layout), `.claude/skills/*` mentions of `portal/server.mjs` internals if any.

- [ ] **Step 1:** Create `qa/tools/check-syntax.mjs` that runs `node --check` on all `portal/**/*.mjs` and `portal/public/**/*.js`; point `portal:check` at it.
- [ ] **Step 2:** `npm run portal:check && npm run portal:test`. Expected: PASS. Confirm `wc -l portal/server.mjs` is under 200.

## Self-review notes
- Spec coverage: steps 1-2 covered by Tasks 0-12; steps 3-5 are explicitly deferred to Plans 2 and 3.
- Risk: tasks 4-9 line ranges are approximate; the executor must read the file for exact block boundaries and keep order.
