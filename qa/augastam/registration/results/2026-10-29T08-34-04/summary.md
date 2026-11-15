# Registration run 2026-10-29T08-34-04

Cases: 16 | PASS 11 | FAIL 4 | FAIL (assumed) 0 | OBSERVED 1 | ERROR 0 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | PASS | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserOneHundredFour","mobile":"9556276000","state":"DELHI"} | created (UHID ASNR0000000433); toast: Registration Number: ASNR0000000433 |
| REG-010 | PASS | Saving an empty form is blocked with a required-field message | blocked; toast contains "required field" | blocked; toast: Please fill the required field: First Name |
| REG-061 | PASS | Unknown PIN 000000 shows 'not recognized' | field-state; values {"state":""}; hints {"pin_code":"not recognized"} | values {"state":"","pin_code":"000000","hint:pin_code":"PIN code not recognized — please verify or enter address manually"} |
| REG-062 | PASS | 5-digit PIN does not trigger a lookup | field-state; values {"state":""} | values {"state":"","pin_code":"11000"} |
| REG-064 | FAIL | Choosing State, District and Area without a PIN fills the PIN (reverse lookup) | field-state; values {"pin_code":"*"} | values {"pin_code":"","state":"DELHI","district":"NEW DELHI","area":"F F C Okhla"} |
| REG-066 | PASS | Changing State after a typed PIN clears District/City, keeps the typed PIN and warns of the mismatch | field-state; values {"district":"","city":"","pin_code":"110001"}; hints {"pin_code":"don't match"} | values {"district":"","city":"","pin_code":"110001","state":"UTTARAKHAND","hint:pin_code":"Address details don't match the entered PIN code"} |
| REG-068 | OBSERVED | Very long (600 char) address is accepted or limited | observe | values {"address":"Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address block, Agent test address bl |
| REG-090 | PASS | Registering the exact same patient twice is not reported as a success | duplicate-warning | duplicate-warning |
| REG-100 | PASS | Search 'Agent Testing' finds the agent-created patients | found | found (32 records found) |
| REG-101 | FAIL | Search 'Vineet' finds the existing patient Vineet | found | not-found (0 records found) |
| REG-102 | PASS | Search 'Vivek' finds the existing patient Vivek | found | found (23 records found) |
| REG-103 | PASS | Search by the mobile number of REG-001 finds it | found | found (opened single match) |
| REG-104 | FAIL | Search with a regex character '(' does not error | no-error | error (0 records found) |
| REG-105 | PASS | Search for a nonsense name returns 0 records | not-found | not-found (0 records found) |
| REG-110 | FAIL | Update button stays disabled until something changes | field-state; Update button disabled | field-state; Update button enabled before changes |
| REG-111 | PASS | Editing the email of REG-001 and submitting remarks updates the record | updated; saved {"email":"agent.updated119@example.com"} | updated; Update button enabled before changes |