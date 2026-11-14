# Test Studio: what we have, what others have extra, and what to adopt

Date: 2026-11-14. Sources: repo scan (README, docs, `portal/`, `playwright.config.ts`), plus public pages of QAAI, Open-QA, Playwright Test Agents, TestDino, Testomat.io, Testiny, ReportPortal.
Caveat: competitor facts come from their README/marketing pages, not from running them. "We don't have it" means a keyword search of `portal/` found nothing; verify before building.

Legend: [x] we have it | [~] partly | [ ] we don't have it

## A. What we already have (strengths)

### Authoring and intake
- [x] BA document intake (Excel, PDF, video walkthroughs) with insights per module
- [x] AI case drafts via MCP assistant; cases stay draft until a human approves (review queue)
- [x] Manual and automated case types; suites; requirement/ticket references
- [x] Shared starting-data templates; each run snapshots cases and data (history cannot change)
- [x] Module plugin contract (`portal/modules/`, `adapter.json`), readiness checklist per module

### Execution
- [x] Persistent FIFO queue, parallel workers (`PORTAL_WORKERS`, 1-16), cancel and rerun
- [x] Session/login preflight; encrypted credential profiles (AES-256-GCM)
- [x] Playwright traces on failure, full-page screenshots at every stage, optional video

### Results and reporting
- [x] Expected vs actual, mismatches, observation-only and assumed-rule kept distinct
- [x] Failure classification: failed assertion / business-rule review / execution issue / blocked
- [x] Coverage and gaps view (field assertions, never-run, stale after edit, requirement coverage)
- [x] Branded PDF bug report, Excel and JSON export, severity triage, secret redaction
- [x] Roles, teams, memberships, audit log, OpenAPI spec, MCP server, Docker

### Where we are ahead of the open-source field
- Human-approval gate on AI cases, with stale-evidence tracking
- Requirement-based coverage, which most Playwright dashboards lack
- Evidence-grade PDF reports and secret redaction

## B. What others have that we lack, with a solution we can use

Priority: P1 = do soon (cheap, high value), P2 = next quarter, P3 = future/watch.

### B1. Reliability and flakiness
| Item | Who has it | Our status | Solution to use | Priority |
|---|---|---|---|---|
| [x] DONE 2026-11-14: Automatic retry of failed cases, with "flaky" label when retry passes | Playwright (`retries`), QAAI, TestDino | `PORTAL_RETRIES` default 1 | Set `retries: 1` for portal runs; store attempt count per result; mark pass-on-retry as `FLAKY`, not `PASS` | P1 |
| [x] DONE (history strip, no heatmap yet): Flake rate per case over time | QAAI, TestDino, ReportPortal | none | Compute from our run history table (fail/pass flips over last N runs); show badge on case list | P1 |
| [ ] Quarantine: exclude known-flaky cases from gating | TestDino, Testomat.io | none | `quarantined` flag on case; runs report them but do not fail the run | P2 |
| [ ] Failure auto-grouping (same error across cases) | ReportPortal (clustering), Open-QA (timeout/assertion/locator/network) | partial (4 classes) | Add sub-classes by error text: timeout, locator, network, assertion; cluster identical messages | P2 |

### B2. Trends and dashboards
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [x] DONE: Pass-rate trend, duration trend, slowest cases | TestDino, Open-QA (sparklines), YuanTest | none | Aggregate `data/runs.mjs` per module per day; simple sparkline charts on workspace page | P1 |
| [ ] Live log streaming during a run | Open-QA (SSE) | check; runs page may poll | SSE endpoint streaming worker stdout (we already capture it) | P2 |
| [ ] Release/build comparison ("what changed since last run") | TestDino, Testomat.io | none | Diff two runs of the same module: newly failing / newly passing | P2 |

### B3. Healing and maintenance
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [~] Locator healing | Playwright healer agent, Open-QA (ranks testid > role > label > css with confidence) | agent file exists in `.claude/agents`; not wired into the portal | On an `ERROR`/locator failure, offer "Suggest fix" that calls the healer and shows a diff for human approval. Never auto-commit | P2 |
| [ ] Locator hygiene rules (prefer role/testid) | Open-QA | none | Lint our page objects for CSS/XPath-only selectors | P3 |
| [ ] Auto Page Object generation | Open-QA | `module:scaffold` generates `fields.ts` only | Extend scaffold with Playwright agents' planner output | P3 |

### B4. Test types we do not cover
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [ ] Accessibility scan | Open-QA (A11y agent) | none | `@axe-core/playwright` as an optional step per module; report violations as "observed" findings | P2 |
| [ ] Visual regression | Open-QA, Meticulous, Percy-style tools | screenshots saved, not compared | Playwright `toHaveScreenshot` for stable screens only (EMR data changes a lot, so mask dynamic regions) | P3 |
| [ ] API-level checks (route/API coverage) | QAAI | none (Mongo used for assertions) | Record network calls from traces; list endpoints hit per case; later add API assertions | P3 |
| [ ] Cross-module workflows | not common in open source | listed as "future work" in README | Chain cases with shared setup/cleanup steps, once each module is stable | P3 |

### B5. Integrations and automation
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [x] DONE: Scheduled runs (nightly smoke) | TestDino, Testiny, Testomat.io | none (docs defer it) | Cron in the portal queue: a saved "run plan" fires on a schedule; needs session refresh and data cleanup first | P1 |
| [ ] CI trigger and status (GitHub Actions / pipelines) | QAAI (Checks), all commercial | none (`.github/` absent) | Small CLI/API call to create a run and poll result; exit code for CI. We already have an OpenAPI spec | P2 |
| [x] DONE (webhook; email not built): Notifications (Slack/Teams) on failure | TestDino, Testomat.io | none | Webhook + email on run finish with summary link | P1 |
| [ ] Defect push to Jira/Azure DevOps/GitHub issue | QAAI (auto issues), Testomat.io, Testiny | external reference field only | "Create ticket" button from a triaged finding, prefilled from PDF data | P2 |
| [ ] Git/PR-aware test selection | QAAI (PR diff planning) | none | Map modules to repo paths; suggest cases when a PR touches them | P3 |

### B6. AI features
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [x/~] Plan, generate, heal agents | Playwright Test Agents | agents present; portal uses MCP drafting | Keep; add heal flow (B3) | - |
| [ ] AI post-mortem per run ("why did this fail") | Open-QA | none | Summarise failures per run via assistant over MCP (`get_run`); store as insight | P2 |
| [ ] Multiple/local LLM choice (Ollama) | QAAI, Open-QA | policy file exists (`ai-policy.mjs`) | Evaluate local model for sensitive EMR data; keep approval gate | P3 |
| [ ] Deterministic mock mode (no API key) | Open-QA | check | Mock assistant for CI and demos | P3 |

### B7. Scale and operations
| Item | Who has it | Our status | Solution | Priority |
|---|---|---|---|---|
| [~] Parallel execution | Playwright sharding | one process per case group | Fine for now; add multi-machine workers only when demand justifies | P3 |
| [ ] Database/storage for teams (Postgres, signed URLs) | QAAI (Supabase) | SQLite + local files | Move when more than one server or many users | P3 |
| [ ] Standard report formats (JUnit, Allure, HTML) | ReportPortal, TestDino | custom JSON/Excel/PDF | Emit JUnit XML for CI tools; low effort | P2 |

## C. Things not to copy
- QAAI is archived (read-only since Sep 2026); borrow ideas, do not depend on it.
- Auto-healing that edits tests without review: conflicts with our "evidence must be trustworthy" rule.
- Self-reported "100% complete" claims in competitor READMEs: unverified.
- Commercial SaaS (TestDino, Testomat.io): patient data and credentials should stay on our side.

## D. Suggested plan

Phase 1 (small, high value; about 1-2 weeks)
1. Retries with FLAKY status and per-case flake rate (B1)
2. Pass-rate and duration trends on workspace/module pages (B2)
3. Failure notification via email/webhook (B5)
4. Scheduled nightly smoke run (B5), after confirming session refresh and data cleanup

Phase 2 (next)
5. Quarantine flag, failure sub-classes and clustering (B1)
6. Run-to-run comparison, JUnit export, CI trigger endpoint (B2, B7, B5)
7. "Suggest fix" locator healing with human approval; AI post-mortem (B3, B6)
8. Accessibility scan step (B4); Jira/GitHub ticket creation (B5)

Phase 3 (watch or later)
9. Visual regression on stable screens, API coverage, cross-module workflows
10. PR-aware case selection, local LLM option, Postgres/multi-machine scale

## E. Open questions
- Is a CI server available for B5, or will runs stay portal-only?
- Which ticket system does the team use (Jira, Azure DevOps, GitHub)?
- Which channel for failure alerts (email, Teams, Slack)?
- Can patient-like data ever leave the machine (affects cloud LLMs and SaaS tools)?
