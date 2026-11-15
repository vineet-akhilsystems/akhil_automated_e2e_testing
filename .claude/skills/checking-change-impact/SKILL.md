---
name: checking-change-impact
description: Use before committing, and after editing any file that is coupled to another (portal/routes, portal/quality.mjs, portal/mcp-server.mjs, portal/ai-policy.mjs, portal/versioning.mjs, tests/shared/profile-hash.mjs, qa/knowledge, module folders, portal/public/pages) - "what else do I need to update", "did I miss a file", reviewing a diff for forgotten follow-up changes, or adding a coupling rule.
---

# Checking change impact

**Core principle:** some files must change together (a hand-synced copy, a golden file, a doc list). `qa/impact-map.json` records those couplings and the checker tells you which partner files are missing from your change. It is a safety net, not a replacement for tests: a clean result does not mean the change is correct.

## Run it

| Goal | Command |
|---|---|
| Working tree (default) | `npm run impact` |
| Only what is staged | `npm run impact -- --staged` |
| A commit range | `npm run impact -- --range A..B` |
| Fail when a partner is missing | add `--strict` (exit 1; advisory rules do not count) |
| Machine output | add `--json` |
| Check the map itself is not stale | `npm run impact -- --validate` |

## Read the output

Each matched rule prints `You changed X`, then `-> also check Y (why)` per target, marked **changed too** (done) or **NOT in this change** (open). For every NOT line, open the file and decide: update it, or confirm it needs nothing. Then run the `verify:` commands. A target can be a glob; "changed too" means any file under it changed.

Credential and saved-session files are skipped entirely: never read, never listed. Generated outputs (`qa/modules/*/results/**`) are ignored too.

## Add a rule

1. Find a real coupling by reading code (an import, a hand-synced copy, a golden file, a doc list). Do not add guesses.
2. Add to `qa/impact-map.json`: `id`, `title`, `when[]` (globs that trigger), `alsoCheck[]` (`path` or `glob`, plus `why`), `verify[]` (commands).
3. Run `npm run impact -- --validate`. A path or glob that matches nothing is reported as stale; fix or drop it.
4. Glob syntax: `*` stays in one folder, `**` crosses folders, `?`, `{a,b}` (nesting allowed). `{module}` matches one folder name and is reused in targets, so a rule can point at the same module in another tree. No other features.
5. A target equal to one of the rule's own `when` entries is listed only while it is still missing (use this for files that must change together). Mark a noisy rule `"severity": "advisory"`: it is shown but `--strict` ignores it.
6. `--validate` also checks that test files and npm scripts named in `verify` exist.

When a coupling is removed or a file is renamed, update the rule; `--validate` will flag the stale path.
