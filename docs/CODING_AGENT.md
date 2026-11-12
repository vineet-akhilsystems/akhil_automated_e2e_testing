# Coding agent inside Test Studio (Claude Code or Codex)

A BA or tester can run **Claude Code** or **Codex** from the portal. It uses the subscription already signed in on the machine that runs the portal. No API key is needed.

## Set up once, on the portal server

1. Install the CLI(s) you want: Claude Code (`claude`) and/or Codex (`codex`). They must be on the PATH of the account that runs the portal.
2. Sign in to each one on that machine (`claude` then `/login`, or `codex login`). The portal never sees these logins.
3. Do not put `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the portal's environment. The portal removes them from the agent's environment anyway, because a key would switch the CLI to pay-per-use billing.
4. Open any module's **Intake** tab. The "Analyze with your coding agent" panel shows which CLIs it found.

All users share that one signed-in subscription and its usage limits. Only one agent job runs at a time.

## Step 1: analyse files into insights and draft cases

1. A BA uploads files in the Intake tab.
2. Choose the agent and click **Analyze**. The log shows what the agent is reading.
3. When it finishes, the insights appear on the Intake tab and the proposed cases appear in the **Review queue** as drafts.
4. A tester approves or rejects them. Only approved cases can run.

## Step 2: propose Playwright automation (testers and admins)

After some cases are approved, the Review queue's **Generate automation proposal** asks the agent to write a complete module adapter: `fields.ts`, `<module>.page.ts`, `case-runner.ts`, `cases.spec.ts`, `adapter.json` and `NOTES.md` (output/automation/). It is given the approved cases, the module's live discovery output if `qa/modules/<module>/discovery/` exists (text files only, capped in count and size), and the Registration module's files as the style reference. The files are shown for reading. **They are not installed and not run.**

`adapter.json` has this shape (the registry loads it from `qa/modules/<module>/adapter.json` after install): `{ id, name, spec: "tests/modules/<id>/cases.spec.ts", prefix?, actions, outcomes, variants, fields }`. Starting-data templates (`bases`) are not read from adapter.json (the portal takes them from the module settings), so the agent lists the ones it needs in NOTES.md for a developer to create in the portal.

### Installing a reviewed proposal

A developer reads the proposal and `NOTES.md`, then runs:

```
npm run module:adapter:install -- --module <id> --job <jobId> --dry-run     # preview only
npm run module:adapter:install -- --module <id> --job <jobId> --yes         # install
npm run module:adapter:install -- --module <id> --from <folder> --yes       # from a folder instead of a job
```

`--data-dir` (default `.portal`) says where the job folders live; `--force` allows overwriting existing files. The installer accepts only the six expected file names, rejects symlinks and path traversal, validates adapter.json with the portal registry's own validator before writing anything, refuses the built-in `registration` module (even with `--force`) and any id that already has an adapter or `tests/modules/<id>` folder, scans every file (the proposal is treated as hostile: import allow-list, no fs writes, dynamic import, `Function`, string-built `require`/`goto`/`fetch`, references to the auth, claude, portal and environment-secret folders/files, non-allow-listed `process.env`, hard-coded URLs or credentials; NOTES.md is scanned for secrets), prints every file's SHA-256 and a preview (`--show` for the full text; always printed, even with `--yes`), never overwrites existing files without `--force`, copies to `tests/modules/<id>/` and `qa/modules/<id>/adapter.json`, then confirms the registry actually loads the adapter and runs `npx tsc --noEmit` and `npm run portal:check`. It does not edit `.portal/portal.sqlite`, `.env` or `.auth`; connecting the module to the adapter is a separate step in the portal/registry, and a smoke case should be run before the full suite.

### Automated draft cases

When the module already has an automation adapter, the analyse step also writes `input/adapter-schema.json` (fields, actions, outcomes, variants, bases) and the agent may return structured cases (`action`, `base`, `input`, `expected`). The portal validates each one; valid ones are saved as automated drafts, anything else falls back to manual steps. Either way they are **drafts** and only run after a tester approves them.

## How it is kept safe

- The agent runs in its own folder per job (`.portal/agent/<job>/`). The portal puts the module's extracted file text there and nothing else: no `.env`, no application logins, no portal data.
- Claude Code gets only Read, Write, Edit, Glob and Grep (no shell, no web). Codex runs with its `workspace-write` sandbox.
- The agent writes `output/insights.json` or `output/automation/*`. The portal validates the JSON itself before saving, and saves cases only as drafts.
- Uploaded files are treated as untrusted. The agent's brief tells it to ignore instructions found inside them. This reduces the risk of a prompt-injected upload but cannot remove it, which is why the human review step stays.
- A job is stopped after 15 minutes (`AGENT_TIMEOUT_MS`) and can be cancelled from the UI.

## Limits

- Images have no extracted text, and videos give only keyframes ("partial": no transcript, visuals not interpreted). The agent is told to list this under open questions, and analysis refuses to start if every readable file is keyframes-only. Add a transcript as a text file.
- AI-written update cases may only target a `{{name@CASE-ID}}` reference; a literal patient id is converted to a manual draft.
- Job history is kept in memory. A portal restart clears the list, but the workspace folders remain on disk.
- On a Docker deployment, install and sign in to the CLI inside the image or mount its login folder. The provided Dockerfile does not include either CLI.
- Agent output quality depends on the source material. Read the insights against the files before relying on them.
