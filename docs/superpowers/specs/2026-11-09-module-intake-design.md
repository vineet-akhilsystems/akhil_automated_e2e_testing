# Module Intake → Insights → Reviewed Tests → Run → Bug-Report PDF (design)

Extends the existing Augastam Test Studio in `portal/` (Node 24+, node:sqlite via `store.mjs`, vanilla JS frontend in `portal/public`, Playwright runner, ReportLab PDF in `portal/report_pdf.py`). Do NOT rewrite; extend. User-approved flow, 2026-11-09.

## Flow
1. User logs in to the portal (multi-user, roles). Separate from the target-app login (already handled by Settings → login profiles; each module/project picks a profile = its own URL + credentials).
2. BA creates/opens a module and uses a new **Intake** tab: drop any files (xlsx, csv, pdf, docx, txt/md, images, mp4/webm/mov videos, json). Stored per module with metadata.
3. **Analyze**: server extracts text from each file (xlsx/csv/txt/md/json/docx/pdf where feasible; images/videos are stored and listed, with video text left as "needs transcript" unless an optional transcriber is configured). An insights document is produced for the module (summary, entities/fields, business rules, flows, edge cases, open questions, source file refs). LLM generation uses the Anthropic API if `ANTHROPIC_API_KEY` is set (model from `INSIGHTS_MODEL`, default `claude-sonnet-5-5`); without a key a deterministic heuristic extractor still produces insights and draft cases, and the UI says which mode was used.
4. Draft test cases are created with `status: "draft"` (cases carry `reviewStatus`: draft | approved | rejected). **Human review gate**: only approved cases can be queued for automated runs. Reviewers can edit, approve, reject, bulk-approve.
5. Run (parallel, fast), evidence captured per step (existing), then final **bug report PDF**.
6. Whole intake package + insights + approved cases can be exported as a single "module pack" (zip/JSON manifest) for downstream agents building the backend ETL pipeline.

## Roles
`admin` (manage users, settings, delete), `tester` (run, approve cases, triage), `ba` (upload intake, edit/propose cases, view reports), `viewer` (read-only). First start with no users: bootstrap admin from `PORTAL_ADMIN_USER`/`PORTAL_ADMIN_PASSWORD` env, else print a one-time generated password to the log. Passwords scrypt-hashed. Existing `PORTAL_TOKEN` single-token mode keeps working when no users exist (backward compat).

## API contract (new; all JSON, cookie session `portal_session`, all under auth)
- `POST /api/login {username,password}` → `{authenticated,user:{id,username,role,displayName}}`; `GET /api/session` → adds `user`. `POST /api/logout`. `POST /api/me/password {current,next}`.
- Admin: `GET /api/users`, `POST /api/users {username,password,role,displayName}`, `PATCH /api/users/:id {role?,password?,disabled?,displayName?}`, `DELETE /api/users/:id`.
- Intake: `GET /api/modules/:id/intake` → `{files:[{id,name,size,type,kind,uploadedBy,uploadedAt,note,extract:'ok'|'pending'|'unsupported'|'error',chars}],insights:{id,createdAt,mode:'llm'|'heuristic',status,...}|null}`.
  `POST /api/modules/:id/intake/files` — raw body upload: header `x-file-name` (url-encoded), `x-file-note` optional, body = file bytes (streamed to disk, max `INTAKE_MAX_MB` default 2048). Returns the file record.
  `GET /api/modules/:id/intake/files/:fid/download`, `DELETE /api/modules/:id/intake/files/:fid`.
  `POST /api/modules/:id/intake/analyze {fileIds?:[]}` → `{jobId}` (async); `GET /api/modules/:id/intake/analyze/:jobId` → `{status:'running'|'done'|'error',message,progress}`.
  `GET /api/modules/:id/insights` → insights doc `{summary,fields[],rules[],flows[],edgeCases[],openQuestions[],sources[],mode,createdAt}`.
  `GET /api/modules/:id/pack` → downloads the module pack zip.
- Review: cases get `reviewStatus`. `POST /api/modules/:id/cases/review {ids:[],decision:'approved'|'rejected',note?}`. Run creation rejects non-approved cases with 409 (cases created before this feature are treated as approved).
- Audit: every upload/approve/run records `{user,at}` on the record.

## Speed
Queue runs N Playwright workers in parallel (`PORTAL_WORKERS`, default min(4, cores)), shard cases by independence, re-run only failed cases on request ("Re-run failures"), keep per-case timeouts, reuse saved auth session across workers.

## Report PDF (client's key deliverable)
Clean layout; cover + executive summary; **clickable table of contents and PDF outline/bookmarks**; each finding is a clickable entry linking to its detail page (what was run, steps, inputs, expected vs actual, mismatch, screenshots, severity/triage); back-links to the index; appendix of every case; plain, short wording.

## Deployment
Dockerfile (node 24 + Playwright browsers + python/reportlab), docker-compose with a persistent volume for `.portal`, env template, reverse-proxy/HTTPS notes, health endpoint `GET /api/health`, backup instructions, docs/DEPLOYMENT.md.

## Non-goals
No SSO, no cloud multi-tenant, no auto-run without review, no claiming video understanding that isn't implemented.

## File ownership (parallel agents must not touch others' files)
- Backend agent: `portal/server.mjs`, `portal/store.mjs`, new `portal/users.mjs`, `portal/intake.mjs`, `portal/insights.mjs`, `portal/test/*` for those.
- Frontend agent: `portal/public/*` only.
- Speed agent: `portal/queue.mjs`, `portal/reporter.cjs`, `playwright.config.ts`, queue tests.
- Report agent: `portal/report_pdf.py`, `portal/pdf-report.mjs`.
- Deploy agent: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `docs/DEPLOYMENT.md`, `README.md` (append section).
