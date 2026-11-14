# Domain notes: hospital information system (Augastam EMR)

> DRAFT written as a starting point. A senior tester or clinical analyst must correct and extend it. Treat anything here as general domain practice, NOT as a confirmed requirement of this product. A case that relies only on this file is "tester experience" and its expectation must be marked as assumed.

## What this kind of system must get right
- **Patient identity.** One real person = one record (UHID). The worst failures are a duplicate record (history split in two) and a merged or wrong record (one patient's data on another). Name, date of birth, gender and phone are the usual identity checks.
- **Age and date of birth.** Age drives clinical decisions (dosing, paediatric versus adult, new-born pathways). Impossible ages, future dates, leap days, and an age that disagrees with the date of birth are all risks.
- **Minors and guardians.** A minor usually needs a guardian or responsible adult on record. New-born registrations link to a mother's record.
- **Contact data.** Wrong phone or email means missed results and failed follow-up. Formats differ by country.
- **Payer and billing.** Self-paid versus insurance or corporate changes what is charged and who is billed. Changing the payer must not leave stale sponsor or policy data behind.
- **Consent and privacy.** Personal and health data must not leak into logs, URLs, error messages, search results or exports. Consent capture must be recorded and traceable.
- **Audit trail.** Who created or changed a record, and when, must be recorded and must not be editable by the person who made the change.
- **Access by role.** Front desk, nurse, doctor, billing and admin see and do different things. A wrong role reaching a screen is a defect even if the screen works.
- **Multi-facility and tenant.** Data from one facility or tenant must not appear in another. Staff sign in to a facility and a role; switching them must not carry over old data.
- **Numbers that are consumed.** Registration and bill numbers are usually sequential. A failed attempt that still uses a number leaves gaps; a retry that reuses a number causes duplicates.
- **Emergency and walk-in cases.** Real front desks register people with missing data (unknown name, no ID). The system should allow a safe path for this and let it be completed later.

## Typical hospital-software failure patterns
- A server error returned inside a successful response, so the screen shows success while nothing was saved.
- A field validated only when the user leaves it, so pressing Save directly skips the check.
- An update that fails silently (no message) and the user believes it saved.
- Search that breaks on special characters, or returns inactive or other-facility records.
- Dependent dropdowns that keep a stale child value after the parent changes.
- A button state (Save/Update) that is wrong when a record is first opened.
- Text typed by the user that is changed silently (digits stripped, spaces trimmed, date clamped).
- The same patient accepted twice with trivial differences (case, spacing, phone formatting).

## Questions a senior tester asks the business analyst
- What is the legal or clinical rule here, and is it written down anywhere?
- What happens to existing records if this rule changes?
- Which roles may do this, and what is logged?
- What should happen when data is missing in an emergency?
