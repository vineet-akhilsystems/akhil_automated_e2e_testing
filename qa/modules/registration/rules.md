# Registration rules

Sources: the EMR repo's `fe-patient-registration` and `be-front-desk` skills, and the code paths cited.
Paths are relative to `Augastam EMR/custom-form-builder/src` (FE) or `akhil_systems_backend/src` (BE).
Anything not listed here is **not defined** in code; cases that test it are marked `assumed` in the dataset.

## Form
- Fields come from MongoDB config (WORKFLOW `1101f999-…` → WEBPART fields), not code. `npm run reg:discover` records the live field list.
- Cards: Basic Information, Address Details (Current / Permanent tabs), Payer Information, Visit Details, Identity Information, Additional Details (Emergency Info / Other Info), Consent.
- Registration types: New, New Born, International, Outside, Staff, Diagnostic. New Born adds Mother UHID*, Mother's/Father's name, delivery fields; Staff adds Dependants, Staff Details*, Corporate.

## Observed on demo build 2.0.66 (differs from repo code)
- Save validates required fields **one at a time**: toast `Please fill the required field: <Field>` (repo code: one combined list).
- **Permanent Address is validated too**: with only Current Address filled, Save is blocked with
  `Please fill the required field: Pin Code (Permanent Address)`. Ticking "Mark current address as permanent" satisfies it.
- Name fields strip digits as you type ("User3" -> "User").
- First Name with spaces is **not** split into middle/last name (split flags not enabled in config).

## Save (create)
- Hard-coded required check only: First Name, Last Name (skipped when Name Masking is on), DOB, Gender, Mobile. Toast: `Please fill required field(s): …` (FE `pages/registration/RegistrationPreview.jsx:2874-2915`).
- Field-level `required` / regex / digit limits run **on blur only**, not on save (FE `components/webpart/WebpartUtils.js:42-122`).
- Save is refused while duplicate-check settings are loading ("Duplicate-check settings are still loading…").
- Server rejects an exact duplicate (lower-cased first+last name, DOB, gender, phone digits) with `{statusCode:409}` **inside HTTP 200** (BE `patient-registration.controller.ts:2225-2320`).
- **Known bug:** FE only throws on `statusCode === 400`; a 409/500 body is treated as the new registration id → success toast "[object Object]" (FE `utils/api.js:2416-2421`).
- Success: toast `Registration Number:<id>`, navigates to `/registration/<wf>/<id>`, QR modal opens.

## Phone
- libphonenumber mobile rules for the current address country (default India +91). One leading 0 dropped. `maxLength` from the country rule.
- Error: `Enter a valid {N}-digit mobile number for {Country} (e.g. …)`; checked on blur and again on save.

## DOB / Age
- DOB input masked `DD/MM/YYYY`, day capped 31, month capped 12; stored `yyyy-MM-dd`.
- Age: a bare number becomes `NY 0M 0D` on blur; once it matches `^\d+Y\s\d+M\s\d+D$`, DOB is calculated.
- Future/past limits only if configured on the field (`futureDates`, `pastDates`, `daterange`).

## Names
- On blur, a First Name containing spaces is split into middle/last name when those fields are flagged `isMiddleName` / `isLastName`.
- No hard-coded character rules; any come from field `regExpression` / `alphanumeric` / `specialchar` config.

## Address
- PIN → address: lookup fires on the 6th digit (no debounce). Hints: "Looking up PIN code…", "PIN code not recognized — please verify or enter address manually", "Several areas share this PIN code — select one", "Address details don't match the entered PIN code".
- Single match fills State / District / City (= district) / Area; several areas → Area cleared and its options replaced.
- Address → PIN (reverse): PIN empty + District/City/Area chosen → 400 ms debounce → lookup; one PIN fills it, several turn the PIN field into a dropdown.
- Changing State clears District, City, Area and any system-filled PIN. Manually edited fields are never overwritten.
- "Mark current address as permanent" mirrors current → permanent by label.

## Payer
- Changing payer type clears payer and sponsor. "Self-Paid" disables payer and sponsor (defaults Cash).

## Update
- Opening an existing record: Save reads "Update" and stays disabled until something changes ("No changes to update").
- Update opens the "Update Registration" remarks modal; Submit disabled until remarks entered → `PUT update-details`.
- **Known gap:** a failed update only logs to console (no error toast).

## Search
- Top-bar search, 1 s debounce or Enter; regex over full name, UHID, phone; only `isActive != false`.
- Exactly one result navigates straight to the record; otherwise "N records found".
- Search text is not regex-escaped on the server (BE `controller.ts:4901`).

## Data side effects (demo)
- Every create writes PATIENT_REGISTRATION_DB, TRAIL_TABLE, PATIENT_PENDING_REQUEST (fee row) and a task-engine event; registration numbers are consumed even on rejected attempts. No delete endpoint.
