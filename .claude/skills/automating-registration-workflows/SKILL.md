---
name: automating-registration-workflows
description: Use when an Augastam Registration scenario cannot be expressed with the existing case actions (fill/save/search/update) - ordered multi-step UI flows, print/QR/drawer/modal checks, keyboard navigation, a field missing from fields.ts, or converting a "new"/"partial" BA TC_REG scenario into automation in tests/modules/registration.
---

# Automating registration workflows

**Core principle:** extend the smallest layer that can express the scenario, assert every expected result the source states (or mark the flow `partial`), and prove it on the live page with one headed run before it counts as automated.

## Pick the layer

| The scenario needs | Change | Effort |
|---|---|---|
| Existing action, but the field isn't mapped | Add the field to `tests/modules/registration/fields.ts` (+ `FILL_ORDER`) | small |
| Ordered steps / assertions on a modal, drawer, popup, download, keyboard, or a sequence of values | New **workflow key**: `workflows.json` + a `case` in `workflow-runner.ts` | medium |
| A new kind of outcome shared by many data-driven cases | New action in `case-runner.ts` + `portal/modules/registration/adapter.mjs` (actions, outcomes) and `portal/modules/registration/validate.mjs` (validation) | large: **ask the user first** |
| Another page (configuration masters, billing, permissions) | A new module under `tests/modules/<module>/` (see README "Multiple modules") | out of scope here |

Check `qa/modules/registration/workflows.json` first; the assessment doc in `docs/` is a snapshot and may call an already-implemented flow "new".

## Add a field

1. Find it in `qa/modules/registration/discovery/fields-<type>.json` (run `npm run reg:discover` if missing or stale). Copy the **card title**, the **visible label without `*`**, the kind and the `column`.
2. Add `key: { card, label, kind, column }` to `FIELDS`. Fields with dependencies (address cascade) go to the right spot in `FILL_ORDER`.
3. The portal picks it up automatically (`portal/modules/registration/adapter.mjs` spreads `FIELDS`). Prove it with a `fill` case that sets and reads it.

Duplicate labels across cards are fine (`card` scopes them). The same label twice **in one card** (Permanent tab, repeated emergency rows) needs a dedicated locator helper in `registration.page.ts`, not a FIELDS entry.

## Add a workflow

1. **Explore read-only** with the `playwright-cli` skill or a headed `reg:watch` run: record the controls, the network calls they fire, and what proves success. Don't save from exploration unless you're using an Agent Testing record.
2. **Register** in `workflows.json`:
   `"print-wristband": {"name": "Print Wristband opens output with correct patient identity", "sourceCases": ["TC_REG_057"], "savedRecord": true, "partial": false}`
   `savedRecord: true` = needs `target`, the runner opens it first. `partial: true` whenever any expected result in the source cases stays unasserted. Say which ones in the case `notes`.
3. **Implement** a `case '<key>':` in `runWorkflow` (`workflow-runner.ts`) using `RegistrationPage` (`reg`) helpers:
   - `reg.open()` / `reg.openExisting(id)` / `reg.waitForForm()` / `reg.selectRegistrationType(t)` / `reg.confirmIfAsked()`
   - `reg.set(key, v)`, `reg.setDate`, `reg.value(key)`, `reg.input(key)`, `reg.hint(key)`, `reg.fieldErrors()`, `reg.toasts()`
   - `reg.addressTab('Current'|'Permanent')`, `reg.addon(label)` (drawer), `reg.closeQrIfOpen()`, `reg.saveButton()`, `reg.update(remarks)`
   - `reg.assertAgentRecord()` **before** changing an existing record
   - `evidence('<stage>')` at each state a reviewer must see
   Missing helper? Add it to `registration.page.ts` so other flows reuse it.
4. **Add a case** (`action: "workflow"`, `input: {"workflow": "<key>"}`, `expected: {"outcome": "verified"}`, `target: "{{regId@REG-001}}"` if `savedRecord`, no `base`/`registrationType`), then run the validator from `designing-registration-cases`.
5. **Prove it:** `$env:CASES='REG-001,REG-2xx'; npm run reg:watch`. Then break one assertion on purpose (wrong expected text), confirm the case reports **FAIL** (not ERROR), and restore it.
6. `npx tsc --noEmit` passes.

## Rules that keep these tests honest

- **Business checks use `expect`; setup problems `throw`.** The runner turns an `expect` failure (`matcherResult`) into FAIL with the message as the mismatch. Any other error becomes ERROR (runner error). A thrown `Error('wrong gender')` hides a product bug as an execution issue.
- **Locate by card + label or role + accessible name, never by id.** Ids repeat (`field-1` x5, `dropdownField` x17), all dates are `name="sabyaDate"`, hidden tabs stay in the DOM. Use `.filter({ visible: true })`.
- **react-select:** menus are portalled to `<body>` (`[id*="react-select"][id*="-option-"]`). Read the value via `reg.value(key)`, not the menu.
- **Wait on signals:** a `waitForResponse` set up *before* the click (`pincode-lookup`, `autogenerate`, `update-details`, `details/`, `get-all-patient-details`), `expect.poll` for derived values, `.registration-preview-loading` gone. `waitForTimeout` only with a comment saying why no signal exists.
- **Judge server effects by the response body**: `autogenerate` returns the UHID string on success but `{statusCode:409|500}` inside HTTP 200 on failure. `update-details` failures show no toast.
- **Popups and downloads:** start `page.waitForEvent('popup'|'download')` before the click. Close popups in `finally`. Check file content (PNG magic bytes in `qr-download`), not just the filename.
- **Dates:** compute expected ages from the **browser's** date (`page.evaluate`), as `dob-age` does with `calendarAge`.
- **Data:** only `Agent Testing User<Words>` patients with `{{phone}}`-style unique numbers. Never modify a record that fails `assertAgentRecord`. There is no delete.

## Common mistakes

| Mistake | Fix |
|---|---|
| Marking a flow complete when only its first half is asserted | `partial: true` + note what is missing |
| Assertion copied from the BA text with no code/config rule | The flow can't be `assumed` (validator rejects it); confirm in `rules.md`/config or ask the user |
| `page.locator('#field-1')` | `reg.group(key)` / `reg.input(key)` |
| `await page.waitForTimeout(3000)` before reading a PIN-derived value | `expect.poll(() => reg.value('state')).toBe('DELHI')` |
| Clicking Print, *then* awaiting the popup | `const popup = page.waitForEvent('popup')` first |
| Editing a case's expectation to make a new flow pass | Fix the flow; a changed business expectation needs the user's approval |
