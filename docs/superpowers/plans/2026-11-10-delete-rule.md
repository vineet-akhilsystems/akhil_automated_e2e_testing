# Delete rule (Plan 3) — own-item delete for cases

Decision (user, 2026-11-10): team sharing already exists (audit: grants target teams; team/member removal revokes access, audited) — no change. Delete rule: module leads and admins can delete any case or uploaded file in their module; a tester can delete only items they created/uploaded; nobody else.

Audit gaps: cases (single + bulk) require `case.delete`, which testers lack, even for their own cases (`routes/cases.mjs:37,59`, `services/access.mjs:61`); the case UI delete button is gated by `can('case.delete')` only (`public/pages/cases.js:31`); intake files already follow the rule server-side but the UI shows delete to everyone with `intake.delete` (`public/pages/intake.js:58,71`). Templates have no author and are out of scope (not requested). Runs/evidence/insights have no delete routes.

Tasks: (1) server: a tester may delete a case they created (`createdBy`), single and bulk-delete, with the same 409 dependency/in-use rules and audit as today; everyone else still needs `case.delete`; 404-vs-403 semantics unchanged for non-members. (2) UI: show delete only when allowed (lead/admin, or own item). (3) tests: tester own/other case single+bulk, lead any, viewer none, non-member 404, intake unchanged, audit entry written.
Not changed: roles/permission catalog (no new permission), DB schema, templates.
