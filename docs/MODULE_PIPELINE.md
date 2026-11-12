# Module pipeline: what a module needs before AI can write its tests

For BAs and module leads. Every module page shows a Readiness checklist; this explains it.

## The checklist

| Stage | It is ready when | Who does it |
|---|---|---|
| Sources | At least one usable file: document, sheet, PDF, text, screenshot, or a video the portal could extract keyframes or a transcript from | BA uploads; the portal processes |
| Insights | An analysis exists that covers every current source | Coding agent (Claude Code / Codex) or the assistant |
| Reviewed cases | At least one approved case | A tester approves drafts (a different person than the author) |
| Target setup | Module URL path, variants and login profile are saved and confirmed | A lead (needs module settings permission) |
| Discovery | `qa/modules/<module>/discovery/fields-default.json` exists and is newer than the target setup | Read-only scan of the live page (run by a developer for now) |
| Automation package | The agent's proposal was reviewed and installed by a developer, and the adapter is connected | Agent proposes, developer installs |
| Smoke run | One automated case of the module has passed on a login profile of its product | Run queue |

Statuses: `missing`, `running`, `ready`, `stale`, `failed`, `blocked`.

## What unlocks what
- **Generate test cases with AI** needs Sources ready, Insights present and the Automation package connected. Otherwise the portal answers 409 with the full checklist. Stale insights only show a warning.
- **Generate automation proposal** needs Sources, Insights, at least one approved case, a confirmed Target setup and Discovery.
- Manual case writing, uploading files and "Analyse with agent" are never blocked.
- Products whose application login is not automated yet (Miracle today) show Discovery, Automation and Smoke as `blocked`. Manual testing, intake, insights and review still work.
- Registration is the reference module and is never locked out: its stages report ready.

## Uploads are remembered
- Every file is fingerprinted (SHA-256) per module. Uploading the same bytes again, even under another name, stores nothing new and starts no processing. You are told "This file was already uploaded as <name>"; your note is added to the existing file.
- Same name but different content is a new source; the old one stays until someone deletes it, and Insights become `stale`.
- If the portal restarts while a file is still being processed, it picks the file up again at startup.

## Insights are versions
Each analysis (agent, assistant or built-in) saves a new version that records which sources it covered and what it added. History is under the Insights tab. "Update insights" runs an incremental analysis: the agent receives the previous version and is told which sources are new, changed or unchanged, and must merge (keep what is still true, correct what new material contradicts, add what is new, keep the sources). If nothing is new the portal says "Nothing new to analyse since version N" unless you force it.

## Stale
Insights are `stale` when a usable source was uploaded after the latest version was saved. Discovery is `stale` when the target setup was confirmed after the last discovery.

## Jobs that were interrupted
Agent jobs are stored. If the portal restarts while one is running it becomes `interrupted` (its log is kept) and you can press Retry, which starts a new job with the same agent, task and files.
