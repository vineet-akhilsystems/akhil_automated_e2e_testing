# Registration run 2026-10-29T07-30-06

Cases: 62 | PASS 1 | FAIL 2 | FAIL (assumed) 0 | OBSERVED 0 | ERROR 3 | SKIPPED 56

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | ERROR | New Registration with only mandatory fields is created and persisted | created | runner error: locator.click: Timeout 20000ms exceeded. |
| REG-002 | SKIPPED | New Registration with every optional field filled is created and persisted |  | disabled in case file |
| REG-003 | SKIPPED | Female patient with title Mrs. is created with gender Female |  | disabled in case file |
| REG-004 | SKIPPED | Typing age 30 instead of DOB formats age and auto-calculates DOB |  | disabled in case file |
| REG-010 | ERROR | Saving an empty form is blocked and lists all required fields | blocked | runner error: locator.click: Timeout 20000ms exceeded. |
| REG-011 | SKIPPED | Missing First Name blocks save |  | disabled in case file |
| REG-012 | SKIPPED | Missing Last Name blocks save |  | disabled in case file |
| REG-013 | SKIPPED | Missing DOB (and age) blocks save |  | disabled in case file |
| REG-014 | SKIPPED | Missing Mobile No blocks save |  | disabled in case file |
| REG-015 | SKIPPED | Missing Address (marked * on screen) blocks save |  | disabled in case file |
| REG-016 | SKIPPED | Missing Pin Code (marked * on screen) blocks save |  | disabled in case file |
| REG-017 | SKIPPED | First Name of only spaces is treated as empty |  | disabled in case file |
| REG-018 | SKIPPED | Choosing 'None' for required Gender blocks save |  | disabled in case file |
| REG-019 | SKIPPED | Choosing 'None' for required Title blocks save |  | disabled in case file |
| REG-037 | SKIPPED | Title 'Mrs.' with Gender 'Male' is flagged as inconsistent |  | disabled in case file |
| REG-020 | ERROR | 9-digit mobile number shows an error and blocks save | blocked | runner error: locator.waitFor: Timeout 20000ms exceeded. |
| REG-021 | SKIPPED | Typing 11 digits into mobile keeps only 10 |  | disabled in case file |
| REG-022 | SKIPPED | Mobile starting with 5 (not a valid Indian mobile) is rejected |  | disabled in case file |
| REG-023 | SKIPPED | Mobile with a leading 0 is accepted after dropping the 0 |  | disabled in case file |
| REG-024 | SKIPPED | Letters typed into mobile are stripped |  | disabled in case file |
| REG-025 | SKIPPED | All-same-digit mobile 9999999999 is rejected |  | disabled in case file |
| REG-026 | SKIPPED | 5-digit WhatsApp number is rejected |  | disabled in case file |
| REG-027 | SKIPPED | 3-digit emergency contact mobile is rejected |  | disabled in case file |
| REG-030 | SKIPPED | Digits in First Name are rejected |  | disabled in case file |
| REG-031 | SKIPPED | Special characters in First Name are rejected |  | disabled in case file |
| REG-032 | SKIPPED | 120-character First Name is limited or rejected |  | disabled in case file |
| REG-033 | FAIL | Full name typed into First Name is split into middle and last name | field-state; values {"first_name":"Agent","middle_name":"Testing","last_name":"User6"} | values {"first_name":"Agent Testing User","middle_name":"","last_name":""}; errors {"Title":"*","First Name":"*","Last Name":"*","Gender":"*","DOB":"*","Mobile No":"*","Country":"*","Pin Code":"*","State":"*","Address":"*","Payer Type":"*","Payer":"*","Sponsor":"*","Id Type":"*"} |
| REG-034 | SKIPPED | Hindi (Unicode) First Name is accepted |  | disabled in case file |
| REG-035 | SKIPPED | Leading/trailing spaces in names are trimmed when saved |  | disabled in case file |
| REG-040 | SKIPPED | Future DOB is rejected |  | disabled in case file |
| REG-041 | SKIPPED | Impossible date 31/02/2000 is not accepted as typed |  | disabled in case file |
| REG-042 | SKIPPED | Day 45 is capped to 31 by the DOB mask |  | disabled in case file |
| REG-043 | SKIPPED | DOB today gives age 0Y 0M 0D |  | disabled in case file |
| REG-044 | SKIPPED | DOB in 1900 (age 126) is rejected |  | disabled in case file |
| REG-045 | SKIPPED | Age 150 is rejected |  | disabled in case file |
| REG-050 | SKIPPED | Invalid email 'agent@' is rejected |  | disabled in case file |
| REG-060 | FAIL | PIN 110001 fills State/District/City and asks to choose an Area | field-state; values {"country":"India","state":"DELHI","district":"NEW DELHI","city":"NEW DELHI"}; hints {"pin_code":"Several areas share"} | values {"country":"India","state":"DELHI","district":"NEW DELHI","city":"NEW DELHI","pin_code":"110001","hint:pin_code":"*"}; errors {"Title":"*","First Name":"*","Last Name":"*","Gender":"*","DOB":"*","Mobile No":"*","Country":"*","Pin Code":"*","State":"*","Address":"*","Payer Type":"*","Payer":"* |
| REG-061 | SKIPPED | Unknown PIN 000000 shows 'not recognized' |  | disabled in case file |
| REG-062 | SKIPPED | 5-digit PIN does not trigger a lookup |  | disabled in case file |
| REG-063 | SKIPPED | Letters typed into PIN are stripped |  | disabled in case file |
| REG-064 | SKIPPED | Choosing State, District and Area without a PIN fills the PIN (reverse lookup) |  | disabled in case file |
| REG-065 | SKIPPED | PIN 246149 fills UTTARAKHAND / PAURI GARHWAL |  | disabled in case file |
| REG-066 | SKIPPED | Changing State after PIN autofill clears District, City, Area and the PIN |  | disabled in case file |
| REG-067 | SKIPPED | 'Mark current address as permanent' patient is created |  | disabled in case file |
| REG-068 | SKIPPED | Very long (600 char) address is accepted or limited |  | disabled in case file |
| REG-070 | PASS | Default payer is Self-Paid with Payer and Sponsor = Cash | field-state; values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"} | values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"}; errors {"Title":"*","First Name":"*","Last Name":"*","Gender":"*","DOB":"*","Mobile No":"*","Country":"*","Pin Code":"*","State":"*","Address":"*","Payer Type":"*","Payer":"*","Sponsor":"*","Id Type":"*"} |
| REG-080 | SKIPPED | New Born Registration without Mother UHID (marked *) is blocked |  | disabled in case file |
| REG-081 | SKIPPED | International Registration with mandatory fields is created |  | disabled in case file |
| REG-082 | SKIPPED | Outside Registration with mandatory fields is created |  | disabled in case file |
| REG-083 | SKIPPED | Diagnostic Registration with mandatory fields is created |  | disabled in case file |
| REG-084 | SKIPPED | Staff Registration without Staff Details (marked *) is blocked |  | disabled in case file |
| REG-085 | SKIPPED | Switching registration type does not show 'required' errors before Save |  | disabled in case file |
| REG-090 | SKIPPED | Registering the exact same patient twice is not reported as a success |  | disabled in case file |
| REG-100 | SKIPPED | Search 'Agent Testing' finds the agent-created patients |  | disabled in case file |
| REG-101 | SKIPPED | Search 'Vineet' finds the existing patient Vineet |  | disabled in case file |
| REG-102 | SKIPPED | Search 'Vivek' finds the existing patient Vivek |  | disabled in case file |
| REG-103 | SKIPPED | Search by the mobile number of REG-001 finds it |  | disabled in case file |
| REG-104 | SKIPPED | Search with a regex character '(' does not error |  | disabled in case file |
| REG-105 | SKIPPED | Search for a nonsense name returns 0 records |  | disabled in case file |
| REG-110 | SKIPPED | Update button stays disabled until something changes |  | disabled in case file |
| REG-111 | SKIPPED | Editing the email of REG-001 and submitting remarks updates the record |  | disabled in case file |
| REG-120 | SKIPPED | Upload ID proof PDF attaches it to the patient |  | Pending: Upload ID Proof modal locators (run discovery first). |