# Product-scoped module layout (plan)

Branch: miracle-registration-module. Owner decision: migrate Augastam too, now. Goal: a clear separation by product, no mix-up.

## Target layout
- `qa/<product>/<module>/` (cases, discovery, adapter.json, manifest, rules, results, bugs, data, tree.json, intake)
- `tests/<product>/<module>/` (Playwright specs, page objects, runners)
- `portal/modules/<product>/<module>/` (plugin code)
- Shared, not product-scoped: `qa/knowledge/`, `qa/tools/`, `qa/impact-map.json`, `tests/shared/`, `tests/fixtures/`, `tests/discovery/`.
- Example: Augastam Registration = `qa/augastam/registration`, `tests/augastam/registration`, `portal/modules/augastam/registration`; Miracle Registration = `qa/miracle/registration` (portal module id `miracle-registration`).

## Rules
- **Module ids do not change** (database rows, runs, cases and snapshots keep working). Augastam keeps id `registration`.
- The folder is a function of (product id, module id) from ONE resolver. `folder = id` with a leading `<product>-` removed (`miracle-registration` -> `registration`; `registration` stays). Both parts must match `/^[a-z0-9][a-z0-9-]*$/`.
- An adapter.json declares `id` and `product`; the registry rejects it when its folder is not the one the resolver gives for that pair.
- No code builds a module path by hand: runtime, tests, tools, skills and docs call the resolver or name the new layout.
- Old `qa/modules/...`, `tests/modules/...` strings must be gone after the migration (a test enforces it).

## Tasks
1. **Resolver (shared, single source).** `tests/shared/module-layout.mjs` (+ `.d.mts`): `moduleFolder(kind: 'qa'|'tests'|'portal', productId, moduleId)`, `productFolder(kind, productId)`, `productIds(root, kind)`, validation errors with plain messages. `portal/module-layout.mjs` re-exports. Rewrite `tests/shared/module-paths.ts` to use it (`moduleDir(kind, product, id)`). Tests: prefix stripping, invalid ids, traversal attempts, all three kinds.
2. **Runtime and test code use the resolver.** portal: context (qaRoot, referenceDir, discoveryDir, spec path), agent (discoveryRoot, reference agent, tree, brief text), automation-versions, registry (scan `qa/*/*/adapter.json`; adapter declares product; spec must be under `tests/<product>/<module>/`), tree, tree.js UI text, plugin loading (`portal/modules/<product>/<module>`), validate.mjs data path, queue env `PORTAL_PRODUCT_ID`, playwright.config, tests/discovery spec (`MODULE_PRODUCT` env), qa/tools (install-module-adapter, scaffold-module-fields, impact-check generated globs). Keep behaviour identical for Augastam. Tests updated, none weakened.
3. **Physical move + references.** `git mv` qa/modules/registration -> qa/augastam/registration, tests/modules/registration -> tests/augastam/registration, portal/modules/registration -> portal/modules/augastam/registration, plus the `qa/modules` and `tests/modules` empty parents removed. Update: package.json scripts, .gitignore, .dockerignore, `portal-data/snapshot.json` stored case input path, the cases JSON string, qa/impact-map.json (+ its tests), registration-only qa/tools scripts, skills, agents, README, docs (historical plans/specs get a one-line note rather than rewriting history), isolation check. Full suite + tsc + playwright runner config before and after, identical counts.
4. **Guard.** A test that fails when `qa/modules/`, `tests/modules/` or hand-built module paths appear in code; extend `checking-module-isolation` to check product folders do not reference each other; an impact-map rule for the layout.
5. **Miracle enablement (after the migration, needs a saved Miracle session).** Unblock Miracle in readiness, session spec, read-only discovery, page object, runner, first cases.

Constraints: no credentials read; no live-site runs in tasks 1-4; stage files by name; never stage `akhil_test_studio.pen` or the untracked automation-inputs json; one commit per task minimum.
