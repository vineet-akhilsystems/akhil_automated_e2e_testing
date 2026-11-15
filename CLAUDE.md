# Test Studio (`augastam_e2e_testing`)

End-to-end QA automation platform for **Augastam EMR** and **Miracle HIS**. Core mission: turn BA uploads (walkthrough videos, spreadsheets, docs, screenshots) into grounded requirements, approved draft cases, and truthful zero-manual Playwright execution (`portal/` + `tests/` + `qa/`).

## Product-Scoped Module Layout
All module files resolve through `tests/shared/module-layout.mjs` (never hard-code flat module paths):
- `qa/<product>/<module>/` — `adapter.json`, `cases/`, `discovery/`, `rules.md`, `tree.json`, `bugs/`, `results/`
- `tests/<product>/<module>/` — `fields.ts`, `<module>.page.ts`, `case-runner.ts`, `cases.spec.ts`, `NOTES.md`
- `portal/modules/<product>/<module>/` — optional custom plugin registered via `portal/modules/contract.mjs` and imported in `portal/registry.mjs` (plus `portal/store.mjs` if seeded)

## Zero-Manual Pipeline & Truthful Runner Rules
- **Intake to Automation:** `portal/intake.mjs` extracts docs and video transcripts/keyframes; `portal/agent.mjs` and `portal/insights.mjs` extract grounded insights + draft cases (`reviewStatus: 'draft'`); `portal/automate.mjs` (`automateModule`, `synthesizeAdapterProposal`, `convertCaseToAutomated`) generates adapters and converts cases to Playwright.
- **Dialog-first locators:** Resolve controls inside `[role="dialog"]:not(.hidden)` before `section.active` / background controls by looping selector arrays sequentially — never comma-separated `.locator('A, B').first()` expecting priority.
- **No false positives:** Fail in `mismatches` whenever an explicit `c.input` control is missing, a `save` action finds no clickable Save/Submit button, a `workflow` performs/verifies zero steps, or unexpected validation errors appear on `created`/`updated`. Keep unimplemented scenarios as `unavailable` / `automation-blocked`.
- **`scanCode` safety (`qa/tools/install-module-adapter.mjs`):** Never put `\b(axios|got)\b` (even inside error strings — use `actual` or `found`), `.auth`/`.env`/`.portal`, `eval`/`Function`, `fs` writes, or concatenated URLs into generated TypeScript.

## Skills & Subagents (`.claude/`)
- **Skills:** `analyzing-module-intake`, `extracting-video-walkthroughs`, `onboarding-portal-modules`, `designing-registration-cases`, `automating-registration-workflows`, `triaging-registration-failures`, `checking-module-isolation`, `checking-change-impact`, `working-with-versions-and-tree`, `auditing-project-skills`, `creating-project-skills`, `routing-work-to-models`, `registration-testing`.
- **Agents:** `explorer` (Haiku read-only search), `intake-analyst` (Sonnet BA intake), `module-automator` (Sonnet adapter synthesis), `playwright-test-planner`, `playwright-test-generator`, `playwright-test-healer`, `implementer` (Sonnet code edits), `reviewer` (Opus final check).

## Hard Guardrails & Verification
- **Secrets & DB:** Never read, print, or edit `.env`, `.env.*`, `login.txt`, `PORTAL_LOGIN.txt`, or `.auth/`. MongoDB is strictly read-only via `node qa/tools/mongo-read.js` (`.claude/hooks/db-readonly-guard.js`).
- **Verification commands:**
  - `npx tsc --noEmit` & `npm run portal:check`
  - `node .claude/skills/checking-module-isolation/check-module-isolation.mjs` (`0 ERROR, 0 NEW`)
  - `node .claude/skills/auditing-project-skills/audit-skills.mjs --agents`
  - `npm run impact` (and `npm run impact -- --validate` when editing `qa/impact-map.json`)
  - `npm run portal:test` (`node --test portal/test/*.test.mjs` + `playwright test --config portal/test/runner.config.ts`)
