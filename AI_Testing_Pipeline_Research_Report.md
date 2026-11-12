# AI-assisted application testing: research and implementation report

Prepared for Vineet Kukreti | 29 October 2026

## 1. Decision

Build your module-by-module workflow around **Claude Code + Playwright Test + the official Playwright testing agents**. Add video ingestion as an input adapter and use your existing test cases as the source of expected behavior.

The most valuable custom work is a small application-specific coordination layer: module manifests, rule definitions, data setup, coverage mapping, failure classification, and evidence-backed bug drafts. Browser control, execution, recording, tracing, and basic agent roles already exist.

Assumption: the application is a browser-based system with an accessible test environment. Native mobile or desktop surfaces require a separate automation driver. Findings below are documentation research, not a benchmark on your application. Recommendations and proposed thresholds are engineering judgments, not vendor performance guarantees.

## 2. What is already available

| Component | Verified capability | Recommended use | Main qualification |
|---|---|---|---|
| Official Playwright Test Agents [1] | Planner, generator, healer; Claude Code initialization | Primary starting point for test authoring | Needs your environment setup and expected outcomes |
| Official Playwright CLI and skills [2] | Browser commands and installable coding-agent skills | Additional browser exploration in Claude Code | Distinct from the Test runner and its agent setup |
| Official Playwright MCP [3] | Structured browser control through accessibility data | Use when an agent workflow needs MCP tools | A browser interface, not a complete QA pipeline |
| Anthropic webapp-testing skill [4] | Python Playwright guidance, screenshots, logs, server helper | Optional lightweight local testing reference | Does not provide your enterprise coverage model |
| claude-video / Watch [5] | Video analysis through frames/transcription or a Gemini engine | Pilot for converting demonstrations into timestamped steps | Community project; local and cloud paths differ |
| Playwright Codegen [6] | Records live browser actions into test code | Capture a new demonstration alongside your video | Does not import an existing MP4 |
| Stagehand [7] | Natural-language actions and structured extraction | Optional when AI-driven interaction is valuable | Adds another abstraction; validate on your controls |
| Browser Use [8] | Python browser-agent framework and hosted options | Alternative exploration engine | More coordination needed for regression-test governance |
| Midscene.js [9] | Vision-based automation, YAML testing, Playwright integration | Evaluate for difficult visual controls | Model-dependent operation needs measurement |
| Meticulous [10] | Instrumented session recording and replay | Optional frontend regression evaluation | Recorded backend responses are mocked by default |
| QA Wolf [11] | Commercial platform with exportable Playwright tests | Build-versus-buy benchmark | Confirm commercial scope, data access, and contract |
| Schemathesis [12] | Property-based API testing from OpenAPI/GraphQL | Add backend validation and edge cases | Domain rules still need explicit checks |

### The closest match: Playwright Test Agents

The official agents explore an app, produce a Markdown plan, generate tests, and attempt repairs. Initialize Claude Code support using:

```bash
npx playwright init-agents --loop=claude
```

Give the planner a working seed test and your requirements. The seed establishes the setup and fixtures. Generated definitions should be refreshed when upgrading Playwright. [1]

**Important:** official documentation says the healer may output a skipped test when it believes functionality is broken. Preserve the original failure and reject unapproved skips or weakened assertions. [1]

### CLI skills versus MCP versus Test

These solve different problems. Skills are reusable instructions; agents perform scoped jobs; CLI/MCP tools let them operate a browser; the Test runner executes your saved regression suite.

Microsoft's MCP repository describes CLI plus skills as a more token-efficient option for coding agents, while MCP remains useful for persistent, iterative browser work. This is vendor guidance; measure actual token consumption in your environment. [3]

Use the generated Test Agents' own configuration first. Add CLI skills if needed for broader exploration; avoid combining multiple browser sessions with different login states accidentally.

### Anthropic's skill: useful but narrower

The webapp-testing skill supplies Python Playwright examples and a helper for starting local servers. It is a practical starter for local browser checks. [4] My recommendation for this large application is TypeScript Playwright Test as the shared regression layer, even if your backend is Python. This reduces adaptation around the official test-agent workflow.

Do not copy its blanket network-idle waiting pattern into every test: long polling and WebSockets can make it unsuitable. Prefer observable readiness, specific responses, and retrying assertions as appropriate to each screen. Playwright documents assertions that retry until their expected condition is met. [13]

## 3. Improve the video-input approach

Your original idea is viable as a starting point: a walkthrough explains navigation, terminology, screen transitions, and the intended user journey. However, pixels do not expose DOM locators, hidden validation, server persistence, or the complete business specification.

For example, a video showing an invoice saved at 900 does not prove whether discounts apply before tax, whether rounding is correct, or whether another role can edit it.

Use this input bundle for each module:

| Input | Minimum useful content |
|---|---|
| Existing test cases | Stable case ID, steps, expected result, priority |
| Walkthrough | Short task-focused clip with role and narration |
| Rules | Validation, calculations, permissions, allowed state transitions |
| Environment | Test URL, build identifier, tenant, feature flags |
| Access | Test account references for each relevant role |
| Test data | Fixtures, dependencies, reset and cleanup mechanism |
| Optional context | API specification, code paths, relevant past defects |

### Existing videos

Watch is a community skill worth piloting. Its current repository describes a local frame-extraction path and a Gemini video-analysis path. The cloud path uploads local videos to Google; a local extraction path does not by itself mean the downstream language-model analysis is offline. Audio transcription may need additional setup. [5]

Produce timestamped steps and attach evidence frames. Record observations separately from inferred requirements. Flag uncertainty instead of inventing rules. Sample transitions and validation messages more densely than static screens; sparse fixed sampling can miss brief errors.

For healthcare demonstrations, use synthetic records and remove identifiers before sharing material with external model providers. Video and traces can expose the same sensitive data as the application.

### New recordings

When recording a module now, capture a live Codegen session alongside the video. Codegen records interactions and proposes locators, which is more informative than reconstructing every click from pixels. [6] Keep narration for the reasons and business rules behind those actions. Review the generated code and add persistence and negative assertions.

**Preferred combination:** video for explanation, live inspection for controls, existing cases and reviewed rules for correctness.

## 4. Proposed pipeline

Use one reusable pipeline with module configuration, rather than building a different orchestration system for every module.

### Phase A: turn inputs into a test specification

1. Import existing cases and retain their IDs.
2. Extract timestamped observations from the video.
3. Merge them with written requirements using this precedence: reviewed acceptance criteria and rules, then existing expected outcomes, then observed behavior. Mark conflicts for resolution.
4. Create a coverage map linking each case and rule to planned tests.
5. Record unknown requirements as blocked questions. Continue generating cases that have clear expectations.

Deliverables: module manifest, workflow notes, normalized cases, rule list, coverage map, unresolved questions.

### Phase B: inspect and author

1. Start an isolated staging session with a scoped test account.
2. Use the planner to explore the module within allowed boundaries.
3. Compare the discovered plan to your existing cases, including missing negative paths.
4. Generate Playwright tests against the live application.
5. Reuse fixtures for login, navigation, test data, and cleanup.
6. Attach case IDs to test titles or metadata.
7. Review correctness assertions before promoting tests into regression coverage.

Avoid reproducing the same login and data-preparation sequence in every generated file. Prefer API setup for prerequisites, while retaining selected UI tests for the setup workflows themselves. Playwright supports API setup and checking server state after browser actions. [14]

### Phase C: execute and collect evidence

Run saved tests through normal CI without requiring an AI decision at each click. Capture results, relevant screenshots, failed-run videos, traces, console errors, failed requests, and build metadata.

Playwright Trace Viewer provides action history, DOM snapshots, console information, and request/response inspection. [15] Video recording is an execution artifact; it is separate from ingesting your demonstration video. [16]

### Phase D: triage

Classify failures into product defect, test defect, environment problem, data/setup problem, intermittent failure, or unclear requirement. AI can propose a classification; require reproduction and evidence before marking a new product defect confirmed.

Send only a compact failure bundle to the model first: case ID, failing assertion, expected/actual values, relevant logs and screenshot. Fetch deeper trace content when needed. This controls cost and avoids irrelevant context.

### Phase E: repair or report

For a stale locator, propose a test-only patch that preserves the original behavior being checked. For a genuine product failure, preserve the failing test and create a bug draft. Treat product-code fixes as a separate development change.

Suggested pilot limit: one clean reproduction and at most two proposed repair attempts per failure. Then return a review item. This is a proposed operating policy.

## 5. Finding logic bugs

The crucial ingredient is an independent expected result. A success toast, HTTP 200, or absence of console errors is insufficient evidence of business correctness.

Illustrative billing rule: a 10% discount on a 1,000 subtotal, with no tax or extra charges, should produce 900. Check the displayed amount, saved API record, and read-after-refresh value. If tax order or rounding is unspecified, the test must flag that gap rather than assume an answer.

| Defect class | Example check | Best evidence |
|---|---|---|
| Required-field validation | Missing required patient name blocks submission | UI message plus absence of a created record |
| Business calculation | Discount and rounding match written rules | Independently calculated expected value and saved amount |
| Persistence | Saved edit survives reload and new session | Read-after-write API/UI check |
| Duplicate submission | Double submit creates one record where required | Record count and request correlation |
| State transition | Cancelled appointment cannot become completed under stated policy | API response and unchanged state |
| Permissions | Restricted role cannot perform an action | UI restriction and direct API denial |
| Tenant isolation | Tenant A cannot fetch Tenant B records | Controlled cross-tenant API checks |
| Concurrency | Competing bookings obey the documented slot policy | Concurrent requests and final state |
| Recovery | Timeout/retry does not lose or duplicate data | Request log, persisted records, visible recovery |
| Cross-module integration | Invoice and patient ledger agree | Both modules plus relevant API state |

Use Playwright for user journeys and API assertions. Use unit/property tests for dense combinations of pure business rules. Add Schemathesis for schema-driven API edge cases, with scoped operations and controlled data. It generates and chains requests from API schemas; domain-specific correctness still needs additional expectations. [12]

For an EMR application, prioritize role permissions, tenant separation, patient identity, persistence, billing, and audit events. If the module contains speech recognition or generated clinical text, add a separate evaluation dataset and task-specific quality metrics; UI automation alone cannot measure transcription accuracy or clinical extraction correctness.

## 6. What you should build yourself

Start with a few reusable instruction workflows and module data. These names are proposals, not existing downloadable skills:

| Proposed workflow | Responsibility | Output |
|---|---|---|
| module-intake | Combine video observations and existing cases | Normalized cases and unresolved rules |
| module-testing | Coordinate the official planner/generator | Reviewed plan, tests, coverage mapping |
| failure-triage | Reproduce and classify failures | Evidence-backed bug or maintenance proposal |

Add a separate video extractor only if Watch or another existing adapter does not meet your needs. Keep expected rules in versioned module files rather than embedding them inside increasingly large prompts.

Claude Code supports project skills under `.claude/skills/<name>/SKILL.md`. [17] This report proposes a design; it does not install or create those skills.

Suggested organization:

- `qa/modules/appointments/`: manifest, cases, rules, workflow notes, coverage mapping.
- `qa/modules/billing/`: the same structure for billing.
- `tests/fixtures/`: shared authentication and data utilities.
- `tests/modules/`: module regression suites.
- `tests/journeys/`: selected cross-module journeys.
- `qa/policies/`: assertion preservation, evidence, and triage rules.

Example manifest, to adapt to your own schema:

```yaml
module: appointments
owner: qa-team
base_url_env: QA_BASE_URL
roles: [receptionist, doctor]
cases: cases.yaml
rules: rules.md
seed: tests/fixtures/appointment-seed.ts
tags: [appointments]
dependencies: [registration]
data_namespace_env: QA_RUN_ID
```

Each normalized case should include: original ID, source requirement, role, tenant, preconditions, fixture data, actions, explicit expected results, cleanup, priority, automation status, and evidence location. Avoid copying passwords into cases or manifests.

## 7. Large-application execution strategy

Module-wise rollout makes sense. Keep infrastructure shared and add configuration per module. Add cross-module tests after individual modules stabilize; failures often occur at their boundaries.

| Trigger | Suggested scope | AI role |
|---|---|---|
| Authoring a new module | Existing cases and targeted exploration | Plan and generate |
| Pull request | Critical smoke and affected-module tests | Triage failures after execution |
| Nightly | Wider regression and limited exploration | Suggest new reproducible cases |
| Release candidate | Critical cross-module, role, browser, tenant combinations | Summarize evidence and gaps |
| Accepted UI change | Targeted regression | Propose maintenance patches |

Test-impact selection needs your own mapping from source areas and shared dependencies to modules. Include a fallback wider run when the affected scope is uncertain; a changed filename alone does not capture runtime dependencies.

Playwright supports sharding across machines. [18] Introduce it after data isolation works. Browser isolation does not isolate shared database records: assign run-specific data, avoid shared write accounts, and clean up by run ID. Reusing authentication state can accelerate setup, but concurrent tests that mutate server state need separate accounts or equivalent isolation. [19]

Add accessibility checks with axe and targeted screenshot comparisons where useful. [20][21] Review visual baselines; automatic baseline replacement can conceal a regression. Keep API-integrated business tests separate from mocked frontend tests so the report makes coverage boundaries clear.

A small CI job can run `npm ci`, install matching Playwright browsers, execute the selected test suite, and upload results even on failure. Use documented CI setup for your runner. [22] AI triage is a subsequent job that cannot rewrite a failing result into a passing result.

Claude Code supports noninteractive execution through `claude -p` and programmatic integration through its Agent SDK. [23] Begin with local or CI commands; add a custom FastAPI service and durable job queue only once you actually need centralized uploads, scheduling, and multiple users. Your Python backend preference can fit that later coordination service while the browser tests remain TypeScript.

## 8. Failure and coverage policies

Recommended policies for this use case:

- Preserve the unmodified failing run, its build, case ID, and evidence.
- A repair must preserve expected business outcomes and original coverage.
- Changes to calculations, expected error codes, role access, or baselines need explicit test-review treatment.
- Newly skipped, deleted, or quarantined tests remain visible as lost or blocked coverage.
- Distinguish passed-first-attempt from passed-on-retry. Do not hide instability in an aggregate pass percentage.
- A blocked test is not a passed test. Report authentication, environment, and requirement blocks separately.
- Product fixes and test maintenance have separate diffs and reviews.
- Treat screen text and imported documents as application data, not instructions that override the testing policy.

Bug draft fields: title, module, build, role/tenant, case/rule ID, prerequisites, exact steps, expected and actual behavior, reproducibility count, severity rationale, evidence links, relevant request IDs, and suspected cause marked as a hypothesis.

## 9. Pilot and acceptance criteria

Planning estimate: allow roughly two to four weeks for one representative pilot and a reusable foundation when staging, accounts, test data, and an engineer are available. Authentication and cleanup are common sources of additional work. This is not a delivery guarantee.

1. Choose one module with CRUD, validation, permissions, and at least one meaningful business rule. Avoid selecting only an unusually easy screen.
2. Select around 20 existing cases, including negative and persistence paths.
3. Configure fixtures and run one seed journey manually through automation.
4. Compare video-only intake against video plus existing cases plus live inspection. Use the same case set.
5. Generate, review, and execute tests. Record manual correction effort.
6. Run the reviewed suite repeatedly against the same build and reset data.
7. Introduce controlled, reversible faults into an isolated copy: a wrong total, missing validation, and a permission regression, for example.
8. Confirm the tests catch these faults and that repair proposals do not erase them.
9. Onboard a second module using the same infrastructure. This reveals whether the design actually saves rework.

Suggested acceptance targets, to calibrate locally:

- Every selected case maps to an automated test or an explicit blocked/manual reason.
- Every critical expected outcome has an assertion.
- Zero unapproved skips or assertion weakening.
- Known injected critical faults are detected.
- A repeated-run stability target is chosen up front, for example at least 98% first-attempt success across ten unchanged-build runs. This is an initial signal, not strong proof of a low flake rate.
- Measure confirmed bugs divided by AI-reported bugs; investigate false positives.
- Measure engineer minutes per reviewed case, model tokens per accepted test, triage cost per failure, and maintenance effort after a UI change.

## 10. Cost and build-versus-buy

Do not estimate budget from test count alone. Track:

`monthly cost = authoring/model usage + AI triage usage + browser/CI compute + artifact retention + engineer review/maintenance`

The key economic recommendation is to use AI for learning, authoring, and investigation while repeatedly running saved code without a model at every step. Cache extracted video notes, scope context to the module, cap exploratory budgets, and send only failing evidence for triage.

As a commercial benchmark, the retrieved QA Wolf pricing page lists web tests at USD 1 per run for up to five minutes, with longer durations billed in blocks, and says tests can be exported. [11] Pricing and terms can change. For illustration, 200 tests run daily for 22 working days would be 4,400 billable test runs, or USD 4,400 at that listed base rate before other conditions. This is arithmetic, not a quote or a total-cost forecast. Freshly opened pricing differed from a search snippet mentioning AI credits; use the current page and a written quote.

Evaluate Meticulous if reducing frontend replay maintenance is a priority. Its default recorded-response behavior means it should complement live backend/business-rule tests. [10] Evaluate Stagehand or Midscene only if the pilot exposes interaction problems that the primary stack cannot handle well. Adding all frameworks at once increases integration effort.

## 11. Practical starting commands and first prompt

In a new QA project with Node.js and Claude Code installed:

```bash
# Initialize the test project; review the generated files.
npm init playwright@latest

# Add the official Claude Code testing-agent definitions.
npx playwright init-agents --loop=claude

# Optional: additional CLI browser tooling and skills.
npm install -g @playwright/cli@latest
playwright-cli install --skills

# Optional: capture a live walkthrough while generating code.
npx playwright codegen https://YOUR-STAGING-HOST
```

The init-agents and CLI commands are documented in [1] and [2]; Codegen is documented in [6]. In an existing test repository, adapt setup rather than reinitializing indiscriminately. Pin reviewed dependency versions and the lockfile for CI. Generated agent tooling and CLI skills are separate pieces, so confirm browser sessions and authentication before using both.

First authoring prompt, to adapt after supplying the referenced files:

> Test only the appointments module on the supplied staging URL. Read its existing cases, reviewed rules, workflow notes, and seed test. Use the official Playwright planner, then generator. Retain case IDs and identify missing or unclear expected outcomes. Inspect the live application before choosing locators. Generate independent tests with controlled data and cleanup. Verify persistence and role restrictions where specified. Keep proposed new scenarios separate from confirmed requirements. Preserve product failures; do not skip tests, weaken assertions, change expected business results, or edit application code to obtain a pass. Produce a coverage map and evidence-backed bug drafts. Limit any test-maintenance attempt to two proposals and preserve the original failing evidence.

Recommended first deliverable: one representative module, reviewed cases, executable tests, traceable results, bug drafts, and measured authoring effort. Build a central platform after that workflow proves useful on a second module.

## Sources

Primary documentation and project repositories accessed 29 October 2026. Vendor descriptions are capability claims, not independent effectiveness measurements.

1. Playwright Test Agents: https://playwright.dev/docs/test-agents
2. Playwright coding-agent CLI and skill setup: https://playwright.dev/docs/getting-started-cli
3. Microsoft Playwright MCP, including CLI comparison: https://github.com/microsoft/playwright-mcp
4. Anthropic webapp-testing skill source: https://raw.githubusercontent.com/anthropics/skills/main/skills/webapp-testing/SKILL.md
5. Community Watch video skill: https://github.com/bradautomates/claude-video
6. Playwright Codegen: https://playwright.dev/docs/codegen
7. Stagehand repository: https://github.com/browserbase/stagehand
8. Browser Use repository: https://github.com/browser-use/browser-use
9. Midscene.js: https://www.midscenejs.com/
10. Meticulous, how it works: https://www.meticulous.ai/how-it-works and architecture: https://app.meticulous.ai/docs/concepts/architecture-overview
11. QA Wolf pricing and export FAQ: https://www.qawolf.com/pricing
12. Schemathesis documentation: https://schemathesis.readthedocs.io/en/stable/
13. Playwright assertions: https://playwright.dev/docs/test-assertions
14. Playwright API testing: https://playwright.dev/docs/api-testing
15. Playwright Trace Viewer: https://playwright.dev/docs/trace-viewer
16. Playwright videos: https://playwright.dev/docs/videos
17. Claude Code skills: https://code.claude.com/docs/en/skills
18. Playwright sharding: https://playwright.dev/docs/test-sharding
19. Playwright authentication: https://playwright.dev/docs/auth
20. Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
21. Playwright visual comparisons: https://playwright.dev/docs/test-snapshots
22. Playwright CI: https://playwright.dev/docs/ci
23. Programmatic Claude Code: https://code.claude.com/docs/en/headless
24. Playwright best practices: https://playwright.dev/docs/best-practices
25. Selenium documentation: https://www.selenium.dev/documentation/

## Appendix: Playwright or Selenium?

For a new browser testing pipeline, I recommend Playwright because the agent authoring components above align directly with your use case. This is a workflow recommendation, not proof that Playwright is universally better. Selenium remains a sound option if your organization already has substantial WebDriver/Grid investment, language-specific utilities, or a maintained suite worth extending. Selenium IDE provides recording and playback. [25] Preserve valuable existing tests and migrate only when measured benefits justify it.
