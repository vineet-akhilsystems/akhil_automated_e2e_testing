# Domain notes: Augastam EMR

> DRAFT for a senior tester or clinical analyst to correct. Labels: **Confirmed** = stated in rules.md, live configuration, bug reports or project files. **Observed** = seen in BA walkthrough videos with no transcript, so the behaviour behind it is not confirmed. **Practice** = general hospital-software experience, not a requirement of this product. **Ask** = open question for the business analyst. A case that relies only on Observed, Practice or this file is "tester experience": mark its expectation as assumed.

## What the product is, as far as the material shows
- A web EMR from Akhil Systems; the demo build in the bug reports is 2.0.66. **Confirmed.**
- Forms and workflows are configuration, not code. Registration fields, required flags and regex rules come from stored webpart configuration, so they can differ per tenant. Test against the configured values, not assumptions. **Confirmed (rules.md).**
- Multi-tenant. Sign-in selects a tenant, facility and role (for example tenant "Miracle HIS Demo", facility "Akhil Demo2 Delhi", role Admin). Data and behaviour must never leak across tenants or facilities, and switching them must not carry old data over. **Confirmed.**
- Registration has six types: New, New Born, International, Outside, Staff, Diagnostic. The patient id is the UHID. **Confirmed.**

## Areas seen in the EMR setup videos (Observed, not confirmed)
- **Tenant onboarding.** A prerequisite list: client name, VPN access, database and report server details, tenant and facility names, a POC facility, IP address, lab-report migration mail access, firewall allowlisting, doctor count. Risk: a missing item found late, or details that disagree between documents.
- **Cross-tenant configuration transfer.** Tabs: Lookup, Module, Workflow, Webparts, Forms, Search Builder, Report Builder, Data Attributes. Import source and destination, transfer mode, template selection, then an Export confirmation (Yes/Cancel). Risks: wrong destination, overwriting or duplicating existing configuration, partial transfer, no visible result after Export.
- **Workflow builder.** Stage > Process (for example SOAP) > Task, with a role at each level; Save Stage, Publish, Preview. Risks: unpublished versus published behaviour, role gating, preview that differs from what is published, duplicate or near-duplicate names.
- **Search builder.** Pick a database object, tick fields, group them under an alias (an alias can hold several fields). Risk: wrong field mapping, rename dialog (Cancel versus OK) losing state.
- **Visit lists.** Status legend Waiting, Active, Closed; count chips Total, Checked In, Regular, Walk In, Assigned To, Assigned By, Open, Seen, Closed. Admin and Doctor see different columns. Risks: a chip count that disagrees with the rows listed, role-specific columns or actions shown to the wrong role.
- **Templates on the patient screen.** Tabs All, Assessment, Scoring, Shift handover, Checklist, Monitoring, with a search box. Template names contain brackets and hyphens and near-duplicates exist ("Pain Assesment Neonatal" and "Pain Assessment Neonatal").
- **Sign-in and logout.** User name and password marked mandatory, a Forgot Password link, and a logout confirmation.

## What a hospital system must get right (Practice)
- **Patient identity.** One real person is one record. The worst failures are a duplicate record (history split) and a merged or wrong record. Name, date of birth, gender and phone are the usual checks.
- **Age and dates.** Age drives dosing and paediatric versus adult pathways. Impossible ages, future dates, leap days, and an age that disagrees with the date of birth are risks. Minors need a guardian on record; new-borns link to a mother's record.
- **Contact data.** Wrong phone or email means missed results; formats differ by country.
- **Payer.** Self-paid versus insurance or corporate changes who is billed; changing payer must not leave stale sponsor or policy data.
- **Consent and privacy.** Personal and health data must not appear in logs, URLs, error messages, search results or exports.
- **Audit and roles.** Who created or changed a record, and when, must be recorded and not editable by that person. The wrong role reaching a screen is a defect even if the screen works.
- **Numbers that are consumed.** Registration numbers are sequential; a rejected attempt can still use one (**Confirmed** on the demo), and a retry must not reuse one.
- **Emergency and walk-in.** Real front desks register people with missing data. There should be a safe path that can be completed later.

## Typical failure patterns
- A server error inside a successful response, so the screen shows success but nothing saved (**Confirmed**, REG-090).
- A rule checked only when leaving a field, so pressing Save directly skips it (**Confirmed**, REG-033/085).
- An update that fails silently (**Confirmed**: failed update only logs to the console).
- Search that breaks on special characters or returns inactive or other-facility records.
- Dependent dropdowns keeping a stale child value after the parent changes.
- A count or pagination that disagrees with the list, for example a range like "1 - 10 Of 8" or "Showing 1 - 0 records" (**Observed**).
- Text silently changed on entry (digits stripped, date clamped, spaces trimmed).
- The same record accepted twice with trivial differences (case, spacing, phone formatting).

## Ask the business analyst
- Which behaviour is intended when a configuration transfer meets an existing item: overwrite, skip or duplicate?
- Who may publish a workflow, and what does an in-progress visit do when its workflow changes?
- Is the visit-list count chip meant to equal the number of rows under the same filters?
- What should happen to data when a tenant or facility configuration changes?
