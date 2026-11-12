# Registration run 2026-10-29T09-47-24

Cases: 2 | PASS 0 | FAIL 1 | FAIL (assumed) 0 | OBSERVED 0 | ERROR 1 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-064 | FAIL | Choosing State, District and Area without a PIN fills the PIN (reverse lookup) | field-state; values {"pin_code":"*"} | values {"pin_code":"","state":"DELHI","district":"NEW DELHI","area":"F F C Okhla"} |
| REG-101 | ERROR | Search 'Vineet' finds the existing patient Vineet | found | runner error: page.waitForTimeout: Target page, context or browser has been closed |