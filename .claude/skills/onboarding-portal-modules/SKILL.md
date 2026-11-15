---
name: onboarding-portal-modules
description: Use when adding, scaffolding, or connecting browser automation for a new Augastam EMR or Miracle module in Test Studio (such as EMR, Billing, Appointment, Facility Setup), synthesizing or installing a module adapter (qa/<product>/<module>/adapter.json or a portal/modules plugin), or hardening Playwright runners against false positives.
---

# Onboarding portal modules

**Layout:** every module has three folders named by `tests/shared/module-layout.mjs`: `qa/<product>/<folder>`, `tests/<product>/<folder>`, `portal/modules/<product>/<folder>`, where `<folder>` is the module id with any leading `<product>-` removed (`miracle-registration` -> `registration`). Never build these paths by hand; see `docs/superpowers/plans/2026-11-15-product-scoped-layout.md`.

**Core principle:** every automated module in Test Studio is driven by a declarative adapter (`qa/<product>/<module>/adapter.json` or a plugin under `portal/modules/<product>/<module>/`, loaded by `portal/registry.mjs`) paired with a Page Object, `tests/<product>/<module>/fields.ts`, and a truthful data-driven Playwright runner under `tests/<product>/<module>/` that must fail clearly when controls, buttons, or expected outcomes are missing.

## Quick reference

| Artifact / Flow | Repo path | Purpose |
|---|---|---|
| Adapter synthesizer | `portal/automate.mjs` | `automateModule`, `synthesizeAdapterProposal`, `convertCaseToAutomated`, `runModuleDiscovery` (invoked by `POST /api/modules/:id/automate` and `POST /api/agent/jobs/:jid/install`) |
| Adapter registry | `portal/registry.mjs`, `portal/modules/` | Loads plugins and `qa/<product>/<module>/adapter.json` manifests |
| Reference module | `tests/augastam/registration/` | Custom-tuned reference (`tests/augastam/registration/registration.page.ts`, `tests/augastam/registration/fields.ts`, `tests/augastam/registration/case-runner.ts`, `tests/augastam/registration/cases.spec.ts`, `tests/augastam/registration/discovery.spec.ts`) |
| Generic discovery | `tests/discovery/module-discovery.spec.ts` | `npm run module:discover` (`MODULE_PRODUCT`, `MODULE_ID`, `MODULE_URL`); writes `qa/<product>/<module>/discovery/` read-only |
| Field scaffold | `qa/tools/scaffold-module-fields.mjs` | `npm run module:scaffold -- <module> --product <product>` builds `tests/<product>/<module>/fields.ts` from discovery |
| Proposal installer | `qa/tools/install-module-adapter.mjs` | `npm run module:adapter:install -- --module <module> --product <product> --job <jobId>` scans code via `scanCode`, installs files, runs checks |
| Portal checks | `npm run portal:check`, `npm run portal:test` | Verifies TypeScript/syntax, SQLite migrations, registry validation, and runner contracts |
| Isolation check | `node .claude/skills/checking-module-isolation/check-module-isolation.mjs` | Ensures module and product separation |

See [module-adapter-template.md](module-adapter-template.md) for templates and `scanCode` / truthfulness invariants.

## Two-tier onboarding workflow

### Tier 1: Zero-manual synthesized adapter (`portal/automate.mjs`)
For any non-built-in module with uploaded walkthrough videos, specs, or draft cases:
1. Run intake extraction + insights analysis (`analyzing-module-intake` skill) so insights (`fields`, `flows`, `rules`) and draft/approved cases exist in the store.
2. Run **Automate** (`POST /api/modules/:id/automate` or `automateModule({ module, store })`):
   - Synthesizes `tests/<product>/<module>/fields.ts`, `tests/<product>/<module>/<id>.page.ts`, `tests/<product>/<module>/case-runner.ts`, `tests/<product>/<module>/cases.spec.ts`, `tests/<product>/<module>/NOTES.md`, and `qa/<product>/<module>/adapter.json` (plus `qa/<product>/<module>/discovery.json` if `setup.discoveryUrl` is reachable).
   - Validates every generated file with `scanCode` (`qa/tools/install-module-adapter.mjs`) and converts existing cases (`reconvert: true`) via `convertCaseToAutomated` using action/step hints and insights fields without injecting unrelated fields.
3. Run the generated `tests/<product>/<module>/cases.spec.ts` against the target environment (or local simulator when staging is unreachable) and verify both **PASS on real controls** and **FAIL on a blank/broken screen**.

### Tier 2: Custom refinement & live DOM discovery
When live staging differs from walkthrough labels or needs custom response assertions:
1. Run read-only discovery (`$env:MODULE_PRODUCT='<product>'; $env:MODULE_ID='<module>'; $env:MODULE_URL='/<path>'; npm run module:discover`) once the user refreshes auth via `npm run auth`.
2. Scaffold/update `tests/<product>/<module>/fields.ts` (`{ card, label, kind, column }` without `*`, plus `FILL_ORDER`), then refine `tests/<product>/<module>/<id>.page.ts` / `tests/<product>/<module>/case-runner.ts` using `tests/fixtures/auth.ts` and `tests/fixtures/evidence.ts`. Copy patterns from `tests/augastam/registration/` — never import from it.
3. Register custom plugin hooks (validation, seed, AI generators) only if needed under `portal/modules/<product>/<module>/index.mjs` (import once in `portal/registry.mjs` and `portal/store.mjs` if seeded).
4. Verify with `npx tsc --noEmit`, `npm run portal:check`, `npm run portal:test`, and `node .claude/skills/checking-module-isolation/check-module-isolation.mjs`.

## Truthful runner & `scanCode` rules

- **Dialog-first control resolution:** Open modals (`[role="dialog"]:not(.hidden)`) must take priority over background controls. Never write `.locator('A, B').first()` expecting priority — Playwright matches comma selectors in DOM order. Iterate `['[role="dialog"]:not(.hidden) ...', 'section.active ...', '...']` sequentially.
- **No silent false positives:** `tests/<product>/<module>/case-runner.ts` MUST record FAIL (`mismatches`) when any explicit `c.input` field control is not found (`Field control "<key>" was not found on the page.`), when a `save` action cannot find/click Save/Submit, when a `workflow` performs/verifies 0 steps, or when unexpected validation errors appear on `created`/`updated`.
- **Unimplemented cases stay blocked:** Mark unimplemented flows with action `unavailable` / outcome `automation-blocked` so runs report `BLOCKED`, never `PASS`.
- **`scanCode` compliance (`qa/tools/install-module-adapter.mjs`):** Synthesized and installed TypeScript files must never contain `\b(axios|got)\b` (even inside error strings — write `actual` or `found`), `.auth`/`.env`/`.portal`, `eval`/`Function`, `fs` write APIs, or string concatenation inside `goto()`/`fetch()`.
- **Shared invariants:** Keep `registrationType` as the generic variant key, use `moduleDir('qa' | 'tests', '<product>', '<module>')` (`tests/shared/module-paths.ts`), prefix created records with `Agent Testing`, and guard updates with `assertAgentRecord()`.
