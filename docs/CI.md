# Running Test Studio from a pipeline

A pipeline starts a run in Test Studio, waits for it, saves a JUnit report, and fails the build when the run fails.

1. In Test Studio, **Users**: create an account for the pipeline (for example `ci`) with role **tester**. A tester can start runs and read results.
2. Make sure the login profile you will use has a valid application session (Settings > Refresh application login). A run cannot start without one.
3. Store the account password as a secret in your CI system.

```
PORTAL_URL=https://studio.example.com PORTAL_USER=ci PORTAL_PASSWORD=*** \
CI_MODULE=registration CI_ENVIRONMENT=uat npm run ci:run
```

| Setting | Meaning |
|---|---|
| `PORTAL_URL`, `PORTAL_USER`, `PORTAL_PASSWORD` | Where Test Studio is and who signs in (required) |
| `CI_MODULE` | Module id to run, for example `registration` (required) |
| `CI_ENVIRONMENT` | Login profile id (required). It runs every approved automated case of that module |
| `CI_NAME` | Run name shown in Test Studio (default: "CI run (date)") |
| `CI_JUNIT_FILE` | Where to write the JUnit XML (default `junit.xml`) |
| `CI_TIMEOUT_MIN` | Stop waiting after this many minutes (default 60); the run itself keeps going |

Exit codes: `0` passed, `1` failed or blocked (a real finding), `2` error, cancelled, interrupted, timed out or could not start.
Quarantined cases still run and appear in the report, but their failures do not fail the run. A case that passes only after a retry is reported as flaky and does not fail the run.

## GitHub Actions

```yaml
name: nightly-e2e
on:
  schedule: [{ cron: '0 21 * * 1-5' }]
  workflow_dispatch:
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: node qa/tools/ci-run.mjs
        env:
          PORTAL_URL: ${{ secrets.STUDIO_URL }}
          PORTAL_USER: ci
          PORTAL_PASSWORD: ${{ secrets.STUDIO_CI_PASSWORD }}
          CI_MODULE: registration
          CI_ENVIRONMENT: uat
          CI_JUNIT_FILE: reports/junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: junit, path: reports/junit.xml }
```

The script needs only Node.js; it does not need the project's dependencies. The portal must be reachable from the runner (a portal on a private network needs a self-hosted runner).

## Other ways in

- `POST /api/ci/runs` with `{ "moduleId", "environmentId", "name" }` starts the run and returns its id; poll `GET /api/runs/{id}` until `status` is `passed`, `failed`, `error`, `blocked`, `cancelled` or `interrupted`.
- `GET /api/runs/{id}/export?format=junit` returns JUnit XML for any finished run (also the **JUnit** button on a run page).
