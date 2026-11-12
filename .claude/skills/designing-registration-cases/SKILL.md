---
name: designing-registration-cases
description: Use when writing, adding, reviewing or converting Augastam Registration test cases - a requirement, ticket, BA workbook row (TC_REG_*), field or bug needs automated cases in qa/modules/registration/cases/registration-cases.json, or someone asks for edge cases, negative tests or coverage for a registration field or flow.
---

# Designing registration cases

**Core principle:** a case asserts one behavior, its expected result comes from a cited source, and it passes `validate-cases.mjs` before anyone runs it. A case whose expectation was guessed must say so (`assumed: true`), otherwise a product "bug" is really a test bug.

## Process

1. **Ground the rule.** Look it up in this order and note the source:
   `qa/modules/registration/rules.md` (code-cited) -> `discovery/fields-<type>.json` and `discovery/config/webpart_*.json` (live config: `required`, `regExpression`, `maxLength`, `futureDates`) -> the requirement / BA text.
   Only rules.md or config is *confirmed*. Requirement text with no code or config behind it -> `expected.assumed: true` + a `note` naming the source. Never present an invented rule as confirmed.
2. **Check what exists.** Before adding, search by `requirement` and `category`:
   `node -e "const c=require('./qa/modules/registration/cases/registration-cases.json');c.cases.filter(x=>x.requirement==='REG-REQ-004').forEach(x=>console.log(x.id,x.action,x.expected.outcome,'|',x.title))"`
   Extend gaps; do not duplicate.
3. **Derive cases** with [edge-case-catalog.md](edge-case-catalog.md): valid classes, invalid classes, boundaries (min-1, min, max, max+1), format and script variants, state transitions, cross-field rules, persistence after reopen. One case per behavior; a happy-path partner for each negative.
4. **Choose action and outcome** from the table below.
5. **Write the JSON** (conventions below), then run the validator, then `npm run reg:excel`.
6. **Run the new cases once** with their prerequisites (`$env:CASES='REG-001,REG-2xx'; npm run reg:cases`) and read the result. A brand-new case that passes or fails for a reason unrelated to its purpose is a case defect: fix the case, not the expectation.

## Action / outcome table

| You want to prove | action | expected.outcome | Allowed extra checks |
|---|---|---|---|
| Field behavior without saving (auto-fill, cascade, hint, inline error, mask) | `fill` | `field-state` | `values`, `hints`, `fieldErrors` (no `toastContains`, no `persisted`) |
| Form shows no errors on open | `fill` | `no-errors` | none |
| Valid patient is created (and stored correctly) | `save` | `created` | `toastContains`, `persisted`, `values` |
| Invalid / missing input stops the save on the client | `save` | `blocked` | `toastContains`, `fieldErrors` |
| Exact duplicate is not reported as a new patient | `saveTwice` | `duplicate-warning` | `toastContains` |
| Double-clicking Save creates one record | `saveDoubleClick` | `created-once` | none |
| Search finds / does not find / does not crash | `search` (input only `search`, no `base`) | `found` / `not-found` / `no-error` | none |
| Edit existing record and it persists | `update` + `target` | `updated` | `persisted`, `values` |
| Invalid edit is stopped | `update` + `target` | `blocked` | `fieldErrors`, `toastContains` |
| Update button state on open (no input) | `update` + `target`, `input: {}` | `field-state` | `saveDisabled` |
| Ordered multi-step UI flow | `workflow`, `input.workflow=<key from workflows.json>` | `verified` | none (flow asserts); no `base`, no `registrationType`, `target` only if `savedRecord` |
| Record behavior with no defined rule, no pass/fail | any | `observe` | none (stays OBSERVED; prefer `assumed`) |

No key exists in `workflows.json` for the flow you need? Use `automating-registration-workflows`.

## Case conventions

```json
{
  "id": "REG-266", "category": "dob-age", "priority": "P2",
  "title": "Infant age typed as '0Y 6M 0D' with empty DOB calculates the DOB",
  "registrationType": "New Registration", "action": "fill", "base": "valid",
  "input": { "dob": "", "age": "0Y 6M 0D" },
  "expected": { "outcome": "field-state", "values": { "age": "0Y 6M 0D", "dob": "*" },
                "note": "rules.md DOB/Age: a value matching ^\\d+Y\\s\\d+M\\s\\d+D$ calculates DOB." },
  "requirement": "REG-REQ-004"
}
```

- `id`: next unused `REG-nnn` (validator rejects duplicates). `priority` P0-P3. `category` reuses an existing one (`happy`, `mandatory`, `name`, `phone`, `email`, `dob-age`, `address`, `payer`, `registration-type`, `identity`, `duplicate`, `search`, `update`, `ui`, `real-names`, `data-integrity`).
- `requirement`: a `REG-REQ-0xx` id from the file's `requirements` (comma-separate several). A new requirement goes into `requirements` first.
- `base: "valid"` merges the valid patient; `input` overrides only what the case is about. `""` clears a base field.
- Tokens: `{{seqWord}}` in name fields (digits are stripped), `{{phone}}`/`{{phone2}}` for any mobile that must be valid and unique, `{{today}}`, `{{first}}`/`{{second}}` dropdown option (input only), `{{regId@REG-001}}`/`{{phone@REG-001}}` from an earlier case in the same run, which must sit **earlier in the file**.
- `expected.values`/`persisted` matchers: `"*"` non-empty, `""` empty/Select/None, `"~text"` contains, else case-insensitive equal. `fieldErrors`/`hints`/`toastContains` are "contains".
- Title says the behavior and the verdict ("... is rejected", "... is saved exactly"), never just the input.

## Common mistakes

| Mistake | Fix |
|---|---|
| `"outcome": "rejected"` | Doesn't exist. Client stop = `blocked`; server 409 = `duplicate-warning`. |
| Hard-coded mobile like `9876543210` in a `created` case | `{{phone}}`: fixed numbers trigger duplicate rules on rerun. |
| Digits in a name (`User12`) | `User{{seqWord}}`; the page strips digits. |
| Expecting a combined required-field toast | Demo build validates one field at a time: `Please fill the required field: <Field>` (rules.md, Observed). |
| Negative save without `base: "valid"` | Then several fields are missing and the case proves nothing about the one under test. |
| Dependent case run alone | Include its prerequisite in `CASES`; the legacy runner does not add it. |
| Changing an existing case's `expected` because it failed | Needs the user's approval; go to `triaging-registration-failures`. |
| Marking a BA scenario automated because its fields can be filled | Only when every expected result in the source is asserted. |

## Validate

```
node .claude/skills/designing-registration-cases/validate-cases.mjs                       # master JSON
node .claude/skills/designing-registration-cases/validate-cases.mjs path\to\file.xlsx     # BA Excel
node .claude/skills/designing-registration-cases/validate-cases.mjs --ids REG-266,REG-267
```
It applies the portal's `validateCase` rules plus duplicate ids, unknown requirements and dependency order. Fix every error before running.
