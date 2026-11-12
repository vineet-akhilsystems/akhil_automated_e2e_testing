# Access control: products, teams, module memberships (design)

Extends Test Studio (`portal/`). User decisions (2026-11-09): teams are reusable groups attached to modules; people without access see nothing; nobody approves their own case (switchable per module); presets plus per-person tick-boxes. Everything below the "Decisions" heading is the lead's call and open to change.

## Goals
- Admin creates products and users, and assigns who can open which product.
- A product owner or module lead (the "BA team head") creates modules, adds people and teams to their modules and sets what each may do.
- Permissions are per scope (platform > product > module), additive, deny by default.
- Cross-team access is just attaching another team to a module, usually as Viewer.

## Non-goals
SSO, per-field permissions, access-request workflow, per-case permissions, org-level billing. Hidden by default means no "request access" screen.

## Concepts
- **Scopes:** platform (admin only), product, module. A module belongs to exactly one product.
- **Permissions** (ids): `module.view`, `module.settings`, `members.manage`, `intake.upload`, `intake.delete`, `agent.run`, `case.create`, `case.edit`, `case.delete`, `case.review`, `run.start`, `run.cancel`, `triage.write`, `report.view`. Product scope adds `module.create`, `product.view`.
- **Preset roles** (bundles, stored as data in code constants):
  - `viewer`: module.view, report.view
  - `ba`: viewer + intake.upload, intake.delete (own uploads only), agent.run, case.create, case.edit
  - `tester`: ba + run.start, run.cancel, triage.write, case.review
  - `lead` (module lead / BA team head): tester + case.delete, module.settings, members.manage
  - `owner` (product scope only): lead on every module in the product + module.create + product.view + members.manage on the product
  - `admin` is global (`users.role === 'admin'`), has everything, including products, users, environments (login profiles).
- **Membership:** `{ id, subjectType: 'user'|'team', subjectId, scopeType: 'product'|'module', scopeId, role, overrides: { <permission>: true|false }, expiresAt?, createdBy, createdAt }`. Overrides add (true) or remove (false) single permissions relative to the preset. Expired memberships are ignored.
- **Team:** `{ id, name, description, createdBy }` with members (users). A team can be attached to products or modules like a user.

## Effective permission on module M (product P)
1. admin => all.
2. product part = union of preset+overrides of every non-expired membership on P (direct user, or via the user's teams). `owner` and any preset on P apply to every module in P.
3. module part: if the user has a DIRECT membership on M, use that membership only (its overrides can remove permissions that teams would grant; direct beats team, as TestRail does). Otherwise the union of the user's teams' memberships on M.
4. effective = union(product part, module part). `module.view` is required for anything else; a module the user cannot view is 404, never 403, and never listed.
Product visible = admin, or any membership on the product, or any module in it.

## Delegation guards
- Granting needs `members.manage` on that scope and the granter's own effective permissions must include every permission the new role+overrides would give (no privilege escalation). Cannot edit or remove your own membership. A module must keep at least one lead (or product owner/admin): refuse removal of the last.
- Only admin creates users and products and manages login profiles. Owners/leads can search a minimal people directory (id, username, displayName) to add people.
- Teams: admin and anyone with `members.manage` somewhere can create teams; only admin or the team's creator edits its members.

## Rules
- **Four-eyes:** module setting `requireSecondApprover` (default true). A case cannot be approved/rejected by its `createdBy` or last `updatedBy` user. Agent/assistant drafts count as created by the user who ran them. Admin is not exempt; admin or lead can switch the setting off for the module (`module.settings`).
- **Module creator** automatically becomes the module's `lead` (direct membership).
- **Running tests:** `run.start` on the module and a login profile of the same product; credentials are never shown to testers (unchanged).
- **Audit log:** every membership/team/product/module-settings change is recorded `{ at, actor, action, scopeType, scopeId, subject, detail }`; readable by admin and `members.manage` holders for that scope.
- **Existing data/users (migration):** user `role` admin stays global. `tester`/`ba`/`viewer` users get a product-level membership on `augastam` with the same preset (`viewer`/`ba`/`tester`), so day-one behaviour is unchanged. Miracle starts with admin only. `POST /api/users` accepts `admin|member`; legacy `tester|ba|viewer` still accepted and mapped to the Augastam product membership (compat).
- MCP/agent accounts are ordinary users and get the same checks.

## API contract (JSON, cookie session)
- `GET /api/access/roles` -> `{ roles:[{id,label,description,permissions[]}], permissions:[{id,label,group}] }`.
- `GET /api/me/access` -> `{ admin:boolean, products:{ [productId]: string[] }, modules:{ [moduleId]: string[] } }` (effective permission ids; used by the UI to show/hide actions).
- `GET /api/directory?q=` -> `[{id,username,displayName}]` (needs `members.manage` anywhere).
- Teams: `GET /api/teams` -> `[{id,name,description,createdBy,memberCount,members:[{id,username,displayName}]}]` (admin or members.manage holders); `POST /api/teams {name,description?}`; `PATCH /api/teams/:id`; `DELETE /api/teams/:id`; `POST /api/teams/:id/members {userId}`; `DELETE /api/teams/:id/members/:userId`.
- Members: `GET /api/modules/:id/members` and `GET /api/products/:id/members` -> `[{id,subject:{type,id,name},role,overrides,expiresAt,createdBy,createdAt,effective:string[]}]`; `POST` on the same path with `{subjectType,subjectId,role,overrides?,expiresAt?}`; `PATCH /api/memberships/:id {role?,overrides?,expiresAt?}`; `DELETE /api/memberships/:id`. 403 (with reason) on escalation/self/last-lead.
- Module settings: `PUT /api/modules/:id` accepts `settings: { requireSecondApprover: boolean }` (needs `module.settings`).
- `GET /api/audit?scopeType=&scopeId=` -> `[{at,actor,action,scopeType,scopeId,subject,detail}]` newest first, max 200.
- Existing endpoints keep their shapes but are filtered/enforced: bootstrap (`modules`, `runs`, `products`, `environments`) only includes what the user may see; every `/api/modules/:id/**` route checks the module permission; run routes check the run's module; unknown/hidden -> 404. `POST /api/modules` needs `module.create` on the product (admin/owner). `POST /api/products` admin only. Review endpoint returns 403 `Another person must approve this case.` under four-eyes.

## File ownership
- Backend: `portal/access.mjs` (new), `portal/store.mjs`, `portal/server.mjs`, `portal/users.mjs`, `portal/mcp-server.mjs`, `portal/test/*` (new access tests; update existing tests only where the migration forces it).
- Frontend: `portal/public/*` only (+ a new browser test).
- Docs: `docs/ACCESS_CONTROL.md`, README section.
