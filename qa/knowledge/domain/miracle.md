# Domain notes: Miracle HIS (billing)

> DRAFT for a senior tester or billing analyst to correct. Labels: **Confirmed** = stated in project files or code in this repository. **Public** = taken from public product pages (vendor claims, not verified by us). **Practice** = general hospital-billing and web-testing experience, not a requirement of this product. **Ask** = open question for the business analyst. A case that relies only on Public, Practice or this file is "tester experience": mark its expectation as assumed. Nothing about Miracle's billing rules has been confirmed from product documentation yet, so every money rule below needs a business analyst's confirmation before it becomes an expected result.

## What the product is, as far as the material shows
- Miracle HIS is a web hospital information system from Akhil Systems. Public pages list OPD, IPD with ward and CPOE, pharmacy, laboratory (LIS), radiology (RIS), inventory, billing, finance and accounts, appointments, admission/transfer/discharge, and reports. Billing is said to include package billing, insurance billing, CGHS/ECHS billing and external referral handling. "Miracle on Cloud" is the hosted version, and invoices, lab reports and appointments can be sent by WhatsApp. **Public.**
- The UAT billing site (uatbilling.miracleoncloud.com) is a classic ASP.NET Web Forms page with Telerik RadComboBox dropdowns. **Confirmed** (tests/auth.miracle.setup.ts).
- Sign-in takes a user id and password, then Facility, Group (for example ADMINISTRATION) and Entry site (for example Cardiology). The dropdowns fill in for that user after the password field loses focus. **Confirmed.**
- Today Test Studio automates Miracle login and synthesized adapter modules (`portal/automate.mjs`); live discovery and staging runs still require VPN/environment credentials, and billing business rules remain unconfirmed. **Confirmed** (docs/MODULE_PIPELINE.md).

## Money must be exactly right (Practice; confirm each rule)
- **Charges.** A rate per service, depending on payer class, bed or ward type, and time (day, night, emergency). Rates have effective dates; an old bill must keep the rate it was made with.
- **Bill arithmetic.** Total = lines - discounts + tax. Check rounding (to the paisa, per line versus on the total), zero and very large amounts, negative amounts, and quantity and rate edges.
- **Discounts and concessions.** Limits by role, an authorization trail, and no stacking that takes a bill below zero.
- **Tax (GST).** Which services are taxed, inclusive versus exclusive rates, and tax shown correctly on the receipt.
- **Advances, deposits, refunds.** Payments + advances - refunds must equal what is settled. A refund can never exceed what was paid; a cancelled service must reverse its charge once.
- **Payment modes.** Cash, card, UPI, cheque and split payments; a split must add up to the bill.
- **Packages.** A package covers some services and not others; extras outside the package are billed separately and never twice.
- **Insurance, TPA, CGHS/ECHS.** Pre-authorization limits, co-pay, non-payable items, claim status and rejection, and the patient's share. The same service must not be billed to both patient and insurer.
- **Interim and final bills.** A finalized or locked bill must not change without an audited reversal. Discharge must not complete with an unsettled balance unless a documented override allows it.
- **Cash counters.** Shift close and day-end reconciliation: collections per user and mode must match the receipts.

## Patient and visit context (Practice)
- Charges must land on the right patient and the right visit (OPD, IPD, emergency). A wrong-patient charge is the worst billing defect.
- A patient registered twice (or merged wrongly) splits or mixes bills; check identity across registration, billing and reports.
- Reports (collections, outstanding, GST) must agree with the bills; long reports can be slow (a reviewer's remark in public reviews), so test timeouts and large date ranges.

## Classic ASP.NET and Telerik pitfalls (Practice)
- **Postbacks.** Double-click on Save or Pay creating two receipts; browser back or refresh re-posting a form; session timeout in the middle of a bill; a partial refresh (UpdatePanel) losing typed values.
- **Telerik combo boxes.** Typing versus selecting an item, a value reset after a postback, near-duplicate options (the facility list already has near-duplicates such as "Akhil System Pvt.Ltd 2" - **Confirmed** in the login code comment), and the selected text different from the stored value.
- **Grids.** Paging, sorting and filter retention, totals that cover only the page shown, and export to Excel or PDF matching what is on screen.
- **Validation.** Rules enforced only in the browser, and the same rule missing on the server.
- **Popups and printing.** Pop-up windows blocked, a receipt printing with wrong totals or another patient's data, and date and number formats by locale.

## Access and audit (Practice)
- Facility, group and entry site decide which counters, bills and reports a user may reach. A group without billing rights must not open billing screens, even by typing the address.
- Cancel, refund, discount and edit actions need a user, a time and a reason in the audit trail.

## Possible link with Augastam (Observed; relationship not confirmed)
- Augastam's demo tenant is called "Miracle HIS Demo" and its onboarding checklist asks for HIS integration details. If the two systems exchange patient or charge data, test identity (UHID) across both, charges posted from clinical orders, duplicates, timing, and a failed exchange that shows no message.

## Ask the business analyst
- What are the real rate rules (payer class, ward type, time of day) and their effective dating?
- Which discount limits and approval steps apply, and who may refund or cancel after a bill is final?
- How are packages, CGHS/ECHS and insurance co-pay calculated, with examples to compare against?
- Which reports must reconcile, and to what tolerance?
