> **Path layout changed on 2026-11-15** (qa/modules/<id> is now qa/<product>/<module>, and likewise for tests and portal/modules); see docs/superpowers/plans/2026-11-15-product-scoped-layout.md. The paths below are historical.

# Version-aware, tree-based automation

Status: Spike implemented (see plan); later phases not started.

## The problem in one paragraph

The same application exists in several versions at once (your example: 1.56 and 1.58, which differ in a few features or screens). Writing automation per version means every fix and every new case is made two, three, five times. The wish is: one automation that knows what is shared and what differs, so a new version costs a small delta, not a rewrite. Your idea is a tree: the root is what every version shares (login, opening the module), further nodes branch where versions or variants differ, and the real testing happens at the leaves.

## First principles: what actually differs between two versions?

| Kind of difference | Example | How we can detect it | How tests should react |
|---|---|---|---|
| **Configuration or data** | A field added, renamed or made required; different dropdown options; a different workflow | Read it from the application's configuration endpoints without touching the UI | Cheapest to handle. Cases are already data; the expected values change. |
| **UI structure** | A control moved or restyled; a new tab; a changed locator | Control inventory of the page (discovery), or a failing locator | Change one named step implementation, not every case. |
| **Behaviour** | A validation rule changed; a save now returns a different result | Only by running a check and comparing to an expectation | Expected result differs per version; the case says so explicitly. |
| **Contract** | An API response changed shape | Response comparison | Fix in the one place that reads it. |
| **Feature present or absent** | A whole screen exists only from 1.58 | Capability probe or the version number | The case does not apply to older versions and says so. |

Two axes, not one: the **build version** (code) and the **tenant configuration** (data). Augastam builds its forms from versioned configuration (the discovery run already captures `webpart/latest-version`, `form-schema/latest-version` and `workflow/get-workflow`), so two tenants on the same build can behave differently, and two builds can behave the same for one tenant. We must be able to say "this applies to builds from 1.58" and also "this applies when the tenant makes Pin Code required".

Principles that follow:
1. A test asserts **intent** ("a saved patient can be reopened"), not a version.
2. The unit of reuse is a **named step with a contract** (what it needs, what it leaves behind), not a copied script.
3. Variation is **declared in one place and visible**, never hidden in an `if` inside a test.
4. **Inherited is not verified.** A case that worked on 1.56 must still run on 1.58; only then do we call it covered.
5. A new version should be explained by a **diff** (what changed), so effort goes where the change is.

## What already exists here (so we do not start from scratch)

- Cases are data. An adapter maps actions and expected outcomes to a spec; `variants` already model the six registration types, a tree dimension we use today.
- A case can consume another case's output with `{{name@CASE-ID}}`; the queue keeps dependent cases together and in order (`shardCases`).
- `workflows.json` holds ordered UI flows; saved login sessions are reused across cases, so "login" is already a shared root.
- Discovery produces `fields-*.json` per registration type and the configuration responses.
- Run results exist, with compare, trends, reports and a BLOCKED status.
- Missing: a **version** anywhere (runs record the environment but not which build or configuration it ran against), a **capability** model, any **override** mechanism, any **detection**, and any way to see what a new version changes.

## The tree, stated precisely

```
login                                  [every version]   <- shared root: runs once per worker
└── open Registration                  [every version]
    ├── New Registration               [every version]
    │   ├── fill + save                  leaves: REG-001, REG-002 ...   <- real testing
    │   ├── address and PIN lookup       override from 1.58 (new Area control)
    │   └── payer                        [every version]
    ├── New Born Registration          [every version]
    └── Diagnostic Registration        [from 1.58 only]  <- capability node
```

A **node** is a named step with: an id, a parent, the capabilities or version range it needs, what it **provides** to its children (for example a saved patient), and its implementation, optionally with **overrides** for a version range. A **leaf** is a test case (the cases we already have) attached to a node and, when needed, to a version range.

Execution walks the tree depth first and reuses the work done on the way down: log in once, open the module once, create one patient and run many checks on it. If a node fails, everything below it is reported **BLOCKED with the reason** ("blocked by: login failed"), not as a thousand separate failures. That is one failure to triage instead of a thousand, and it matches the BLOCKED status we already have.

Where the real testing sits: your instinct is right with one addition. Leaves do the real testing, but the root and every inner node should also carry a few **checks of their own** (login works, the version and configuration were detected, the module opens). Otherwise a broken root looks like silence below it.

Two cautions. Leaves must not change the state their parent hands down (or must say so), otherwise results depend on order. And a tree has one parent per node; where flows meet (save, then reopen) a node may be **reused** by reference, which makes it a graph in the few places that need it.

## Approaches considered

A. **Overlay tree (recommended).** One tree for all versions. Nodes and cases declare the versions they apply to. A new version is a small file that lists only its differences, like layers in a container image: base, then deltas on top.
B. **A copy per version.** Simple to start; N times the maintenance, the thing you want to avoid.
C. **Version `if`s inside the code.** Quick, then invisible, untestable and scattered.
D. **Capability detection only.** The test probes what exists and adapts. It survives unknown versions, but hides intent and cannot tell "feature absent" from "feature broken".

Recommendation: **A**, with **D used as a safety check and as the way to find deltas**: the version file says what we expect, and detection confirms the build really has those capabilities. Academic work on testing software product lines (delta-oriented testing) reaches the same shape: keep a base, describe each variant as deltas, and derive what to retest from the difference to the previously tested variant. We apply the idea, not the research tooling.

## The vocabulary (the "automation domain")

- **Product**: Augastam, Miracle. **Version**: a release line (1.56, 1.58). **Build**: an exact deployed build (for example 2.0.66).
- **Tenant configuration**: the data that shapes forms and workflows for one tenant.
- **Environment**: a URL plus a login. **Profile**: a version plus a configuration fingerprint (a hash of the configuration responses and the control inventory), recorded with every run.
- **Capability**: something a build or tenant can do ("registers new-borns", "has Area control").
- **Node**, **override**, **leaf (case)**, **run**, **result** as above; every result also records the profile it ran against.

## How a new version is added (the workflow that matters)

1. **Register** 1.58 as inheriting from 1.56. Nothing is copied.
2. **Detect.** Run discovery against 1.58 (configuration responses plus a control inventory) and compute its profile. Show the **diff** against 1.56: fields added, removed, renamed or made required; options changed; controls added; endpoints changed.
3. **Impact.** Map the diff onto nodes and cases: "7 nodes touched, 140 cases touch them, 4,310 do not." This tells where to look first.
4. **Propose.** The coding agent we already have drafts overrides, new nodes and new cases for the added features, using the senior-tester brief with the diff as its main input. A person approves, as today.
5. **Run everything.** The full inherited suite runs on 1.58. Results are compared with the last 1.56 run (compare runs already exists): new failures are either bugs or intended changes.
6. **Declare.** An intended change becomes an override with a changed expected result; the business analyst confirms it. Anything unconfirmed stays marked as assumed.
7. **Retire.** When 1.56 is gone, fold its deltas into the base so the tree stays small.

## Detecting the version and profile

- Build version: read it where the application shows it (the demo build is 2.0.66 in the bug reports; where it is displayed or served is an open question). If it is not readable, the configuration fingerprint stands in for it.
- Profile: a hash over the configuration responses and the control inventory. It tells two tenants or two builds apart even when no version string exists.
- Every run stores `appVersion` and `profileHash`; reports and trends can then show results per version and compare versions.

## Other angles

- **Cost.** With 1,000 cases and 5% of them different on a second version: a copy per version means 2,000 to maintain; the overlay means 1,000 plus about 50 deltas.
- **Reports.** A matrix of case by version, and a release summary per version. The report pack gains `appVersion` and a "differs from version X" section.
- **Shared demo environment.** Records cannot be deleted and every created patient is real data. Reusing a parent's patient for many leaves creates fewer records, a side benefit.
- **Speed.** Login and module open happen once per worker, not once per case (we save the session already; this extends it to the whole prefix).
- **Where it lives.** The tree and the version files are developer-managed text files next to the module (`qa/modules/<id>/tree.json`, `versions/<v>.json`), reviewed in git like `adapter.json`. Cases stay in the portal; each case names its node and, if needed, the versions it applies to. A portal screen shows the tree read-only first.
- **Risks.** False confidence (a case passes but its intent changed): mitigated by running everything and comparing. Override sprawl: mitigated by the retire step and a visible "inherited / overridden / new" count. Combinations (versions x tenants x registration types): limited by testing the profile combinations that exist, not every product of them.

## Phases

- **Spike (a few days, no change to how tests run):** write Registration's existing flow as a tree; record `appVersion` and `profileHash` on runs; add a read-only tree view in the portal. Learn whether the tree fits before any rewrite.
- **Phase 1, version-aware cases and runs:** `appliesTo` on cases; the runner skips non-applicable cases with a visible reason; runs and reports show the version.
- **Phase 2, overlay and prefix reuse:** version overrides resolved along the inheritance chain; shared prefix execution; BLOCKED propagation.
- **Phase 3, diff and impact:** discovery diff between versions, impact on nodes and cases, agent-drafted deltas.
- **Phase 4, onboarding and retiring in the portal:** register a version, review the diff, accept deltas, collapse an old version.

## Decisions made by the owner (2026-11-15)

1. Build version and tenant configuration are separate things. **Yes.**
2. The application does not show its version. A developer or tester can **type the version in by hand**, or the portal **generates a label automatically** from the configuration fingerprint. We support both: a declared version (typed) and a detected profile (generated), shown together, for example "1.58 (declared), profile 3f9a1c (detected)". If nobody types a version the generated label is used alone.
3. The tree is edited by developers in files and attached in the portal. **Start read-only** in the portal, to learn what happens before anything is editable.
4. Several versions live at once and stay for a while. **No retirement rule for now**; nothing is deleted or folded away automatically.
5. The Registration module is the same everywhere for now, so there is no tenant or version variation to handle yet. **Registration is the pilot.**
6. **Automation versions** (new, see the next section): every time the automation itself changes it becomes a new numbered version, v1, v2, up to v6 and beyond.

## Automation versions: a third axis

Application version and automation version are different things. The **application** has builds and configurations. The **automation** (the tree, the step implementations, the adapter, the workflow definitions) changes when you improve it. A result is only meaningful when you know both, because a case can start failing because the application changed or because the automation changed.

Every result is therefore a function of: application build, tenant configuration (profile), automation version, case version, and test data. We record all of them.

How automation versions work:
- **Numbering.** v1 is the first automation the portal sees for a module. Each time its content changes the next number is assigned: v2, v3 and so on. The number is derived from a content hash of the automation files (`tests/modules/<module>/`, `qa/modules/<module>/adapter.json`, `workflows.json`, and later `tree.json` and the version files), so the same content always has the same number and a trivial re-save does not create a new version.
- **When it happens.** Automatically when a run is created and the content hash is new (so every run is tied to exactly one automation version), and optionally with a short human note ("fixed the payer-reset step"). A person can also create a version without running.
- **What is stored.** For each version: number, hash, date, who or what triggered it, the list of files that changed since the previous version, the git commit when available, and an optional note.
- **What a run records.** `automationVersion`, plus `appVersion` (declared) and `profileHash` (detected).
- **What you can see.** A per-module list v1 ... vN with date, changed files, number of runs and pass rate for each. A comparison of two automation versions on the same application profile ("v3 to v4: 2 cases changed from pass to fail"), which answers "did my automation change cause this?". A comparison of two application profiles on the same automation version answers "did the application change cause this?".
- **Limit (honest).** Seeing and comparing old versions is read-only. Running v3 again later needs the code of that version, which lives in git; re-running an old version is a later phase (check out the commit into a separate folder). Until then the history is a record, not a time machine.

## Spike (the first thing to build, read-only, no change to how tests run)

What you would see after the spike:
1. **Application version on runs.** The login profile gets an optional "Application version" box; the new-run dialog can override it. At the start of a run the Registration spec captures the configuration responses it already sees (webpart, form-schema, workflow), hashes them into a profile fingerprint, and stores it with the run. The run page shows "App 1.58 (declared), profile 3f9a1c (detected)"; unknown is shown as unknown, never guessed.
2. **Automation versions.** A registry per module with automatic numbering as above, shown on a new **Versions** tab: v1 ... vN, date, changed files, runs and pass rate per version. Every new run shows "Automation v4".
3. **Registration as a read-only tree.** A `tree.json` for Registration written by hand (login, open module, the six registration types, then groups such as fill and save, address, payer, update, search), with the existing 132 cases attached to nodes by their suite and type. The portal draws the tree and colours each node by the latest run (passed, failed, blocked counts). No runner change.
4. **Results matrix.** Case by (application profile, automation version) with the latest result in each cell, so a change in a column tells you which axis moved.

Out of the spike: running in tree order and prefix reuse, overrides per version, the discovery diff and impact analysis, editing in the portal, re-running old automation versions, other modules.

What the spike is meant to teach: whether the tree fits Registration's real structure, whether the profile fingerprint is stable between two runs of the same build (it must not change by itself), and whether the automation-version numbering matches how you actually work.

## Still open

- Do you read "versioning" the way I did: a new automation version each time the automation changes, numbered v1, v2, ... v6 and beyond? And should a new number be created automatically at run time (my default) or only when a person presses a button?
- Where should the typed application version live by default: on the login profile (set once, used by every run) with an override per run (my default)?
- Is the profile fingerprint allowed to be taken from the configuration responses the pages already load, read-only, as discovery does today? (Default: yes.)
