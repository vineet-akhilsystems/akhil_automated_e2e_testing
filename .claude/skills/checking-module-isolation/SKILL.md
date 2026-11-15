---
name: checking-module-isolation
description: Use when checking that Test Studio module code is not mixed together - "is Billing code mixed with Registration", "did this change touch shared code", reviewing or finishing a new module (tests/<product>/<id>, qa/<product>/<id>, portal/modules/<product>/<id>), adding a qa/tools script, editing shared files (portal/*.mjs, tests/fixtures, tests/shared, tests/smoke, playwright.config.ts), or before sharing module work.
---

# Checking module isolation

**Core principle:** a module's code lives only in its own three folders and never refers to another module. Shared code stays module-neutral. A module refers to shared code; shared code never refers to a module. The only exceptions are the reviewed ones in the script's `BASELINE`, each with its reason.

**Product rule:** a product's folders (`qa/<product>/**`, `tests/<product>/**`, `portal/modules/<product>/**`) must not refer to another product's folders; the script reports this as an ERROR. Product and module folder names come from the layout resolver (`tests/shared/module-layout.mjs`).

## Quick reference

| What | Where |
|---|---|
| Run the check (exit 1 on a problem) | `node .claude/skills/checking-module-isolation/check-module-isolation.mjs` |
| List the accepted exceptions and known issues too | add `--all` |
| Module-owned folders | `tests/<product>/<id>/`, `qa/<product>/<id>/`, `portal/modules/<product>/<id>/`, and `qa/tools/` scripts whose name contains `<id>` |
| Shared, must stay neutral | `portal/` (except `portal/modules/<product>/<id>/`), `tests/fixtures/`, `tests/shared/`, `tests/smoke/`, `tests/discovery/`, `tests/*.ts`, `playwright.config.ts`, other `qa/tools/` scripts |
| Test-side module paths | `moduleDir('tests' \| 'qa', '<product>', '<id>')` in `tests/shared/module-paths.ts` |
| How the portal picks a module's spec | `adapters[run.module.adapter].spec` (`portal/queue.mjs:185`); spec must be `tests/<product>/<id>/*.spec.ts` (`portal/registry.mjs:46`) |

## Reading the output

- **ERROR**: a file owned by module A refers to module B, by path, by `'<id>'` literal, or by a `../<id>/` import. Always fix it. If both modules need the code, move it to shared code (`tests/fixtures/`, `tests/shared/`) and make it take the module id as a parameter.
- **NEW**: shared code refers to a module and has no baseline entry. Make the shared code take the module id from the caller or the adapter. Add a `BASELINE` entry only if the reference is truly intended (like a plugin import line), with a factual reason, and tell the user you added it.
- **KNOWN**: a reviewed exception. `by design` entries are intended. `issue` entries are agreed debt. Don't copy them for a new module.
- **STALE**: a baseline entry that no longer matches anything. Remove it.

## Procedure

1. Run the check before you start, so you know the baseline is clean.
2. Make the change.
3. Run it again. Fix every ERROR and NEW. Never silence one by adding a baseline entry without telling the user.
4. Report what you ran and the final counts line.

## Rules that the script cannot check

- `registrationType` is the generic variant key on every module's cases, kept for compatibility (`README.md:234`). Use it for any module's variants. Don't rename it, and don't add a `billingType`.
- `moduleDir(kind, product, id)` requires the module's own product and id (`tests/shared/module-paths.ts:8`). Never add back a default for either, because a default lets one module or product write into another's folders.
- `tests/smoke/session.spec.ts` is the module-neutral session check (it opens `/` and expects the signed-in workspace). A module's own preflight, which opens its page, goes in `tests/<product>/<id>/session.spec.ts`, like Registration's.
- No module needs a `run-<id>-e2e.mjs` for portal runs. The portal launches the adapter's spec itself (`portal/queue.mjs:185`). `qa/tools/run-registration-e2e.mjs` is a Registration-only command-line tool.
- A new built-in plugin adds one import line for `portal/modules/<product>/<id>/index.mjs` in `portal/registry.mjs` (`README.md`, "Adding a module" (b)). That line is the only shared-code change it may make, plus a matching `portal/store.mjs` import if the plugin has a `seed` hook (see the comment at `portal/store.mjs:6`).

## Common mistakes

| Mistake | Fix |
|---|---|
| Importing `RegistrationPage` or `case-runner.ts` helpers into another module | Copy the pattern into the new module, or move the helper to `tests/fixtures/` and make it generic |
| Adding `if (module === '<id>')` branches to `portal/*.mjs` | Put module behavior in plugin hooks (`portal/modules/contract.mjs`) or the adapter |
| Hard-coding `qa/<product>/<id>/...` in a shared tool | Take the product and module id as arguments and use `moduleDir()` / the layout resolver |
| Treating "0 ERROR" as proof of separation | The script checks references only. Also check the rules above by reading the diff |
