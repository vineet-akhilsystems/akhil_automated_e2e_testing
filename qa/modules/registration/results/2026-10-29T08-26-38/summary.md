# Registration run 2026-10-29T08-26-38

Cases: 33 | PASS 7 | FAIL 7 | FAIL (assumed) 10 | OBSERVED 0 | ERROR 9 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | PASS | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserSeventyOne","mobile":"9555881000","state":"DELHI"} | created (UHID ASNR0000000421); toast: Registration Number: ASNR0000000421 |
| REG-010 | FAIL | Saving an empty form is blocked with a required-field message | blocked; toast contains "required field" | blocked |
| REG-019 | PASS | Choosing 'None' for required Title blocks save | blocked; (assumed requirement) | blocked; toast: Please fill the required field: Title |
| REG-037 | FAIL (assumed requirement) | Title 'Mrs.' with Gender 'Male' is flagged as inconsistent | blocked; (assumed requirement) | created (UHID ASNR0000000422); toast: Registration Number: ASNR0000000422 |
| REG-025 | FAIL (assumed requirement) | All-same-digit mobile 9999999999 is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000423); toast: Registration Number: ASNR0000000423 |
| REG-026 | FAIL (assumed requirement) | 5-digit WhatsApp number is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000424); toast: Registration Number: ASNR0000000424 |
| REG-027 | FAIL (assumed requirement) | 3-digit emergency contact mobile is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000425); toast: Registration Number: ASNR0000000425 |
| REG-030 | FAIL (assumed requirement) | Digits in First Name are rejected | blocked; (assumed requirement) | created (UHID ASNR0000000426); toast: Registration Number: ASNR0000000426 |
| REG-031 | FAIL (assumed requirement) | Special characters in First Name are rejected | blocked; (assumed requirement) | created (UHID ASNR0000000427); toast: Registration Number: ASNR0000000427 |
| REG-033 | FAIL | Full name typed into First Name is split into middle and last name | field-state; values {"first_name":"Agent","middle_name":"Testing","last_name":"UserEighty"} | values {"first_name":"Agent Testing UserEighty","middle_name":"","last_name":""} |
| REG-040 | FAIL (assumed requirement) | Future DOB is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000428); toast: Registration Number: ASNR0000000428 |
| REG-044 | FAIL (assumed requirement) | DOB in 1900 (age 126) is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000429); toast: Registration Number: ASNR0000000429 |
| REG-045 | FAIL (assumed requirement) | Age 150 is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000430); toast: Registration Number: ASNR0000000430 |
| REG-050 | FAIL (assumed requirement) | Invalid email 'agent@' is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000431); toast: Registration Number: ASNR0000000431 |
| REG-061 | FAIL | Unknown PIN 000000 shows 'not recognized' | field-state; values {"state":""}; hints {"pin_code":"not recognized"} | values {"state":"State","pin_code":"000000","hint:pin_code":"PIN code not recognized — please verify or enter address manually"} |
| REG-062 | FAIL | 5-digit PIN does not trigger a lookup | field-state; values {"state":""} | values {"state":"State","pin_code":"11000"} |
| REG-064 | FAIL | Choosing State, District and Area without a PIN fills the PIN (reverse lookup) | field-state; values {"pin_code":"*"} | values {"pin_code":"","state":"DELHI","district":"NEW DELHI","area":"F F C Okhla"} |
| REG-066 | FAIL | Changing State after PIN autofill clears District, City, Area and the PIN | field-state; values {"district":"","city":"","pin_code":""} | values {"district":"District","city":"City","pin_code":"110001","state":"UTTARAKHAND"} |
| REG-068 | ERROR | Very long (600 char) address is accepted or limited | observe | runner error: locator.pressSequentially: Timeout 20000ms exceeded. |
| REG-070 | PASS | Default payer is Self-Paid with Payer and Sponsor = Cash | field-state; values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"} | values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"} |
| REG-082 | PASS | Outside Registration with mandatory fields is created | created | created (UHID ASOR240000000012); toast: Registration Number: ASOR240000000012 |
| REG-083 | PASS | Diagnostic Registration with mandatory fields is created | created | created (UHID ASDR240000000001); toast: Registration Number: ASDR240000000001 |
| REG-084 | PASS | Staff Registration without Staff Details (marked *) is blocked | blocked | blocked; toast: Please fill the required field: Staff Details |
| REG-085 | PASS | Switching registration type does not show 'required' errors before Save | no-errors | values {} |
| REG-090 | FAIL | Registering the exact same patient twice is not reported as a success | duplicate-warning | blocked |
| REG-100 | ERROR | Search 'Agent Testing' finds the agent-created patients | found | runner error: locator.fill: Timeout 20000ms exceeded. |
| REG-101 | ERROR | Search 'Vineet' finds the existing patient Vineet | found | runner error: locator.fill: Timeout 20000ms exceeded. |
| REG-102 | ERROR | Search 'Vivek' finds the existing patient Vivek | found | runner error: locator.fill: Timeout 20000ms exceeded. |
| REG-103 | ERROR | Search by the mobile number of REG-001 finds it | found | runner error: Case REG-103 needs {{phone@REG-001}} but REG-001 did not produce it (did it fail?) |
| REG-104 | ERROR | Search with a regex character '(' does not error | no-error | runner error: locator.fill: Timeout 20000ms exceeded. |
| REG-105 | ERROR | Search for a nonsense name returns 0 records | not-found | runner error: locator.fill: Timeout 20000ms exceeded. |
| REG-110 | ERROR | Update button stays disabled until something changes | field-state | runner error: REG-110 needs the registration id from REG-001, which did not create a patient. |
| REG-111 | ERROR | Editing the email of REG-001 and submitting remarks updates the record | updated | runner error: REG-111 needs the registration id from REG-001, which did not create a patient. |