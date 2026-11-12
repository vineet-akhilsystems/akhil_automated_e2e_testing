# Registration run 2026-11-04T15-43-55

Cases: 3 | PASS 1 | FAIL 1 | FAIL (assumed) 0 | OBSERVED 0 | ERROR 1 | SKIPPED 0

| ID | Status | Test case | Expected | Actual |
|---|---|---|---|---|
| REG-FLOW-PIN-CLEAR | FAIL | Clearing a populated PIN clears State, District and City | verified | Workflow assertion failed: Clearing PIN clears state

Clearing PIN clears state

expect(received).toBe(expected) // Object.is equality

Expected: ""
Received: "DELHI"

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate |
| REG-FLOW-INSURANCE-PAYER-RESET | PASS | Insurance to Self-Paid resets payer and sponsor to locked Cash defaults | verified | Verified registration workflow: insurance-payer-reset |
| REG-FLOW-NEW-RESET-ADDRESS | ERROR | New clears unsaved current and permanent address data and stale validation | verified | runner error: locator.click: Timeout 20000ms exceeded. |