# Registration run 2026-10-29T07-34-27

Cases: 6 | PASS 3 | FAIL 3 | FAIL (assumed) 0 | OBSERVED 0 | ERROR 0 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-001 | FAIL | New Registration with only mandatory fields is created and persisted | created; toast contains "Registration Number"; saved {"first_name":"Agent","last_name":"UserNine","mobile":"9092245000","state":"DELHI"} | blocked; toast: Please fill the required field: Pin Code (Permanent Address) |
| REG-010 | FAIL | Saving an empty form is blocked and lists all required fields | blocked; toast contains "Please fill required field(s)" | blocked; toast: Please fill the required field: First Name |
| REG-020 | PASS | 9-digit mobile number shows an error and blocks save | blocked; errors {"mobile":"valid 10-digit"} | blocked; toast: Please fill the required field: Pin Code (Permanent Address); errors {"Mobile No":"Enter a valid 10-digit mobile number for India (e.g. 8123456789)"} |
| REG-033 | FAIL | Full name typed into First Name is split into middle and last name | field-state; values {"first_name":"Agent","middle_name":"Testing","last_name":"UserTwelve"} | values {"first_name":"Agent Testing UserTwelve","middle_name":"","last_name":""} |
| REG-060 | PASS | PIN 110001 fills State/District/City and asks to choose an Area | field-state; values {"country":"India","state":"DELHI","district":"NEW DELHI","city":"NEW DELHI"}; hints {"pin_code":"Several areas share"} | values {"country":"India","state":"DELHI","district":"NEW DELHI","city":"NEW DELHI","pin_code":"110001","hint:pin_code":"Several areas share this PIN code — select one"} |
| REG-070 | PASS | Default payer is Self-Paid with Payer and Sponsor = Cash | field-state; values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"} | values {"payer_type":"Self-Paid","payer":"Cash","sponsor":"Cash"} |