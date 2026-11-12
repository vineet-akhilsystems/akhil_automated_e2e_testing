# Registration run 2026-10-29T08-58-32

Cases: 13 | PASS 7 | FAIL 4 | FAIL (assumed) 2 | OBSERVED 0 | ERROR 0 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | PASS | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserOneHundredFortyFive","mobile":"9873432000","state":"DELHI"} | created (UHID ASNR0000000445); toast: Registration Number: ASNR0000000445 |
| REG-064 | FAIL | Choosing State, District and Area without a PIN fills the PIN (reverse lookup) | field-state; values {"pin_code":"*"} | values {"pin_code":"","state":"DELHI","district":"NEW DELHI","area":"F F C Okhla"} |
| REG-101 | FAIL | Search 'Vineet' finds the existing patient Vineet | found | not-found (0 records found) |
| REG-104 | FAIL | Search with a regex character '(' does not error | no-error | error (0 records found) |
| REG-110 | FAIL | Update button stays disabled until something changes | field-state; Update button disabled | field-state; Update button enabled before changes |
| REG-130 | PASS | Apostrophe surname D'Souza is saved exactly | created; saved {"last_name":"D'SouzaUserOneHundredFifty"} | created (UHID ASNR0000000446); toast: Registration Number: ASNR0000000446 |
| REG-132 | PASS | Initial with a dot 'S.' as first name is saved exactly | created; saved {"first_name":"S."} | created (UHID ASNR0000000447); toast: Registration Number: ASNR0000000447 |
| REG-133 | PASS | Single-letter first name 'A' is accepted | created; saved {"first_name":"A"} | created (UHID ASNR0000000448); toast: Registration Number: ASNR0000000448 |
| REG-150 | PASS | Email with plus-addressing is accepted and saved | created; saved {"email":"agent+153@example.com"} | created (UHID ASNR0000000449); toast: Registration Number: ASNR0000000449 |
| REG-151 | FAIL (assumed requirement) | Email with spaces is rejected | blocked; (assumed requirement) | created (UHID ASNR0000000450); toast: Registration Number: ASNR0000000450 |
| REG-192 | FAIL (assumed requirement) | New Born with DOB 30 years ago is rejected | blocked; (assumed requirement) | created (UHID ASNBR240000000009); toast: Registration Number: ASNBR240000000009 |
| REG-210 | PASS | Search by the UHID of REG-001 opens it | found | found (opened single match) |
| REG-220 | PASS | Changing the mobile of REG-001 to 9 digits blocks the update | blocked | blocked; Update button enabled before changes; toast: Mobile No: Enter a valid 10-digit mobile number for India (e.g. 8123456789); errors {"Mobile No":"Enter a valid 10-digit mobile number for India (e.g. 8123456789)"} |