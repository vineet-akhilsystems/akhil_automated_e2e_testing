# Module knowledge pipeline: from BA video to generated test code (design)

Extends Test Studio. Goal: whatever a BA uploads for a module (videos, documents, sheets, screenshots) is processed once, remembered, reused for later analysis, and ONLY then used to generate tests, and AI test generation only works once the module's automation pipeline is set up. Status: Phase A is built from this document; Phase B (discovery run from the portal) is described but not built.

## 1. The workflow (one module, left to right)

```
 UPLOAD ──► PROCESS ──► ANALYSE ──► REVIEW ──► SET UP TARGET ──► DISCOVER ──► BUILD CODE ──► INSTALL ──► SMOKE RUN ──► AI GENERATE
 any file   keyframes   insights    approve    URL + variants    scan live    agent writes   developer   one case     (unlocked)
            transcript  + draft     drafts     + login profile   screens      spec/page/     approves    passes
            text        cases       (human)    (human)           (read-only)  adapter.json   + restarts
```
Each arrow is a stage with a status the UI shows as a checklist: `missing`, `running`, `ready`, `stale`, `failed`, `blocked`.

| # | Stage | Done when | Who/what does it |
|---|---|---|---|
| 1 | **Sources** | at least one usable source: document/sheet/PDF/text, a video with keyframes or transcript, or a screenshot | BA uploads; portal processes |
| 2 | **Insights** | an analysis exists that covers every current source (otherwise `stale`) | coding agent (Codex/Claude) or assistant over MCP |
| 3 | **Reviewed cases** | at least one approved case | tester approves drafts (four-eyes) |
| 4 | **Target setup** | module URL path, variants/tabs and a login profile of the product are recorded and confirmed by a person | proposed from the insights, confirmed by a lead |
| 5 | **Discovery** | `qa/modules/<id>/discovery/fields-default.json` exists and is newer than the target setup | read-only scan of the live module page |
| 6 | **Automation package** | agent proposal produced AND installed: `tests/modules/<id>/cases.spec.ts` + `qa/modules/<id>/adapter.json` loaded by the registry and `module.adapter` set | agent writes; developer reviews and installs |
| 7 | **Smoke run** | at least one automated case of the module has passed on its product's profile | queue |

## 2. Gating rules (the important part)
- **"Generate test cases with AI" works only when ALL are true:** stage 1 ready, stage 2 exists (stale is a warning, not a block), and stage 6 connected (an automation adapter is registered for the module and its spec file exists). Anything else returns 409 with the full checklist and the next action for each missing stage. Manual case writing, intake upload, and "Analyse with agent" stay available at all times.
- **"Generate automation proposal" needs** stages 1, 2, 3 (>=1 approved case), 4 and 5. Without discovery the agent would guess locators, so it is blocked, not warned.
- **Running automated cases needs** stage 6 (already enforced) and a profile of the same product.
- A product whose application login is not automated (Miracle today) stops at stage 5 with a plain explanation; manual testing, intake, insights and review still work.

## 3. Remembering and reusing what was processed
- **Every upload is fingerprinted** (SHA-256 of the bytes), per module. Uploading identical bytes again (same video twice, even renamed) stores nothing new, triggers no reprocessing and answers `duplicate of <file>`; the note/name of the new upload is added to the existing record.
- Same name, different bytes = a new source (a new version); the older one stays until a person deletes it.
- **Per source we keep** the extracted text/tables/keyframes (already cached by file id) and `sha256`, `processedAt`, `extractorVersion`.
- **Insights are versioned and cumulative.** Each analysis saves a new version with `coveredSources: [{fileId, sha256}]`, `basedOn: <previous version id>` and a change summary. The next analysis receives (a) the previous insights as `input/previous-insights.json`, (b) which sources are NEW or CHANGED since then, and is told to merge: keep what is still true, add and correct, never re-derive from scratch. Draft cases are de-duplicated by title as today. Sources added later make stage 2 `stale` until re-analysed; deleting a source keeps the insights but marks that provenance `source removed`.
- **Provenance survives**: every rule, field and case keeps its source (`file @ mm:ss`), so a human can always check it.

## 4. Failure and interruption handling
| Situation | What happens |
|---|---|
| Same video uploaded twice | Deduplicated by hash (above); no second extraction, no second slot used. |
| Same name, new content | New source; stage 2 becomes `stale`; the older file is untouched. |
| Upload cut off mid-way | Partial file is discarded (already true); the BA re-uploads. |
| Extraction stuck or portal restarted while `pending` | At startup every `pending` source is re-queued (idempotent: partial frame folder is cleared and rebuilt). Status shows `processing`, never silently stays pending. |
| ffmpeg/transcriber missing | Source marked `unsupported` with the reason; other sources still usable; UI says what to install or upload instead. |
| Agent job killed, timed out or portal restarted mid-run | Jobs are persisted. A job that was `running` at restart becomes `interrupted` (not lost), its log kept, with a Retry action. Workspace extracts are cached so a retry is cheap. Nothing from a half-finished run is saved: insights are saved only after output validates. |
| Agent output invalid / BOM / empty | Job `error` with the reason; previous insights untouched. |
| Two people click at once | Second gets "busy" with what is running and for how long; a stale job is auto-released. |
| New document after insights exist | Stage 2 `stale`; "Update insights" runs an incremental analysis (section 3). |
| Discovery fails (session expired, URL wrong) | Stage 5 `failed` with the reason and a "fix target setup" action; nothing is installed. |
| Proposal rejected by the reviewer | Package stays `proposed`; feedback is kept and passed to the next agent run. |

## 5. How test code is generated in the backend (stages 4 to 7)
1. The analysis proposes a **target setup** (module URL path, variants/tabs seen in the video, field names). A lead confirms or edits it: this is the only place a URL enters the pipeline.
2. **Discovery** (Phase B): a queued job runs the read-only discovery spec for that URL with the product's login profile and writes `qa/modules/<id>/discovery/`. Read-only guards already exist (no mutating requests, no destructive clicks).
3. **Build code**: the agent receives approved cases, insights, discovery output and the Registration reference, and writes `fields.ts`, `<id>.page.ts`, `case-runner.ts`, `cases.spec.ts`, `adapter.json`, `NOTES.md` into its sandbox. The portal validates and shows them; nothing runs.
4. **Install**: a developer/admin reviews the files and installs them (installer scans for unsafe code, never overwrites, refuses Registration). The portal reloads adapters and connects the module.
5. **Smoke run**: one approved automated case is run; the result is stage 7. Only then is AI case generation unlocked (it also needs stage 6 only, stage 7 is shown as recommended).

## 6. Data and API added in Phase A
- `intake_files.sha256` (+ backfill for existing files); upload response adds `duplicateOf` when bytes already exist.
- `insights` versions: `version`, `basedOn`, `coveredSources`, `changeSummary`; `GET /api/modules/:id/insights/history`.
- Persisted agent jobs table; `interrupted` status; `POST /api/modules/:id/agent/jobs/:jid/retry`.
- Startup resume of `pending` extractions.
- `module.setup = { moduleUrl, variants[], loginProfileId, confirmedBy, confirmedAt }` with `GET/PUT /api/modules/:id/setup` (needs `module.settings`).
- `GET /api/modules/:id/readiness` -> `{ stages:[{id,label,status,detail,action?}], canGenerateAi, canProposeAutomation, blockers:[...] }` computed from live state (no cached flags).
- Gate: `POST /api/modules/:id/ai-generate` returns 409 `{ error, readiness }` unless `canGenerateAi`; the agent `automation` job returns 409 unless `canProposeAutomation`.
- UI: a **Readiness** checklist on every module page, the AI Studio disabled with the reasons and the next action per missing stage, duplicate-upload notice, interrupted-job Retry, setup form.

## 7. Non-goals (this round)
Auto-installing generated code, auto-approving anything, transcribing audio (optional later), running discovery from the portal (Phase B), per-source parallel analysis.

## 8. File ownership
- Backend: `portal/server.mjs`, `store.mjs`, `intake.mjs`, `agent.mjs`, `insights.mjs`, `readiness.mjs` (new), `ai-generator.mjs` (gate only), `portal/test/*`.
- Frontend: `portal/public/*`.
- Docs: this file, `docs/MODULE_PIPELINE.md`.
