---
name: routing-work-to-models
description: Use when executing an approved plan, delegating to subagents, spawning an Agent or Explore search, or deciding which Claude model (Opus, Sonnet, Haiku) should handle a task in this repo - including "save tokens", "cheaper model", "use opus for this".
---

# Routing work to models

**Core principle:** spend Opus tokens on decisions, Sonnet tokens on code, Haiku tokens on lookups.

The session runs on `opusplan` (`.claude/settings.local.json`): plan mode = Opus, execution = Sonnet. Unpinned subagents default to Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL`), never Opus.

## Routing table

| Work | Where | Model |
|---|---|---|
| Design, architecture, ambiguous requirements, writing the plan | Main session in **plan mode** (Shift+Tab) | Opus |
| Find a file/symbol/selector/case id, read results or config | `explorer` agent | Haiku |
| Analyze BA intake files, workbooks, transcripts into rules and draft cases | `intake-analyst` agent | Sonnet |
| Scaffold a new module adapter (`tests/modules/<module>/fields.ts`, page object, runner, `portal/registry.mjs`) | `module-automator` agent | Sonnet |
| Implement a planned step (code, spec, case JSON) | Main session after plan, or `implementer` agent | Sonnet |
| Playwright plan / generate / heal | `playwright-test-planner`, `playwright-test-generator`, `playwright-test-healer` agents | Sonnet |
| Final review of changes, cross-file root cause | `reviewer` agent | Opus, high effort |

## Executing an approved plan

1. **Small plan (≤3 steps, one area):** implement inline - the main session is already Sonnet. Do not spawn agents just to edit.
2. **Large plan (independent steps, or would flood context):** dispatch one `implementer` (or `module-automator` / `intake-analyst`) per step with the step text, the files it touches, and the check to run. Run independent steps in parallel.
3. **Lookups mid-task:** send to `explorer` instead of reading many files in the main session.
4. **End:** dispatch `reviewer` once with the plan and the changed-file list. Fix CHANGES NEEDED items, then re-run the failing check.

## Agent tool calls

Built-in agents (`general-purpose`, `Explore`, `Plan`) have no pinned model. Always pass `model` explicitly:
- searching / reading only → `model: "haiku"`
- doing work → `model: "sonnet"`
- needs deep judgement → `model: "opus"`

## Portal runtime routing (Test Studio's own AI jobs)

The portal spends AI when someone presses **Analyse** or **Generate automation proposal**. Non-technical users never pick a model: an administrator picks one of three presets in **Settings > AI usage**, and `portal/ai-policy.mjs` does the routing. Change routing there, not in `portal/agent.mjs`.

| Job | Economy | Balanced (default) | Best quality |
|---|---|---|---|
| Analyse, small text-only files | Haiku | Sonnet | Sonnet |
| Analyse with screenshots/video frames or a lot of text | Sonnet | Sonnet | Opus |
| Automation proposal (writes test code) | Sonnet | Sonnet | Opus |
| Step limit (analyse / automation) | 20 / 35 | 30 / 50 | 40 / 60 |
| Reading cap per file / total | 40k / 100k chars | 120k / 300k | 300k / 800k |
| Video frames per run | 12 | 24 | 40 |
| Skip sources the previous insights already cover | yes | yes | no |

Fixed for every job: a lean `claude` launch (five file tools only, no MCP servers, no skills, no auto-loaded memory: about 7k instead of 37k input tokens per turn), a Sonnet fallback when a non-Sonnet model is overloaded, an administrator-set daily job limit, and exact usage recorded per job (`<data dir>/ai-usage.jsonl`, shown in Settings). Codex keeps its own default model unless an administrator names one.

Development-time routing (this file's table above) is separate: it governs your own Claude Code session, not the portal.

## Common mistakes

| Mistake | Fix |
|---|---|
| Designing a non-trivial change outside plan mode | Enter plan mode first so Opus does the design |
| Spawning a subagent for a one-file edit | Do it inline; a cold subagent re-reads context and costs more |
| Main session reading 10+ files to find one thing | One `explorer` call |
| Skipping the reviewer because tests passed | Passing tests can be passing for the wrong reason - review anyway on multi-step work |
| Asking Haiku to decide or design | Haiku only retrieves; decisions go to Opus |

To force a model for one turn: `/model opus` (or `sonnet`/`haiku`), press `s` in the picker to keep it session-only.
