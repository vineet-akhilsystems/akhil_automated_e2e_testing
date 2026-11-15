# Miracle HIS - Registration: working rules (DRAFT)

Every line comes from one walkthrough video (see `intake/registration-walkthrough-notes.md`). **Said** = the speaker states it, **Seen** = visible on screen, **Ask** = needs the business analyst. A case that rests only on these lines must mark its expectation as assumed.

## Required fields
- R1 (Said, Seen): fields marked with a star are mandatory: Gender, DOB, Mobile, Whatsapp No, Referral Type, Payer Type, Payer, Nationality, Identity Type (Seen). Ask: the exact list and the message shown for each.
- R2 (Seen): Middle name, last name, address, e-mail, area and pin code appear optional. Ask.

## Registration types
- R3 (Said): types are New Registration, New Born, Diagnostic Only, Staff, International, Staff Dependent, and the page changes with the type.
- R4 (Said): International needs nationality, visa number and visa expiry date. Seen: Identity Type becomes PASSPORT and Identity # becomes mandatory.
- R5 (Said): New Born needs the mother's UHID, picked from a list of female patients only. Seen: Delivery Type, Delivery Date, Weight and Height are mandatory.
- R6 (Said): Staff needs employee, relation and card details; the employee comes from the employees registered in Administration. Staff Dependent: pick the employer first, then the dependent.
- R7 (Said): Diagnostic Only has minor changes. Ask which.

## Fields that derive from others
- R8 (Said, Seen): the Whatsapp number can be copied from the mobile with the Copy checkbox, or entered separately.
- R9 (Said, Seen): choosing the area fills the pin code.
- R10 (Said, Seen): DOB or Age can be entered and the other is calculated (age 27 gave a DOB 27 years before the registration date). Ask: rules for future dates, age 0, age over 120, and editing both.
- R11 (Seen): choosing the title sets Gender and Legal Guardian type (Mrs. gave Female and W/O). Ask: is that rule fixed, and can it be overridden?

## Flags
- R12 (Said): VIP Narration marks the patient as VIP. Name Masking creates an alias and the real name is not shown. Handle With Care shows an alert whenever the patient is opened. Ask: where these show.

## Payer
- R13 (Said, Seen): Direct Patient uses the payer TARIFF VERSION 9.0. Company: choose the Payer, the Sponsor selects itself, then add Insurance Details. Insurance: choose the payer, the sponsor comes in, change it if it is not mapped. Staff registrations switch the payer type to Company and ask for employee number, relation and card.
- R14 (Seen): Insurance Details without a saved patient gives "Please Select The Patient".
- R15 (Said): saving with an expired company shows a pop-up ("the company is expired"). Ask: does it block the save?

## After save
- R16 (Said, Seen): a unique UHID is generated and shown; the message "Record save successfully." appears.
- R17 (Said, Seen): a dialog offers Admission, Appointment, Attach Documents, OP Bill and Cancel. Cancel changes nothing.
- R18 (Said): the system gives a pop-up for each validation problem. Ask: wording of each.

## Risk areas to test first (Practice, ranked)
1. Duplicate patients: same name + mobile, same mobile, Check Duplicate behaviour (identity across billing depends on one UHID per person).
2. Wrong-patient data: mother and baby link, staff and dependent link, and the UHID shown after Save belonging to the saved patient.
3. Payer and sponsor: company/insurance mapping, expired company, a saved patient with the wrong payer billing the wrong party.
4. Mandatory fields enforced on Save (not only when leaving a field), and by the server, not only the browser.
5. Age and DOB consistency, and the default DOB 01/01/2026.
6. Classic ASP.NET behaviour: double click on Save creating two patients, refresh after save re-posting, session timeout mid-form, values lost after a postback, dropdown typed text versus selected value.
7. Special characters and long text in names, address and search.
