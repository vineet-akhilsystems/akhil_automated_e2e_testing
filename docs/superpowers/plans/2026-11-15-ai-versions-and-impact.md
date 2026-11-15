# AI leverage for versions + change-impact audit (plan)

Branch: version-aware-spike. Owner decision ("do it"): all of A-C. The user wants an audit skill that acts as a **trigger**: "if you change X you must also change Y".

## Task A - Change-impact audit (the trigger)
- `qa/impact-map.json`: rules `{id, title, when:[globs], alsoCheck:[{path|glob, why}], verify:[commands]}`. Seeded ONLY from real couplings in this repo (verify each path exists), for example:
  - tests/shared/profile-hash.mjs <-> portal/profile.mjs, tests/fixtures/profile.ts, portal/reporter.cjs, portal/queue.mjs (single hash algorithm)
  - portal/versioning.mjs <-> portal/public/components/version.js (hand-synced copy)
  - portal/routes/*.mjs (new or changed route) <-> README API list, portal/mcp-server.mjs when data should be agent-visible, portal/test/*
  - new audit action string <-> portal/public/pages/members.js ACTIONS
  - report model fields (portal/quality.mjs reportModel) <-> portal/reports/pack.mjs, xlsx.mjs, report_pdf.py, report-pack tests, README
  - run/case JSON shape <-> portal/data/*, summaryRun, snapshot export, mcp-server
  - portal/public/pages/* new tab <-> router.js, pages/modules.js moduleTabs, app.js handlers
  - qa/knowledge/** <-> portal/knowledge.mjs limits, qa/knowledge/README.md table, portal/test/senior-tester.test.mjs
  - module add: portal/modules/<id>, qa/modules/<id>, tests/modules/<id> (three trees) + registry
  - MCP tool added or renamed <-> .claude/skills/* that mention it, README MCP list
  - ai-policy presets <-> Settings UI text, README
- `qa/tools/impact-check.mjs`: pure exported `checkImpact({changed, map, exists})` plus a CLI. It reads changed files from `--staged`, `--range A..B`, or the working tree. For each matched rule it prints "You changed X -> also check Y (why)" and marks each target "changed too" or "NOT in this change". `--strict` exits 1 if any alsoCheck is missing; `--json`; `--validate` fails when a map path or glob matches nothing (stale rule). It never reads file contents of credential or session files and ignores those paths entirely (the env file, the login text file, the saved-session folder).
- `npm run impact` script. Skill `.claude/skills/checking-change-impact/SKILL.md` (when to run: before commit and after any edit to a mapped file; how to read the output; how to add a rule). Short README section.
- Tests (node:test) for matching, strict, validate, glob edge cases, and ignoring credential paths.
- Does not modify Claude settings or hooks (offer later).

## Task B - MCP + failure hints
- MCP tools: `list_automation_versions`, `get_version_matrix` (onlyDifferences), `get_tree` (run=latest|id), `check_change_impact` (changed files -> rules). Same permissions and data as the routes; never return profile.keys.
- `get_run_failures` and `compare_runs`: add `versionDifferences` (appVersion, profile hash, automation number) as a labelled HINT, never a verdict; also in portal/compare.mjs output.
- Tests in the MCP tests; update tool docs.

## Task C - Skills, knowledge, drafting
- Update the triaging-registration-failures skill (use run.appVersion and the automation version instead of the manual build); registration-testing skill pointer.
- New skill `working-with-versions-and-tree`.
- qa/knowledge: versions note in the registration module notes and the README.
- Drafting agent gets the tree (node ids and names) in the analyze brief; cases may carry a suggested `node`; a human approves; an unknown node is ignored. Test in the senior-tester tests.
- Run auditing-project-skills over all skills; fix stale or overlapping findings (list them in the report).

Constraints: no credentials read; no compliance claims; verdicts stay "Suggested"; stage files by name; never stage akhil_test_studio.pen.
