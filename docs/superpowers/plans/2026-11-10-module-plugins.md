> **Deviations as built:** plugin ids are resolved via `pluginFor(id string)` where the old code compared ids; hooks are `validate.{afterOutcome,blockedSource,checkInput,workflow,afterWorkflow}` phases (not a single `validateCase`); added `agent.referenceLabel` and the `discovery` flag; seed runs under the original global empty-DB guard.

# Module Plugins (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration becomes one plugin among many: every Registration-specific behavior lives in `portal/modules/registration/`, shared portal code has no `'registration'` literal, and adding Billing/EMR needs no edits to shared code.

**Architecture:** A small plugin contract (`portal/modules/contract.mjs`) and loader (`portal/modules/index.mjs`). Shared code asks the loader for a module's plugin (by `module.id`/`module.adapter`) and calls hooks: `adapter`, `validateCase`, `seed`, `ai`, `agent`, `builtIn`. Modules without a plugin keep using `qa/modules/<id>/adapter.json` exactly as today.

**Tech Stack:** Node `.mjs`, `node:test`, Playwright (tests side), existing portal layers from Plan 1.

**Spec:** `docs/superpowers/specs/2026-11-09-codebase-structure-design.md` (steps 3-4). Depends on Plan 1 (`docs/superpowers/plans/2026-11-09-portal-restructure.md`), which is complete.

## Global Constraints
- Zero behavior change: API responses, stored data, validation messages (exact strings), AI-generated case content, seed rows, run output, and `portal/openapi.json` stay identical. Registration is still seeded as `id: 'registration'`, `productId: 'augastam'`, `prefix: 'REG'`.
- The case field `registrationType` is the generic variant key used by every module (quality.mjs, mcp-server.mjs, openapi, stored cases). Do NOT rename it in this plan.
- Do not move `tests/modules/registration/**` or `qa/modules/registration/**` on disk (adapter.json `spec` pattern is `tests/modules/<id>/<file>.spec.ts`; skills, scripts and stored runs reference those paths).
- No new dependencies. Portal stays `.mjs`. CSP/headers untouched. Plugins are repo code, never loaded from user-supplied paths.
- The built-in reserved id rule stays: an `adapter.json` cannot override a plugin-provided module id (message `The built-in registration adapter cannot be overridden.` stays identical for registration).
- The project is not a git repo: each task ends with a checkpoint copy `tmp/refactor-checkpoints/p2-task-N/portal` (plus `tests/` and `playwright.config.ts` for Task 7) instead of a commit. Keep the Plan 1 checkpoints (they are the only rollback; ~70 MB). Disk is tight (~5 GB free): never copy `node_modules` or whole data folders.
- After every task: `npm run portal:check` and `npm run portal:test` must pass (baseline: 217 node tests + 14 Playwright; a PDF-download wait test and a CLI-restart test can time out under load — rerun alone before calling a failure).

## Review Focus
- Registration case validation messages are byte-identical for every branch (workflow, workbook-sourced, blocked automation, ID-proof, update target label).
- Seeding still happens exactly once on a fresh data dir and is not re-run (or duplicated) on an existing one; a fresh and a legacy DB end with identical rows.
- A non-registration module with `adapter.json` (see `portal/test/registry-dynamic.test.mjs`) validates and AI-generates exactly as before — neutral wording only, no Registration leakage.
- Reserved-id protection: an `adapter.json` with `id: 'registration'` is still rejected, and a plugin id can't be shadowed by a dynamic adapter.
- Import-time cost/failure: if the registration plugin's data files are missing, the portal must fail the same way as today (these `require`s currently run at import).

## File Structure
```
portal/modules/contract.mjs        documents + validates the plugin shape (assertPlugin)
portal/modules/index.mjs           registerPlugin, pluginFor(module|id), plugins(), reservedIds()
portal/modules/registration/index.mjs      exports the plugin object
portal/modules/registration/adapter.mjs    adapter definition (from registry.mjs:9-26)
portal/modules/registration/validate.mjs   validateCase hook (registry.mjs registration branches)
portal/modules/registration/seed.mjs       seed(store) (store.mjs:5,100-101)
portal/modules/registration/ai.mjs         presets, curated pool, requirement map (ai-generator.mjs)
portal/modules/registration/agent.mjs      reference files + cross-field examples (agent.mjs)
portal/test/module-plugins.test.mjs        contract + characterization tests
```

### Task 0: Characterization snapshot of Registration coupling
**Files:** Create `portal/test/module-plugins.test.mjs`, `portal/test/module-plugins.golden.json`.
**Interfaces:** Produces golden data later tasks must keep green: (a) `JSON.stringify` of `adapters.registration` from `portal/registry.mjs`; (b) the error message (or `ok`) returned by `validateCase` for ~25 Registration cases covering every registration branch (workbook-sourced without `sourceWorkbook`, wrong workflow key, workflow with base/variant, workflow extra inputs, blocked automation with inputs, ID-proof path and enabled ID-proof, update target label, valid fill/save/search/update) plus 3 non-registration dynamic-adapter cases (use the fixture approach in `portal/test/registry-dynamic.test.mjs`); (c) `generateAiCases` output for module `registration` and for a dynamic module with a fixed seed/clock (inject any randomness/time so it is deterministic; compare ids, titles, categories, count); (d) rows (`modules`, `cases` count + first/last case ids, `config.bases` keys) a fresh `openStore` seeds; (e) the `agent.mjs` constants `REFERENCE_FIRST` and the registration cross-field example text, and `readiness` result for the registration module.
- [ ] **Step 1:** Write the tests with golden file + `UPDATE_GOLDEN=1` mode; golden is generated from the CURRENT code.
- [ ] **Step 2:** `UPDATE_GOLDEN=1 node --test portal/test/module-plugins.test.mjs`, then run without the flag three times (stable). Then `npm run portal:test`. Expected: PASS. Checkpoint `p2-task-0`.

### Task 1: Plugin contract and loader
**Files:** Create `portal/modules/contract.mjs`, `portal/modules/index.mjs`; extend `module-plugins.test.mjs`.
**Interfaces:**
- `assertPlugin(p)` throws `Error` unless `p` has `id` (`/^[a-z][a-z0-9-]*$/`), `adapter` (object matching the shape of today's built-in adapter: `id,name,spec,fields,actions,outcomes,variants` + optional `variantLabel,targetLabel,targetPlaceholder,prefix,bases`) and `builtIn: true`; optional hooks are functions when present: `validateCase(ctx) -> void` (throws `HttpError` via `check`), `seed(store) -> void`; optional objects `ai`, `agent`.
- `registerPlugin(p)`, `pluginFor(moduleOrId) -> plugin | undefined` (matches `module.adapter`, then `module.id`; accepts a string id), `plugins() -> plugin[]`, `reservedIds() -> Set<string>`.
- [ ] **Step 1:** Write failing tests: assertPlugin accepts a minimal valid plugin and rejects bad id / missing adapter / non-function hook; `pluginFor` lookup by id, by `module.adapter`, undefined for unknown; `registerPlugin` rejects duplicate ids.
- [ ] **Step 2:** Run to see them fail; implement the two files (pure, no I/O); run to see PASS; `npm run portal:test`. Checkpoint `p2-task-1`.

### Task 2: Registration adapter into the plugin; registry stops special-casing it
**Files:** Create `portal/modules/registration/{adapter,index}.mjs`; modify `portal/registry.mjs:9-26,47,124-131`; modify `portal/data`/`store.mjs` only if they import `registrationData` from registry (leave for Task 4).
**Interfaces:** `modules/registration/adapter.mjs` exports `registrationAdapter` (identical object, same `require` of `tests/modules/registration/fields.ts`) and `registrationData`, `registrationWorkflows`, `workbookAutomation` (same exports registry had; registry keeps re-exporting them so importers don't change until later tasks). `modules/registration/index.mjs` default-exports the plugin `{ id: 'registration', builtIn: true, adapter }` and registers it. `registry.mjs`: `adapters` is built from `plugins()` adapters plus `loadModuleAdapters()`; the literal `'registration'` in `validateAdapterDefinition` (line 47) and `reloadAdapters` (127-128) is replaced by `reservedIds()`, keeping the message `The built-in registration adapter cannot be overridden.` (use `` `The built-in ${raw.id} adapter cannot be overridden.` ``).
- [ ] **Step 1:** Make the golden (a) and registry-dynamic tests the guard; move code; ensure plugin registration happens before first `reloadAdapters()` at import (import `./modules/registration/index.mjs` from registry.mjs; avoid circular import — the plugin must not import registry.mjs; give it its own `check`-free code).
- [ ] **Step 2:** `npm run portal:test`. Expected PASS. Checkpoint `p2-task-2`.

### Task 3: Registration validation hook
**Files:** Create `portal/modules/registration/validate.mjs`; modify `portal/registry.mjs:160-240` (`validateCase`).
**Interfaces:** `registrationValidate({ module, adapter, c, input, check, textValue, ... }) -> void` — receive via one context object everything the removed `isRegistration` branches use (`c`, `module`, `adapter`, `check`, `textValue`, workbook/workflow data), run the SAME checks in the SAME order relative to the generic checks. Because registration checks are interleaved with generic ones (lines 172-237), expose the hook at the exact interleave points as named phases: `plugin.validateCase.phases = { beforeGeneric, afterBlocked, perField(key,value), afterWorkflow, afterAll }` OR split into the minimum number of phase functions that preserves the original order of thrown messages — decide by reading `validateCase`; document the phases in `contract.mjs`. Generic code calls phase hooks only when `pluginFor(module)` has them; `const isRegistration` disappears from registry.mjs. `targetLabel` branch at line 237 becomes `adapter.targetLabel ?? 'Target record or dependency token'` — registration's adapter already has a targetLabel; verify the strings used by the golden are unchanged (the current registration text is `Patient ID or dependency token`, so set the plugin's `validateLabels.update = 'Patient ID or dependency token'` or equivalent without changing the neutral default).
- [ ] **Step 1:** golden (b) is the guard; run `node --test portal/test/module-plugins.test.mjs` first to see it pass on current code, move code, run again. Then full `npm run portal:test`. Checkpoint `p2-task-3`.

### Task 4: Seed hook
**Files:** Create `portal/modules/registration/seed.mjs`; modify `portal/store.mjs:5,100-101` (or the `data/modules.mjs` area where the seed sits after Plan 1 — find `saveModule({ id: 'registration'`).
**Interfaces:** `seed(store) -> void` performs exactly the current `store.saveModule({...})` and the `saveCase` loop; `openStore` calls `plugin.seed(store)` for each plugin in `plugins()` under the SAME condition currently guarding it (read the surrounding code: it runs only when the registration module is absent / on first run — preserve exactly; the hook must not run when the guard is false). `store.mjs` no longer imports `registrationData`.
- [ ] **Step 1:** Golden (d) + `access-api.test.mjs` (expects seeded registration) are the guards; also open a copy of `.portal-backup-*/portal.sqlite` with before/after stores and compare module/case rows. Run `npm run portal:test`. Checkpoint `p2-task-4`.

### Task 5: AI generator hooks
**Files:** Create `portal/modules/registration/ai.mjs`; modify `portal/ai-generator.mjs:41-69,91-98,191-420,577,711`.
**Interfaces:** plugin `ai = { presets: [...], requirementByCategory: {...}, curatedPool(ctx) -> case[] , updateTarget: '{{regId@REG-001}}' }`. `AI_PRESETS` stays exported with the same shape: neutral presets + `plugins().flatMap(p => (p.ai?.presets ?? []).map(x => ({...x, modules:[p.id]})))`. All `module.id === 'registration'` conditionals become `pluginFor(module)?.ai` lookups. Curated-pool entries must be byte-identical (same ids/titles/text).
- [ ] **Step 1:** Golden (c) guard; `npm run portal:test`. Checkpoint `p2-task-5`.

### Task 6: Agent, context, readiness hooks
**Files:** Create `portal/modules/registration/agent.mjs`; modify `portal/agent.mjs:58-62,112`, `portal/app/context.mjs:53,119`, `portal/readiness.mjs:50`.
**Interfaces:** plugin `agent = { referenceDir: 'tests/modules/registration', referenceFirst: [...], crossFieldExamples(module) -> string|undefined }`, plugin `builtIn: true` means "never locked out" (readiness.mjs:50) and "has discovery output" (context.mjs:119 uses the plugin's `discovery: true`). `createAgentRunner` receives `referenceDir` from the first plugin that defines `agent.referenceDir` (today: registration) — default stays `tests/modules/registration`. The text `the production Registration module (…)` in the agent prompt (agent.mjs:112) is generated from plugin data. No change in any generated prompt string for the registration reference.
- [ ] **Step 1:** Golden (e) + `agent*.test.mjs`; `npm run portal:test`. Checkpoint `p2-task-6`.

### Task 7: Test-side hard-coded paths
**Files:** Modify `tests/modules/registration/case-runner.ts:61,63,235`, `cases.spec.ts:12`, `registration.page.ts:4,23` (leave page selectors), `playwright.config.ts:23`, `tests/discovery/module-discovery.spec.ts:30`; create `tests/shared/module-paths.ts`.
**Interfaces:** `moduleDir(kind: 'qa' | 'tests', id = process.env.PORTAL_MODULE_ID ?? 'registration') -> string` returns `qa/modules/<id>` or `tests/modules/<id>`; case-runner/spec use it instead of the literal `registration` path segments (defaults keep today's paths when `PORTAL_MODULE_ID` is unset, e.g. `npm run reg:cases`). `BUILTIN_MODULE_IDS` in module-discovery.spec.ts reads the ids from `qa/modules/*/` that have no `adapter.json` OR from a tiny JSON `portal/modules/builtin-ids.json` generated from `reservedIds()` — choose the simplest that works without importing portal code into Playwright TS; document the choice. `playwright.config.ts:23` reporter gating by `PORTAL_MODULE_ID` stays but its path to `results-reporter.ts` goes through `moduleDir('tests')` only if the reporter lives per module (it does today; do not move it).
- [ ] **Step 1:** `npx tsc --noEmit -p tsconfig.json` (if it passes today) and `npm run portal:test`; run one real Registration case run through the portal queue test (`portal/test/queue.test.mjs` / `module-pipeline.test.mjs`). Do NOT run tests against the live demo site. Checkpoint `p2-task-7` (include `tests/` and `playwright.config.ts`).

### Task 8: Docs and onboarding skill
**Files:** Modify `README.md`, `.claude/skills/onboarding-portal-modules/SKILL.md` (and others that name registry.mjs registration internals), `docs/superpowers/specs/2026-11-09-codebase-structure-design.md` status line.
- [ ] **Step 1:** Add a "Adding a module" section: (a) no code: `qa/modules/<id>/adapter.json` + `tests/modules/<id>/*.spec.ts` as today; (b) with custom logic: a plugin under `portal/modules/<id>/` registered in `portal/modules/index.mjs` with hooks from `contract.mjs`. State that `registrationType` is the generic variant key. Run `npm run portal:check`. Checkpoint `p2-task-8`.

## Self-review notes
- Spec coverage: step 3 (plugin shape + moving Registration in) = Tasks 1-6; step 4 (remove hard-coded refs) = Tasks 2-7 (final grep in the last review: `grep -rn "'registration'" portal --include=*.mjs` must only hit `portal/modules/registration/**` and tests).
- Deliberately NOT done (YAGNI until a second module exists): extracting a shared base runner from `tests/modules/registration/{case-runner,workflow-runner}.ts` (448 + 578 lines, deeply registration-specific); renaming `registrationType`; moving folders on disk.
