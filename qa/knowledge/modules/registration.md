# Registration: lessons from real defects and confirmed behaviour

Source: qa/modules/registration/rules.md and the confirmed defect reports in qa/modules/registration/bugs/ (demo build 2.0.66). Everything in the first two sections was observed on the live demo and is safe to cite as confirmed.

## Defect patterns already found here (look for the same pattern in new cases and other modules)
- **Server errors hidden in a successful response.** The backend can return `{statusCode: 409 | 500}` inside HTTP 200, and the front end treated it as success ("[object Object]" toast). Always verify a save from the response and by reopening the record, not from the toast. (REG-090)
- **Invalid data accepted and saved.** Phone numbers with 3 or 5 digits or `9999999999`, an emergency mobile equal to the patient's mobile, emails like `agent@` or with spaces, a future date of birth, ages like 150Y or 1900, a 30-year-old "New Born", `@#` in names, title "Mrs." with gender Male, a new-born with a non-existent mother UHID. (REG-025/026/027/030/031/037/040/044/045/050/151/160/191/192)
- **Validation only on blur.** Field rules run when leaving the field, not on Save, so pressing Save straight away skips them. Test "fill, do not blur, Save" as well as "fill, blur, Save". (REG-033/085)
- **Premature errors and hidden tabs.** Switching registration type shows errors before any input; a required field on a hidden tab can block Save without a visible reason. (REG-069)
- **Silent clamping.** Leap day `29/02/2000` becomes `28/02/2000` while typing; digits are stripped from names as typed. Assert what was stored, not only what was typed. (REG-140, REG-030)
- **Dependent field logic.** Reverse PIN lookup (State + District + Area to PIN) fails or flags a false mismatch. Changing State must clear District, City, Area and any system-filled PIN. (REG-064)
- **Search resilience.** Special characters such as `(` in the top-bar search cause a server error because the text is not escaped. Try regex characters, quotes and very long text in every search box. (REG-104)
- **Button state.** "Update" is enabled immediately on opening an existing record before any edit. (REG-110)
- **Update failures are silent.** A failed update only logs to the console; there is no error toast.

## Confirmed rules (cite rules.md as the source)
- Hard-coded required fields: First Name, Last Name, DOB, Gender, Mobile. Save shows `Please fill the required field: <Field>`.
- Permanent address is also validated unless "Mark current address as permanent" is ticked.
- Exact duplicate = same first+last name (case-insensitive), DOB, gender and phone digits; the server answers 409 inside HTTP 200.
- Age typed as a bare number becomes `NY 0M 0D` on blur; a full `NY NM ND` calculates the DOB.
- A mobile number loses one leading 0; validity follows the selected country; error text is `Enter a valid {N}-digit mobile number for {Country}`.
- Changing payer type clears payer and sponsor; "Self-Paid" disables them.
- Registration numbers are consumed even by rejected attempts, and there is no delete.

## What is NOT defined (write such cases as assumed and put the question to the BA)
- Email format rules, name character rules, limits on future or very old dates, and what counts as a valid emergency contact are not configured. Say so in openQuestions instead of inventing the rule.

## Versions (how a result is tied to a build)
- **Confirmed (portal code, README "Versions"):** every portal run records a typed application version (from the login profile or a run override), a detected login-profile hash (which configuration endpoints the app answered) and an automatic automation version (v1, v2, ... by content hash of the test files). `get_run_failures` and `compare_runs` compare these with the previous run and print a hint.
- **Confirmed:** a partial run touches fewer configuration endpoints, so its profile hash differs from a full run's; automation numbers are per portal database. An unknown value is shown as unknown, never as a difference.
- **Practice:** when a case flips between runs, look at the automation version first (changed test files), then the typed app version, before suspecting the product. Say which version a lesson was observed on (the lessons above are from demo build 2.0.66).
- **Ask (BA):** what an application version number promises (a release, a hotfix, a config change), who types it on the profile, and whether a configuration change without a version bump is possible.

## Risks to weigh first for this module
1. Wrong or duplicate patient (identity fields, duplicate check, double-click Save).
2. Bad data saved silently (phone, email, date of birth, age versus type).
3. Success shown when the save failed (hidden server errors, failed update).
4. Wrong billing context (payer type changes, staff and dependants, self-paid).
5. Search that fails or exposes other records.
