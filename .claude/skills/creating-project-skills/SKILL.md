---
name: creating-project-skills
description: Use when creating a new skill or agent for this repo, turning a repeated workflow or explanation into a skill, or extending an existing .claude skill with knowledge it lacks.
---

# Creating project skills

**Core principle:** a skill is distilled codebase knowledge. Mine the repo first, write second - every path, command and rule in the skill must come from a file you (or `explorer`) actually read.

## 1. Check for overlap

Read the `description` of every skill in `.claude/skills/` and agent in `.claude/agents/`. If one already covers the area, **extend it** instead of adding a sibling. Registration work starts at the `registration-testing` hub.

## 2. Pin the scope

Write down, before mining:
- 3 real prompts the skill must handle, 1 it must not.
- What Claude gets wrong today without it (the reason the skill exists).

Ask the user if either is unclear.

## 3. Mine the codebase

Dispatch `explorer` (Haiku) in parallel, one question each. Ask for `path:line` evidence.

| Question | Typical sources here |
|---|---|
| Which commands run this work, and what do they write? | `package.json` scripts, `playwright.config.ts`, `portal/` |
| Where do inputs/outputs live, in what shape? | `qa/modules/<module>/` (cases, rules, results, bugs) - read one real example of each format |
| Which code must be reused, not rewritten? | `tests/modules/<module>/` helpers, page objects, runners |
| What is the source of truth for expected behaviour? | `rules.md`, `docs/`, `README.md` |
| What goes wrong in practice? | `bugs/`, results summaries, `TODO`/`FIXME`/`HACK` comments |
| What is forbidden? | `.claude/settings.json` deny list and hooks - the skill must never instruct a denied action |

Save the answers in the scratchpad as a knowledge file (fact → `path:line`). Only facts with evidence go in the skill.

## 4. Write it

**Frontmatter:**
- `name` = folder name, lowercase-hyphen, verb-first (`triaging-…`, `designing-…`).
- `description` starts "Use when…", lists triggers and keywords only - never the workflow. ≤1024 chars.
- `model` / `effort` only with a reason (see `routing-work-to-models`).

**Body (aim <500 words):**
1. Core principle - 1-2 sentences.
2. Quick reference table - real commands and **repo-relative** paths.
3. Procedure - numbered steps for the judgment parts.
4. Common mistakes - built from the "what goes wrong" findings.

Put reference material over ~100 lines in a supporting file next to `SKILL.md`. Reference other skills by name, never with `@` links. Automate anything regex-checkable as a script instead of prose.

## 5. Verify

1. Mechanical: `node .claude/skills/auditing-project-skills/audit-skills.mjs <skill-name>` - zero ERRORs.
2. Facts: run the fact pass from `auditing-project-skills` on the new skill.
3. Behaviour (offer it - it costs a subagent per prompt): give a fresh subagent each prompt from step 2 with the skill available and check it follows it. For rule-enforcing skills use `superpowers:writing-skills` pressure testing.
4. If the skill belongs to a hub (e.g. registration), add a row to the hub's "Pick the focused skill" table.

## Common mistakes

| Mistake | Fix |
|---|---|
| Writing from memory of how such projects usually work | Every fact needs a `path:line` from mining |
| Bare filenames like `rules.md` | Repo-relative paths, or name the module folder once at the top |
| Description summarises the steps | Claude follows the summary and skips the body - triggers only |
| A new skill that duplicates an existing one | Extend the existing skill |
| Pasting whole files into the skill | Point to the file; keep only what Claude cannot infer from it |
