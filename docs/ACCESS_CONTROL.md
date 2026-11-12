# Access control

For administrators and module leads. Design background: `docs/superpowers/specs/2026-11-09-access-control-design.md`.

## The model in one minute

- **Scopes:** platform (administrators only), **product**, **module**. A module belongs to one product.
- **Membership:** "this person or team has this role on this module or product", optionally with per-permission overrides and an expiry date.
- **Deny by default.** No membership means the module or product is invisible (404, never "forbidden"), is not listed anywhere, and cannot be probed.
- **Computed on every request** from the database. Changing someone's access takes effect on their next click; there is nothing cached in the session.
- Administrators (`role: admin`) hold everything. Everyone else is a `member` whose access comes from memberships.

## Who can do what

| Action | Who |
|---|---|
| Create users, products, login profiles (Settings) | Administrator only |
| Create a module | Administrator or product owner (the creator becomes its lead) |
| Add people or teams to a module / product, change roles, set expiry | `members.manage` holders: module leads, product owners |
| Create teams | Administrator or anyone with `members.manage` somewhere |
| Edit a team's members or delete it | Administrator, or the team's creator, who must also manage every place the team is attached |
| Read the audit log of a scope | Administrator, or `members.manage` on that scope |

## Preset roles

| Role | Adds up to | Scope |
|---|---|---|
| Viewer | see the module, cases, runs and reports | module, product |
| Business analyst | Viewer + upload and remove (own) intake files, run analysis, save insights, create and edit cases | module, product |
| Tester | Analyst + start and cancel runs, triage, approve or reject cases | module, product |
| Module lead | Tester + delete cases, module settings, manage members | module, product |
| Product owner | Lead on every module of the product + create modules + manage product access | product only |

A product-level membership applies to every module in that product. Individual permissions can be switched on or off per membership.

## Permission list

`module.view`, `module.settings`, `members.manage`, `intake.upload`, `intake.delete`, `agent.run`, `case.create`, `case.edit`, `case.delete`, `case.review`, `run.start`, `run.cancel`, `triage.write`, `report.view`; at product scope also `module.create` and `product.view`. `GET /api/access/roles` returns the catalogue; `GET /api/me/access` returns what the signed-in person can do.

How permissions combine on a module: product-level memberships (direct or through teams) plus the module part. At module scope a person's **direct** membership replaces what their teams would give them on that module (a direct Viewer entry overrides a team's Lead); with no direct entry, the union of their teams' entries applies. Expired entries are ignored. Without `module.view` nothing else works.

## Teams

A team is a reusable group of people that can be attached to modules or products like a person. Adding someone to a team gives them everything the team holds on every place it is attached, so:

- you can add people only if you cover (hold yourself) every permission the team has there and manage each place it is attached;
- nobody adds themselves to a team, or grants a team they belong to;
- removing a member or deleting a team revokes access immediately and needs the same control.

## Delegation rules (no privilege escalation)

- You can grant or change only permissions you hold yourself; you cannot edit or remove your own membership (or one you hold through a team).
- **Expiry:** you cannot give access that lasts longer than your own. If your access to a place ends on a date, anything you grant there must end on or before it. Reducing someone's access (fewer permissions, no later expiry) is always allowed.
- An expiry date must be in the future. To end access now, remove the membership.
- **Keep a lead:** a non-admin change is refused if it leaves a module with no lead now, or none once the expiring leads have lapsed. Administrators are not blocked, but the module shows `noLead` (the `X-No-Lead` header and a `noLead` field on `GET /api/modules/:id/members`) and a `module.noLead` audit entry is written.

## Second approver (four-eyes)

Module setting `requireSecondApprover` (default on, switchable by the lead). While on:

- Nobody can approve or reject a case they created, last changed the content of, or last saved. Administrators are not exempt.
- A reviewer's own new cases start as drafts.
- Changing a case's content (title, steps, input and its key order, action, base template, expected, target, requirement, preconditions, type, mode) sends it back to draft for any editor. Priority, category, enabled and notes do not.
- Changing a data template resets the cases built on it and makes the editor their content author.
- The rule applies once user accounts exist.

## Expiry

Memberships may carry `expiresAt`. Access ends at that instant on the next request. Expired entries stay visible in the member list until removed.

## Audit log

`GET /api/audit?scopeType=&scopeId=` (newest first, 200 rows). Recorded, without secrets or credential values: membership add, update and remove (including changes made through a team, with the person affected); team create, rename, delete and member changes (mirrored into each place the team is attached); user create, role change, disable, enable, delete, password reset and change, display name; product and module create and update; module settings; template changes and case resets; case create, update, import, bulk edits, delete and every review decision (with whether a note was given, not its text); requirements; run create, rerun, cancel, complete, triage and report details; intake upload, delete, analysis; saved insights; agent jobs; login profile create and update (which fields changed, never values) and login refresh; `module.noLead`. Edits that change nothing write nothing.

**Retention:** rows are kept indefinitely (a compact row per change; indexed by scope). There is no purge function: if the log grows too large for your policy, archive and trim `audit_log` in `.portal/portal.sqlite` offline while the portal is stopped.

## Migration and existing users

- On first start after upgrading, each `tester`, `ba` or `viewer` account gets a product-level membership on **Augastam** with the matching preset, so nothing changes on day one. Miracle starts with administrators only. Cases saved earlier get their last saver recorded as content author (once).
- `POST /api/users` accepts `admin` or `member`; the old `tester`, `ba`, `viewer` values still work and create or update that Augastam membership. The mapping only ever manages memberships it created itself; once someone edits that membership by hand, or already had a deliberate one, it is left alone (the audit says "kept existing membership").
- MCP and assistant accounts are ordinary users with the same checks: give them a membership on the modules they should work on. They see only those modules.

## Known limits

- Single-server, SQLite. Lead and permission checks are computed on demand; very large installations (thousands of modules and tens of thousands of memberships) have not been load-tested beyond a few hundred modules and a few thousand memberships.
- No access-request workflow, SSO, per-field or per-case permissions.
- Administrators can see and change everything, including removing a module's last lead (audited).
- Login profiles belong to a product; their stored credentials are never shown to testers. Identity fields (username, tenant, facility, role) are shown only to people who can start runs in that product.
- The audit log is readable by scope managers, but it is not tamper-proof against someone with database access.
