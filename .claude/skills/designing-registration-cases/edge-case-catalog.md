# Registration edge-case catalog

Ideas to derive cases from, per area. **C** = confirmed by `rules.md` / config (assert without `assumed`). **A** = no rule exists in code (set `assumed: true` and cite the requirement). Re-check rules.md first: it changes with each build.

Always pair: one valid partner per negative, and for every `created` case worth trusting, a `persisted` check (reopen proves the server stored it, not just the UI).

## Mandatory fields (REG-REQ-001)
- C: each hard-coded required field blank on its own, with `base: "valid"`: First Name, Last Name, DOB (and Age empty), Gender, Mobile -> `blocked`, toast `Please fill the required field: <Field>`.
- C: Permanent Address PIN required when "Mark current address as permanent" is unticked.
- C: whitespace-only value in a required text field (is `"   "` treated as empty?).
- C: field-level `required` from config is checked **on blur only**: fill, blur, then save. Does save still go through?
- A: required fields specific to a registration type (International, Staff `Staff Details*`, New Born `Mother UHID*`).

## Names (REG-REQ-003)
- C: digits are stripped as typed (`User3` -> `User`). Assert the stored value.
- C: spaces in First Name are **not** split (split flags off on demo).
- Real-world valid names: apostrophe (`D'Souza`), hyphen (`Anne-Marie`), dot initial (`S.`), single letter, long name (50/100/255 chars), leading/trailing spaces (trimmed?), Unicode/Devanagari (`राम`), mixed case preserved.
- A: symbols `@#$%`, emoji, HTML/script text `<b>x</b>` (must be stored as text, never rendered).
- Title <-> Gender sync: `Mrs.` -> Female, `Mr.` -> Male; then change Gender by hand. Which wins? (`title-gender` workflow covers ordering.)

## Phone and email (REG-REQ-002)
- C: India 10 digits starting 6-9; 9 digits and 11 digits (input limit); first digit 0-5; one leading 0 dropped; letters stripped. Error `Enter a valid {N}-digit mobile number for {Country}`.
- C: country change re-validates (India -> Australia/Singapore with the same number).
- A: all-same digits, sequential digits, `+91` prefix typed, spaces/dashes inside the number, pasted value.
- WhatsApp, Emergency Mobile, Alternate: same classes plus cross-field (equal to patient mobile, equal to each other).
- Email: missing `@`, missing domain, spaces, double dot, plus-addressing (valid), uppercase (stored as typed?), 254-char limit, IDN domain.

## DOB and Age (REG-REQ-004)
- C: mask `DD/MM/YYYY`; day > 31 capped; month > 12 capped.
- C: bare number in Age -> `NY 0M 0D` on blur; `NY NM ND` -> DOB calculated. Age then DOB -> age recalculated from DOB.
- C: DOB today -> `0Y 0M 0D`. Leap day 29/02/2000 valid.
- Boundaries: birthday today vs tomorrow (age flips), month-end (31/01 -> age in Feb), 29/02 birthday in a non-leap current year.
- A: future DOB, age > 120, negative/zero/non-numeric age, impossible date (31/02, 29/02/2001), New Born older than a threshold.

## Address (REG-REQ-005)
- C: PIN lookup fires on 6th digit; single-area PIN fills State/District/City/Area; multi-area PIN (110001) clears Area and hint `Several areas share`; unknown PIN -> hint `PIN code not recognized`.
- C: reverse lookup: empty PIN + District/City/Area -> PIN filled (or PIN becomes a dropdown when several).
- C: changing State clears District/City/Area and any system-filled PIN; manually typed fields are never overwritten.
- C: mark permanent mirrors current -> permanent; unticked keeps independent values (`address-copy` / `address-independent` workflows).
- Boundaries: 5-digit and 7-digit PIN, letters in PIN, PIN for another state than the chosen State (`Address details don't match`), non-India country with no PIN.

## Payer (REG-REQ-006)
- C: Self-Paid -> Payer and Sponsor `Cash` and disabled. Changing payer type clears payer/sponsor.
- Corporate / Insurance without a payer -> blocked? (A unless config says required.)
- Switch Corporate -> Self-Paid -> back to Corporate: stale values cleared? (`payer-reset` workflow.)

## Registration types (REG-REQ-007)
- Each of the 6 types opens its extra fields; switching type back hides them **and** clears their values (stale data saved?).
- New Born: Mother UHID valid / unknown / inactive / a male patient's UHID / the newborn's own UHID.
- Staff: Dependants options, Staff Details lookup. International: Id Type Foreigner path.

## Identity (REG-REQ-008)
- Id Type without number, number without type, whitespace number, format per type (Aadhaar 12 digits, PAN `AAAAA9999A`, passport). ID-proof upload is **not automated yet** (keep such cases disabled or manual).

## Duplicates and submit (REG-REQ-009)
- C: exact duplicate (lower-cased first+last, DOB, gender, phone digits) -> server 409 inside HTTP 200 -> UI may show success (known bug). `saveTwice` -> `duplicate-warning`.
- Near-duplicates: case difference, extra space, different gender: should they be duplicates? (A)
- `saveDoubleClick` -> `created-once`. Save while duplicate settings still load is refused (C).

## Search (REG-REQ-010)
- C: matches full name, UHID, phone; only active records; exactly one hit opens the record; `N records found` otherwise.
- C: text is not regex-escaped server-side: `(`, `[`, `*`, `+`, `.`, `\` -> `no-error` cases.
- Partial name, wrong case, UHID with lowercase, phone with spaces, 1-char query, very long query, inactive patient -> `not-found`.

## Update (REG-REQ-011)
- C: Save reads "Update" and is disabled until a change (`saveDisabled: true`, known failing).
- C: remarks modal; Submit disabled for empty and whitespace remarks (`update-remarks` workflow).
- Every create-time validation again on edit (9-digit mobile, blank required field, future DOB) -> `blocked`.
- Edit then revert to the original value: Update disabled again?
- C: failed update shows no toast. Assert the server response, not the UI.

## UI transitions (REG-REQ-012)
- New button clears an unsaved form (`new-reset`). Tab/arrow keyboard order (`keyboard-fields`).
- No validation errors on a fresh form (`fill` + `no-errors`).
- Type switch, payer switch and state change do not leave stale values or show early errors.

## Data integrity
- Saved values exactly equal input (trim? case? Unicode normalised?) -> `persisted`.
- Look in the DB read-only when the UI cannot show a value: `node qa/tools/mongo-read.js schema PATIENT_REGISTRATION_DB '{"properties.first_name":"Agent"}'`, then `find`.
