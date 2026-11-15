---
name: working-with-versions-and-tree
description: Use when a Test Studio run result needs its version context (which application version, login profile or automation version a run used), when two runs disagree to decide whether the app or the automation changed, when reading the version matrix or the Versions tab, registering an automation version, or editing, validating or using a module's qa/modules/<module>/tree.json test tree (including list_automation_versions, get_version_matrix, get_tree).
---

# Working with versions and the test tree

**Core principle:** version data is context for a human decision, never a verdict. A difference tells you where to look first; it does not say what broke. Anything unknown stays "unknown".

## The three version kinds (all recorded per run; none changes how tests run)

| Kind | Where it comes from | Identity |
|---|---|---|
| Application version | **Typed** on the login profile, or overridden in the run dialog. Stored as `run.appVersion` (`label`, `source` = profile or override). | The label text. Never detected. |
| Login profile hash | **Detected** while the run executes, from which configuration endpoints the app answered. Short 6-character code. | A fingerprint of app configuration, not a version number. A partial run touches fewer endpoints, so its hash differs from a full run's. |
| Automation version | **Automatic**: content hash of the test code and module files, numbered v1, v2, ... per portal database. Same files = same number (a revert returns to the old number). | The hash is the only portable identity; numbers differ between portal installs. |

Older runs have none of these and show "unknown". Re-run buttons keep the original app version label.

## Reading the version matrix

`get_version_matrix` (or the module **Versions** tab, tick **Only differences**): rows are cases, columns are version combinations (app version, profile, automation; at most 8, newest first). A cell is the case's newest result for that combination; blank = no run of that combination covered the case.

- A case that fails only in columns with a new automation version: check the files changed in that version first (the Versions tab lists changed files since the previous version; `list_automation_versions` gives number, note and file count; `git diff` for the rest).
- A case that differs across app versions with the same automation version: the app may have changed; confirm with the team before touching a test.
- Never rewrite an expectation because a column differs. Expectation changes need approval (`triaging-registration-failures`).

## Registering an automation version

A run registers the current files automatically. To record them without running: module **Versions** tab, **Register current automation now**, or `POST /api/modules/<id>/automation-versions` with `{ "note": "..." }` (needs module settings access; returns `existing: true` if nothing changed). Notes are edited with `PUT .../automation-versions/<number>`. Versions are never deleted, and old versions cannot be re-run (fingerprints are stored, not code). There is no MCP tool for registering; ask the user.

## The test tree: `qa/modules/<module>/tree.json`

Read-only grouping of existing cases under nodes, with run results rolled up. Developers edit the file; the portal never writes it.

```json
{ "module": "registration", "note": "optional",
  "nodes": [
    { "id": "root", "name": "Registration", "kind": "root" },
    { "id": "walkin", "name": "Walk-in", "kind": "variant", "parent": "root", "match": { "registrationType": ["Walk-in"] } } ] }
```

Rules (enforced by `validateTree` in `portal/tree.mjs`): ids match `[A-Za-z0-9_-]+`; exactly one root, no `match`; every other node has an existing `parent`; names unique; `kind` is `root|step|variant|group`; `match` keys only `registrationType`, `category`, `action`, each a non-empty string array; no cycles; at most 6 levels. A case goes to the node with the most matching keys (ties: first in file order); the rest are **unassigned**. After editing, load it with `get_tree` or the Tree tab: an invalid file returns the first errors.

## How an agent uses the MCP tools

| Question | Tool |
|---|---|
| Why did this run fail, and did versions change? | `get_run_failures`, `compare_runs` (read `versionDifferences` and its HINT) |
| Which automation changes sit between two runs? | `list_automation_versions` |
| Which cases differ across versions? | `get_version_matrix` with `onlyDifferences` |
| Where do cases sit, what failed per area? | `get_tree` (`run: "latest"` or a run id) |
| I changed these files, what else needs updating? | `check_change_impact` (or `npm run impact`; see `checking-change-impact`) |

When drafting cases for a module with a tree, the portal sandbox agent's analyze brief lists the node ids (the MCP `save_insights` path does not, and ignores `node`). A case may carry an optional `node`; the portal keeps a valid one only as `suggestedNode` and ignores an unknown id. A person places cases; nothing is auto-assigned.

## Limits

- Partial runs: a subset run has its own profile hash and only replaces the cases it ran in the matrix. Compare like with like (full vs full) before reading anything into a hash.
- Numbers are per database: v3 here is not v3 on another portal install.
- Hints compare a run with the previous finished run of the same mode, module and environment, not with an arbitrary baseline.
- Typed app version is only as good as what the team typed; blank means unknown.
- Tools return no login profile keys; do not try to obtain them.
