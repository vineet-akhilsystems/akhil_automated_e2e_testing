# Miracle HIS - Registration walkthrough (Registration.mp4, 6 min 38 s)

Source: a screen recording of the UAT site (uatbilling.miracleoncloud.com) with a spoken walkthrough. These notes combine what is **visible on screen** (frames every 8 seconds, all 50 reviewed) with the **speaker's words** (local speech-to-text, `registration-walkthrough-transcript.txt`; automatic transcription can mishear words).
Labels: **Said** = the speaker states it. **Seen** = visible on screen only. **Ask** = unclear, needs the business analyst. Nothing here is a confirmed product rule until the BA agrees.

The login details the speaker reads out loud were removed from the transcript on purpose. Do not add them to any file; the portal's login profile (Settings) holds them.

## Screen map

### Sign-in (`/LoginNova.aspx`) - Seen
User id, Password (show/hide eye icon), Facility, Group, EntrySite dropdowns, LOGIN and CLEAR buttons. After the password field loses focus the three dropdowns fill in by themselves (Facility "Akhil System Pvt.Ltd", Group "ADMINISTRATION", EntrySite "Cardiology" in the video).

### Home and menu - Said/Seen
After login the user lands on a message page (Inbox/Outbox, To Do list). The module menu on the left lists Registration, Appointment, EMR, Clinical Masters, Administration, Reports, Billing, ATD, LIS Setup, Phlebotomy, LIS and more. Registration > Demographics opens the registration page (`/PRegistration/Demographics.aspx?mode=N...`).

### Registration page - Seen
- Sub-tabs: Demographics, Permanent Address, Approval Logs, Attach Document, Bulk Registration, OT Patient Tagging, Merge Patient Details, Health Edge Card - Member Details.
- Toolbar: Notes, Sticker, New, Save, Print, Print Card, PatientRegDetails, Check Duplicate, and a list icon that opens a patient search ("Patient Details": search by criteria or date range; fields UHID, IP No, Bed No, E-mail, Patient Name, DOB, Aadhar No, Mobile, Mother Name, Father Name, Company, Passport No, Identity No, Old Reg No, Privilege Card, Address, Guardian Name; Facility and Entry Site filters).
- Top: Registration Type dropdown, UHID and PrePatient boxes.
- Personal information: Title (Mr./Mrs. ...), First/Middle/Last Name, Gender*, Marital Status, DOB*, Age (Y-M-D), Legal Guardian (S/O, W/O ...), Mother Name, Father Name. Photo area with upload, delete and camera icons. Read-only Reg. By, Reg. Date (today), Update By, Update On.
- Contact details: Mobile* (+91 country code), Address, Whatsapp No* with a "Copy" checkbox, Country (INDIA), State, District, Sub County, Area, Pin Code, Phone/Landline, Email.
- Patient identity details: Nationality*, Identity Type*, Identity #, PAN No. Emergency contact: Name as Guardian (Yes/No), Name, Relationship, Contact No.
- Lower tabs: Other Info, Permanent Address, Custom Fields, Checklist.
- Payer: Payer Type* (Direct Patient / Company / Insurance), Payer*, Sponsor, Network, "Insurance Details" button.
- Referral info: Specialisation, Provider, Refer To, Lead Source, Referral Type*, Referred By (type 4 characters to search), Patient Type, HCF, Status (Active), Remarks.
- Other: Religion, Occupation, Lead Source Narration, Monthly Income, VIP Narration, Name Masking, Handle With Care, Send Promotional (Msg/Alert, E-mail, IS DOBRequired), AbhaNumber, AbhaAddress.

## Registration types (Said and Seen)
New Registration, New Born, Diagnostic Only, Staff, International, Staff Dependent. The page changes with the type:
- **New Born** (Said/Seen): a Mother UHID box and a Baby field appear, and a "New born details" block with Delivery Type*, Delivery Date*, a day count, Weight (Kg)*, Height (cm)*, Temperature, New Born Detail. The mother is picked from a list that holds only female patients (Said).
- **International** (Said/Seen): Nationality* (--Select Nationality--), Identity Type shows PASSPORT, Identity # becomes mandatory, Visa No* and Exp Date* appear.
- **Diagnostic Only** (Said): "some minor changes"; Seen: Gender defaults to Male and fields look like New Registration. Ask: what exactly differs?
- **Staff** (Said/Seen): needs Employee relation and card details; a binoculars icon opens "Employee Dependant Links" with a search box (name, employee type, mobile or e-mail) and a grid. Employees come from Administration (Said). The employee list showed "Items 1-50 out of 271". Payer Type switches to Company and Emp#*, Relation* and Card (Choose File) appear.
- **Staff Dependent** (Said/Seen): first pick the employer, then the dependent; the dependent links show on the same dialog.

## The registration shown (New Registration) - step by step
1. Choose Title "Mrs." (Gender changed to Female and Legal Guardian to W/O by itself - Seen; Said "I can select the titles"). Ask: is Gender locked once the title decides it? In the frames it looks greyed.
2. First name entered (the video used a demo name). Middle and last name left empty - Seen. Ask: are they optional?
3. Mobile 10 digits entered (+91 prefix). Address "DELHI". Tick **Copy** to copy the mobile into Whatsapp No (Said: "otherwise you can put another number").
4. State: typing "u" filtered the list (Seen) and UTTAR PRADESH was chosen; District AGRA, Sub County AGRA; Area typed "Achnera"; **Pin Code filled in by itself (283101)** (Said: "you will get the pin code").
5. Date of birth: DOB defaults to 01/01/2026. Said: "put the date of birth from the calendar, or just give the age and the system will calculate". Seen: typing Age 27 changed DOB to 13/11/1999 (today minus 27 years). Ask: what happens when both are edited, or the age is 0 or above 120?
6. Tick VIP Narration, Name Masking, Handle With Care (Said: VIP marks the patient as VIP; Name Masking gives an alias name and the system will not show the real name; Handle With Care shows an alert/notification). Seen: ticking them showed no visible change on the page. Ask: where do the alias and the alert appear?
7. Referral Type* (default Self): Self, Camp, External Provider, Facility, Internal Provider, Staff (Said/Seen).
8. Payer Type: Direct Patient uses payer "TARIFF VERSION 9.0" (Said/Seen). Company: choose the Payer first; the Sponsor selects itself (Said); then add Insurance Details (Said). Insurance: pick the payer, the Sponsor comes in; "if it is not mapped, change it" (Said).
9. Click **Save**. Said: "the company is expired" - an alert was shown at 05:45 (visible message not captured; Ask for the exact text) and "the system needs to give each and every pop-up". Seen: clicking Insurance Details without a saved patient gives the alert "Please Select The Patient".
10. After a successful save: red text **"Record save successfully."** (Seen), a UHID appears in the UHID box (479 in the video; Said "this is the unique number for this patient"), and a "Would you like to go?" dialog with **Admission, Appointment, Attach Documents, OP Bill, Cancel** (Said: "five options"). Cancel closes it.

## Observed oddities (possible defects, unconfirmed - Ask before filing)
- Message wording "Record save successfully." (grammar) shown in red, the colour usually used for errors.
- The page height shows an empty strip below the form after a save in the last frames (layout).
- DOB defaults to 01/01/2026, a date that already counts as "today minus a few months" and may be accepted as a real DOB if left alone.
- Registration with Company payer ended in "the company is expired" - unclear whether the save was blocked or only warned.
- Name Masking / VIP / Handle With Care show no on-page confirmation after ticking.

## Not covered in the video (Ask)
Permanent Address tab, Approval Logs, Attach Document, Bulk Registration, OT Patient Tagging, Merge Patient Details, Health Edge Card, Print and Print Card output, Sticker, Check Duplicate (what it compares), search by UHID, editing an existing patient, Notes, mandatory-field messages for each empty required field, Reg. By and Update By values, photo upload limits.
