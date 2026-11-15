# Registration run 2026-10-29T07-38-21

Cases: 6 | PASS 6 | FAIL 0 | FAIL (assumed) 0 | OBSERVED 0 | ERROR 0 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | PASS | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserFifteen","mobile":"9301497000","state":"DELHI"} | created (UHID ASNR0000000403); toast: Registration Number: ASNR0000000403 |
| REG-003 | PASS | Female patient with title Mrs. is created with gender Female | created; saved {"gender":"Female","title":"Mrs."} | created (UHID ASNR0000000404); toast: Registration Number: ASNR0000000404 |
| REG-010 | PASS | Saving an empty form is blocked with a required-field message | blocked; toast contains "required field" | blocked; toast: Please fill the required field: First Name |
| REG-011 | PASS | Missing First Name blocks save | blocked; toast contains "First Name" | blocked; toast: Please fill the required field: First Name; errors {"First Name":"This field is required."} |
| REG-014 | PASS | Missing Mobile No blocks save | blocked; toast contains "Mobile" | blocked; toast: Please fill the required field: Mobile No; errors {"Mobile No":"This field is required."} |
| REG-069 | PASS | Filling only Current Address (Permanent tab untouched) blocks save on Permanent Pin Code | blocked; toast contains "Permanent Address" | blocked; toast: Please fill the required field: Pin Code (Permanent Address) |