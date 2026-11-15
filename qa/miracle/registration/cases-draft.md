# Miracle HIS - Registration: draft test cases

Status: **DRAFT for review, not approved.** Written from one walkthrough video (rules.md, R-numbers). "Basis": **Video** = said or seen in the recording; **Practice** = tester experience, so the expected result is **assumed** until the business analyst confirms. "Auto" = how it can run once discovery is done: **Y** = a browser test can check it, **N** = needs a person or more information.
Test data rule: every patient is obviously fake ("Agent Testing ..."), with a generated unique mobile; never reuse names or numbers from the video.

| ID | P | Title | Steps (short) | Expected | Basis | Auto |
|---|---|---|---|---|---|---|
| MR-001 | P0 | Login with valid profile lands on home | Open login page, enter profile values, wait for dropdowns, LOGIN | Home page with menu opens; login form gone | Video | Y |
| MR-002 | P1 | Login dropdowns fill after the password field loses focus | Enter user id and password, press Tab | Facility, Group, Entry site get values | Video (R-login) | Y |
| MR-003 | P1 | Wrong password is refused | Enter a wrong password, LOGIN | Stays on login with a message; no session | Practice (assumed) | Y |
| MR-010 | P0 | New Registration with only mandatory fields saves | Fill all starred fields, Save | UHID shown; "Record save successfully."; 5-option dialog (R16, R17) | Video | Y |
| MR-011 | P0 | Saved patient can be found again with the same details | After MR-010, search by UHID or mobile | One patient with the saved name, mobile, DOB, gender | Practice (assumed) | Y |
| MR-012 | P1 | Each mandatory field left empty blocks Save with a message | Repeat Save leaving one starred field empty each time (gender, DOB, mobile, whatsapp, referral type, payer) | Not saved; a message names the field (R18) | Video + Practice | Y |
| MR-013 | P1 | Optional fields (middle name, last name, address, e-mail) can stay empty | Save with only mandatory fields | Saved (R2) | Video (assumed) | Y |
| MR-014 | P1 | Dialog after save: Cancel closes without side effects | Save, press Cancel | Dialog closes, patient stays saved, nothing opened | Video (R17) | Y |
| MR-015 | P2 | Dialog after save: Appointment, Admission, Attach Documents and OP Bill each open the right screen for this UHID | Save, choose each option | Correct screen with the same UHID | Video (R17) | Y |
| MR-020 | P1 | Copy checkbox copies mobile to Whatsapp | Enter mobile, tick Copy | Whatsapp equals mobile | Video (R8) | Y |
| MR-021 | P2 | Whatsapp can differ from mobile | Untick Copy, enter another number | Both numbers saved separately | Video (R8) | Y |
| MR-022 | P1 | Area selection fills pin code | Pick state, district, area | Pin code filled | Video (R9) | Y |
| MR-023 | P1 | Entering age fills DOB | Type age 27 | DOB is today minus 27 years | Video (R10) | Y |
| MR-024 | P1 | Entering DOB fills age | Pick a DOB | Age (Y-M-D) matches | Video (R10) | Y |
| MR-025 | P2 | Age 0, very large age (150) and a future DOB are handled | Enter each | Rejected or clearly handled; no impossible patient saved | Practice (assumed) | Y |
| MR-026 | P2 | DOB left at the default 01/01/2026 | Save without touching DOB | Decide with the BA: warning, or accepted | Practice (assumed) | Y |
| MR-027 | P2 | Title sets gender and guardian type | Choose Mr., Mrs., Ms., Master, Baby | Gender and S/O, W/O follow the title; gender mismatch handled | Video (R11), Practice | Y |
| MR-030 | P0 | International: visa number, expiry and nationality are required | Choose International, leave each empty, Save | Not saved; message per field (R4) | Video | Y |
| MR-031 | P1 | International with passport saves | Fill passport, visa, expiry, nationality | Saved with a UHID | Video | Y |
| MR-032 | P1 | International: visa expiry in the past | Enter a past expiry | Rejected or warned | Practice (assumed) | Y |
| MR-040 | P0 | New Born needs a mother and lists only female patients | Choose New Born, open the mother list | Only female patients listed; baby saved linked to the mother (R5) | Video | Y |
| MR-041 | P1 | New Born mandatory details | Leave delivery type, date, weight, height empty one by one | Not saved; message per field | Video | Y |
| MR-042 | P1 | New Born weight, height and delivery date limits | 0, negative, 99 kg, future date | Rejected or handled | Practice (assumed) | Y |
| MR-050 | P1 | Staff: employer picked from the employee list | Choose Staff, open the employee search, search by name, mobile, e-mail | Matching employees; selecting fills employee data (R6) | Video | Y |
| MR-051 | P1 | Staff: relation and card are required | Leave employee number, relation, card empty | Not saved; message | Video | Y |
| MR-052 | P1 | Staff Dependent: employer first, then dependent | Choose Staff Dependent, select employer, add a dependent | Dependent linked to the employer; shows in dependent links (R6) | Video | Y |
| MR-053 | P2 | Staff Dependent without choosing an employer | Try to save | Blocked with a message | Practice (assumed) | Y |
| MR-060 | P1 | Diagnostic Only saves | Choose Diagnostic Only, mandatory fields, Save | Saved; Ask the BA what differs (R7) | Video (assumed) | N until the BA answers |
| MR-070 | P0 | Direct Patient uses TARIFF VERSION 9.0 | Choose Direct Patient | Payer shows TARIFF VERSION 9.0 (R13) | Video | Y |
| MR-071 | P0 | Company payer: sponsor selects itself, insurance details required | Choose Company, pick payer | Sponsor auto-filled; Save without insurance details is blocked or warned | Video (R13) | Y |
| MR-072 | P0 | Expired company on save | Choose an expired company, Save | Clear pop-up; Ask whether the save is blocked (R15) | Video (assumed) | N until the BA answers |
| MR-073 | P1 | Insurance payer with unmapped sponsor can be changed | Choose Insurance, change sponsor | Sponsor changes and is saved | Video (R13) | Y |
| MR-074 | P1 | Insurance Details before saving shows the "select the patient" alert | Click Insurance Details on a new form | "Please Select The Patient" (R14) | Video | Y |
| MR-080 | P1 | VIP Narration, Name Masking, Handle With Care are saved and shown | Tick each, Save, reopen the patient | Flags persist; VIP marked; real name masked; handle-with-care alert shows (R12) | Video (assumed where) | N until the BA answers |
| MR-090 | P0 | Duplicate patient is detected | Save the same name+mobile twice; use Check Duplicate | Warning or block; one UHID per person | Practice (assumed) | Y |
| MR-091 | P0 | Double click on Save creates one patient | Double click Save | One UHID only | Practice | Y |
| MR-092 | P1 | Refresh after save does not create a second patient | Save, refresh the page | No second patient | Practice | Y |
| MR-093 | P1 | Session timeout in the middle of the form | Let the session expire, Save | Clear message or login; no half-saved record | Practice (assumed) | N |
| MR-094 | P1 | Mandatory rules are enforced by the server, not only the browser | Save with a starred field emptied by script | Server rejects | Practice (assumed) | Y |
| MR-095 | P2 | Special characters and very long text in name, address and search | O'Neil, quotes, <b>, 300 characters | Saved safely or refused; no script runs; no broken page | Practice (assumed) | Y |
| MR-096 | P2 | Referral type list and Referred By search | Open referral type, type 4 characters in Referred By | List has Self, Camp, External Provider, Facility, Internal Provider, Staff; search matches | Video (R-referral) | Y |
| MR-097 | P2 | Rules in the video's "not covered" list | Permanent Address, Approval Logs, Attach Document, Bulk Registration, Merge Patient Details, Health Edge Card, Print Card, Sticker | Needs a walkthrough or notes first | - | N |

## Open questions for the business analyst
1. Exact list of mandatory fields and the message for each. 2. What "the company is expired" does on Save. 3. Gender locked by title? 4. Age/DOB limits and the default DOB. 5. Where VIP, name masking and handle-with-care show. 6. What Check Duplicate compares and when it runs on Save. 7. What differs for Diagnostic Only. 8. Can UAT test patients be removed or inactivated?
