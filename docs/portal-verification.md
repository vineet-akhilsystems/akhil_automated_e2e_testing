# Portal verification — 1 November 2026

## Local results

- `npm run portal:check`: passed.
- `npm run portal:test`: 30 checks passed: 25 Node/API/browser checks and 5 executor assertion and evidence checks.
- `npx tsc --noEmit`: passed.
- Desktop and 390px mobile layouts were rendered and visually inspected.
- The OpenAPI contract parses and its internal schema references resolve.

The HTTP integration tests use temporary SQLite databases and controlled worker-process events. The browser test drives the actual portal against a real local HTTP server; it creates Setup and Finance modules, writes and executes a manual test, closes the run, edits structured automated checks, duplicates a case, searches, opens shared data and checks mobile overflow. These local tests do not validate the upstream EMR.

The extended browser workflow also defines a business requirement, links a case, attaches PNG evidence, saves report metadata, downloads a valid PDF and verifies current requirement coverage. API/model checks cover finding classification, redaction, unexecuted cases, stale/environment-specific coverage, independent severity, retained manual evidence, final-report caching and useful missing-dependency errors.

The PDF was rendered and visually inspected using the available MuPDF renderer (Poppler was not installed). The real-run example is a three-page report. A synthetic stress report tested 64 case entries, long diagnostics, Unicode text and a tall screenshot over 13 pages. Checks confirmed all case IDs were retained, text stayed within page bounds and each image page retained its evidence heading. The synthetic stress document is a layout fixture, not application evidence.

Runtime assertion checks verify field errors during fill, field values/hints during update, failure of unavailable persistence checks, and rejection of an unimplemented upload placeholder. These checks use controlled page-object methods and do not establish live application behavior.

## Live runner attempt

Run `0445251c-d9a2-4bf5-8e55-94175d417f98` invoked the real Playwright worker for Registration case `REG-024`, which only fills the mobile field and checks that letters are removed. No save/create action was selected.

Navigation to `https://demo.augastam.com/registration` returned `net::ERR_CONNECTION_TIMED_OUT`. An independent HTTPS request to the demo host also timed out. The live field behavior could therefore not be verified from this machine during this session.

The portal correctly preserved the case snapshot, recorded the result as `ERROR`, completed the run in error state, generated its expected/actual report, and exposed the screenshot, error context and trace through authenticated artifact routes. All three captured evidence downloads returned HTTP 200 with the expected content types.

Run details are available locally at:

`http://127.0.0.1:4173/#/runs/0445251c-d9a2-4bf5-8e55-94175d417f98`

Retry the field-only case after the demo application is reachable. A successful portal/worker integration does not establish that the application passed the business assertion.
