---
name: auditing-project-skills
description: Use when checking whether the skills or agents in .claude/ are still correct, effective and well written - after code changes, before sharing them, when a skill gave wrong instructions or did not trigger, or when asked to "audit", "review" or "clean up" skills.
---

# Auditing project skills

**Core principle:** a skill is only as good as its facts. Every path, command, field name and rule it states must match the code *today*, and its description must make Claude load it at the right moment.

An audit has four passes. Report findings first; edit skills only when the user asks.

## 1. Mechanical pass (script)

```bash
node .claude/skills/auditing-project-skills/audit-skills.mjs --agents          # all skills + agents
node .claude/skills/auditing-project-skills/audit-skills.mjs triaging-registration-failures
```

Checks frontmatter (name, description length/form, `model`/`effort`/`context` values), body size, `npm run` scripts vs `package.json`, markdown links, backtick paths, and skill/agent names mentioned in the text.

| Level | Meaning | Action |
|---|---|---|
| ERROR | Broken: missing script/file/link, invalid frontmatter | Must fix |
| WARN | Probably wrong; script cannot be sure (runtime artifact, API name) | Read the line, decide |
| INFO | Works but weak: oversized body, path that resolves only by filename | Fix if cheap |

## 2. Fact pass (claims vs code)

The script cannot tell if a *true path* comes with a *false claim*. For each skill, list its checkable claims: commands and what they output, field/function/selector names, enum values (statuses, outcomes), config keys, file formats, numbers.

Send the claim list to the `explorer` agent (Haiku) - one call per skill, in parallel - asking for `path:line` evidence per claim. Classify each: **correct / stale / wrong / unverifiable**. Read the evidence yourself for anything marked wrong before reporting it.

## 3. Coverage pass (what the skill misses)

Find code that changed after the skill was last edited:

```bash
find qa tests portal -type f -newer .claude/skills/<skill>/SKILL.md -not -path "*/node_modules/*" | head -40
```

Also compare `package.json` scripts, new files in the module folders, and new entries in `bugs/` or results summaries against what the skill mentions. A new command, field, status or recurring failure the skill does not know about is a finding.

## 4. Trigger pass (will it load?)

For each skill write 3 realistic user prompts it should handle and 1 it should not. Check against all descriptions:
- Does exactly one description clearly match each prompt? Two matches = overlap; none = weak triggers.
- Description states *when* (triggers, symptoms, keywords), not *how* (workflow summary).

## Report

One table per skill, most severe first:

| # | Severity | Finding | Evidence (`path:line`) | Proposed fix |
|---|---|---|---|---|

End with a one-line verdict per skill: **healthy / needs fixes / rewrite**. After fixes are applied, re-run the script - zero ERRORs before calling it done.

## Common mistakes

| Mistake | Fix |
|---|---|
| Trusting a clean script run | It checks references exist, not that statements are true - always do the fact pass |
| Flagging every suffix-only path | Fine inside a module-scoped skill whose intro names the module folder |
| Rewriting a skill during the audit | Report first; the user decides |
| Auditing vendored skills (e.g. `playwright-cli`) like project skills | Report them, but fixes belong upstream |
