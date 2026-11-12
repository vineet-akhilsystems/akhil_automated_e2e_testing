# Registration run 2026-10-29T08-49-34

Cases: 25 | PASS 13 | FAIL 4 | FAIL (assumed) 3 | OBSERVED 1 | ERROR 4 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | PASS | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserOneHundredTwenty","mobile":"9069931000","state":"DELHI"} | created (UHID ASNR0000000435); toast: Registration Number: ASNR0000000435 |
| REG-130 | ERROR | Apostrophe surname D'Souza is saved exactly | created | runner error: locator.click: Timeout 20000ms exceeded. |
| REG-131 | PASS | Hyphenated first name Anne-Marie is saved exactly | created; saved {"first_name":"Anne-Marie"} | created (UHID ASNR0000000436); toast: Registration Number: ASNR0000000436 |
| REG-132 | FAIL | Initial with a dot 'S.' as first name is saved exactly | created; saved {"first_name":"S."} | duplicate-warning (UHID ASNR0000000437); toast: Registration Number: ASNR0000000437 |
| REG-133 | FAIL | Single-letter first name 'A' is accepted | created; saved {"first_name":"A"} | duplicate-warning (UHID ASNR0000000438); toast: Registration Number: ASNR0000000438 |
| REG-134 | PASS | What 'Agent123' is actually saved as (digit stripping) | created; saved {"first_name":"Agent"} | created (UHID ASNR0000000439); toast: Registration Number: ASNR0000000439 |
| REG-140 | FAIL | Leap day 29/02/2000 is accepted | field-state; values {"dob":"29/02/2000","age":"*"} | values {"dob":"28/02/2000","age":"26Y 7M 30D"} |
| REG-141 | OBSERVED | 29/02/2001 (not a leap year) is not accepted as typed | observe | values {"dob":"28/02/2001"} |
| REG-142 | PASS | Typing age then DOB recalculates age from DOB | field-state; values {"age":"~36Y"} | values {"age":"36Y 2M 14D","dob":"15/08/1990"} |
| REG-150 | FAIL | Email with plus-addressing is accepted and saved | created; saved {"email":"agent+129@example.com"} | duplicate-warning (UHID ASNR0000000440); toast: Registration Number: ASNR0000000440 |
| REG-151 | FAIL (assumed requirement) | Email with spaces is rejected | blocked; (assumed requirement) | duplicate-warning (UHID ASNR0000000441); toast: Registration Number: ASNR0000000441 |
| REG-160 | FAIL (assumed requirement) | Emergency contact mobile equal to patient mobile is flagged | blocked; (assumed requirement) | created (UHID ASNR0000000442); toast: Registration Number: ASNR0000000442 |
| REG-161 | PASS | Country Australia re-validates a 10-digit Indian mobile | blocked | blocked; toast: Please fill the required field: Pin Code (Current Address) |
| REG-170 | PASS | Payer Type Corporate without choosing a Payer blocks save | blocked; toast contains "Payer" | blocked; toast: Please fill the required field: Payer |
| REG-171 | PASS | Payer Type Insurance without choosing a Payer blocks save | blocked; toast contains "Payer" | blocked; toast: Please fill the required field: Payer |
| REG-172 | PASS | Corporate payer with first Payer and Sponsor is created | created; saved {"payer_type":"Corporate"} | created (UHID ASNR0000000443); toast: Registration Number: ASNR0000000443 |
| REG-180 | PASS | Id Type Foreigner without an Id Number is blocked | blocked; (assumed requirement) | blocked; toast: Please fill the required field: Passport Issue Place |
| REG-190 | PASS | New Born with Mother UHID of an existing patient is created | created | created (UHID ASNBR240000000007); toast: Registration Number: ASNBR240000000007 |
| REG-191 | FAIL (assumed requirement) | New Born with a Mother UHID that does not exist is rejected | blocked; (assumed requirement) | created (UHID ASNBR240000000008); toast: Registration Number: ASNBR240000000008 |
| REG-192 | ERROR | New Born with DOB 30 years ago is rejected | blocked | runner error: Case REG-192 needs {{regId@REG-001}} but REG-001 did not produce it (did it fail?) |
| REG-200 | PASS | Double-clicking Save creates exactly one patient | created-once | 1 create request(s), 1 record(s): ASNR0000000444 |
| REG-210 | ERROR | Search by the UHID of REG-001 opens it | found | runner error: Case REG-210 needs {{regId@REG-001}} but REG-001 did not produce it (did it fail?) |
| REG-211 | PASS | Search in lower case 'agent testing' finds agent patients | found | found (41 records found) |
| REG-212 | PASS | Search with surrounding spaces '  Agent  ' still finds patients | found | found (42 records found) |
| REG-220 | ERROR | Changing the mobile of REG-001 to 9 digits blocks the update | blocked | runner error: REG-220 needs the registration id from REG-001, which did not create a patient. |