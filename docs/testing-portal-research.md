# Research and design decisions: a BA testing workspace

Reviewed 1 November 2026. Sources below are official product documentation. The goal is to adapt useful interaction and information patterns to this repository; this is not a feature, pricing or vendor procurement comparison. Product descriptions are source findings. Recommendations and implementation decisions are our interpretation.

## The problem to solve

Registration is one module of a larger EMR. A usable BA tool must support Setup and future modules without adding a new top-level application for each. Test authors need explicit business expectations, repeatable starting data, selective execution and evidence understandable without reading Playwright code.

The existing project has 87 structured Registration cases, JSON/Excel conversion, page objects, generated data, dependent-case references, saved application sessions and expected-versus-actual reporting. Those are reusable execution components. What was missing was a durable authoring and execution workspace above them.

## Findings from existing products

### TestRail: reusable definitions and historical executions

TestRail separates case organization from runs. Cases can be grouped by the application area they verify. Runs carry execution status, and closed runs retain their original details despite later case edits. Plans and configurations coordinate multiple executions. [Official introduction](https://support.testrail.com/hc/en-us/articles/7076810203028-Introduction-to-TestRail).

**Decision:** Separate repository cases from executions. Snapshot selected cases, module configuration and shared data at run creation. Treat a run as evidence of what was actually tested at that point. Preserve manual results once a run is closed. Broad test plans remain a later layer above individual runs.

### Testmo: selection before execution

Testmo's run workflow combines repository folders, explicit selection and filters. Its selection modes can set, add or remove cases, and configurations can produce separate runs. These patterns make the chosen scope visible rather than hiding it behind a single run-everything button. [Official test-run guide](https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs).

**Decision:** Provide suite, priority and execution-type filters, row selection, and a run dialog that names the environment and lists included cases. Automatically add prerequisite cases and identify them in run details. The first version supports a single module and execution type per run; cross-module plans and saved selection rules are deferred.

### Qase: reuse recurring setup

Qase documents shared steps as reusable action sequences that can be used at project or workspace scope. Updating a shared sequence propagates to linked cases. The product distinguishes inline test content from common workflows. [Official shared-step guide](https://docs.qase.io/en/articles/5563709-shared-steps).

**Decision:** Start with the reuse already present in this project: named starting-data templates, authenticated setup and generated tokens. Make the templates editable through structured fields and snapshot them for execution. A shared-data template is not the same as Qase's executable shared-step library; this implementation does not claim that feature. Reusable step libraries can follow once multiple module workflows demonstrate concrete repeated steps.

### Tricentis Tosca: module definitions drive authoring

Tosca builds test steps from connected modules and their attributes. Its reuse guidance also recommends maintaining genuinely repeated sequences centrally, without creating unnecessary reusable blocks. [Creating steps from modules](https://docs.tricentis.com/tosca-2026.1/en-us/content/tosca_commander/teststep_from_module.htm), [reuse guidance](https://docs.tricentis.com/tosca-2025.1/en-us/content/best_practices/testcases_repetitions_and_reuse.htm).

**Decision:** Supply fields, action choices and expected outcomes from a trusted automation adapter. BAs author business-level inputs and assertions; module integration code owns selectors and browser behavior. A new module can be documented and tested manually immediately, while its automation connection is developed independently. This avoids suggesting that merely creating a module makes every workflow executable.

### Xray: organization, traceability and different test types

Xray's migration guide distinguishes repository structure, tests, plans, executions, requirements and manual/automated test representations. It describes requirement links and reusing tests through modular structures. [Official qTest-to-Xray mapping](https://docs.getxray.app/space/XRAYCLOUD/44579728/Tips%2Bfor%2Ba%2Bsuccessful%2Bmigration%2Bpath%2Bfrom%2BqTest%2Bto%2BXray).

**Decision:** Keep a requirement/ticket reference on a case and offer both ordered manual steps and structured automated cases. Show automation capability separately from the existence of cases. Requirement references are plain text in this version, not a Jira integration, synchronized issue relationship or calculated requirements coverage report.

### Playwright: integrate the existing executor

Playwright supports built-in and custom reporters. Its authentication guidance explains stored browser state and the need to protect session artifacts. [Reporters](https://playwright.dev/docs/test-reporters), [authentication](https://playwright.dev/docs/auth).

**Decision:** Reuse the existing executor and result attachment shape. Add a reporter that streams case completion into the portal's run folder, then associate screenshots and traces with the result. Retain the separate session-storage restoration that the EMR needs. Browser output belongs to a run, and session files remain server-side.

## Information architecture

```text
Augastam workspace
  Business area (Setup / Patient Care / Finance / custom)
    Module (Facility Setup / Registration / Billing / custom)
      Suite or feature label
        Test case + requirement + priority + enabled state

Execution
  Environment + module + selected case snapshots + shared-data snapshot
    Automated queue OR manual execution
      Case results + expected/actual + evidence
```

The module library is the entry point. Business-area filters and module search prevent the navigation from becoming an ever-growing list of module-specific screens. A single repository screen adapts to the selected module. Suite labels provide a second filter inside each repository. The structure supports additional modules without a fixed module-count limit; large datasets would eventually require pagination and server-side search.

Case authoring exposes the test's title, business reference, suite, priority, preconditions and execution type first. Automated cases then choose a known action, starting template, field overrides, expected outcome and optional field/message assertions. Manual cases use action/expected-result pairs. Assumed business rules and observation-only outcomes remain explicit rather than being silently interpreted as confirmed requirements or passes.

## Execution and persistence choices

The first implementation uses one Node.js process with native SQLite, a same-origin web UI and a serial Playwright worker queue. This matches the current single-worker automation and avoids requiring additional infrastructure just to make the tool usable. It does not call an external AI service or require vendor accounts.

SQLite persists the repository and run metadata. Run folders keep snapshots, logs, reports and evidence. Optimistic versions reject stale repository edits. Imports validate before a transaction commits. A worker lock prevents two portal supervisors using the same database. Completed manual runs cannot accept further result edits; interrupted automation is visibly incomplete.

The portal binds locally by default. A network binding requires a shared workspace key, with HTTP-only session cookies and same-origin write checks. Shared-key access is appropriate only for an initial trusted internal workspace. Individual identity, SSO, roles, audit trails and a production hosting model are separate work.

## What this version deliberately leaves for later

| Capability | Reason for sequencing |
|---|---|
| Additional automated modules | Each needs a tested browser workflow and adapter; case authoring/manual execution already work. |
| Cross-module plans and reusable executable setup steps | Define actual module dependencies and cleanup rules before orchestration. |
| Recorded actions or natural-language-to-test generation | Requires stable element mapping and evaluation; drafted expectations still need business review. |
| Scheduling and CI triggers | Add after session lifecycle, test-data cleanup and worker hosting are established. |
| Individual accounts, permissions and activity attribution | Required before broader access or sensitive production use; shared-key access does not substitute for them. |
| Nested repository folders, pagination and distributed workers | Add when repository size and execution demand justify them. |

## Acceptance checks

The portal should demonstrate independent modules in different areas, manual and automated case authoring, selective execution, stable historical snapshots, meaningful expected/actual output, protected application sessions and usable mobile layout. A successful portal test proves those workflows locally. It does not by itself establish that every EMR module or every inherited test expectation is correct.
