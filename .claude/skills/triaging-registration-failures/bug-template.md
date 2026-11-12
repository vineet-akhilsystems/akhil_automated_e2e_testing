# Bug Report: <CASE-ID(s)> — <What happens, stated as the defect, e.g. "Future DOB 01/01/2030 is accepted and saved">

- **Case IDs:** `REG-xxx`[, `REG-yyy`]
- **Requirement:** `REG-REQ-0xx` — <requirement title>
- **Module:** Patient Registration — <area> (`<FE/BE file if known>`)
- **Severity (proposed):** Critical | High | Medium | Low — <one-line reason: patient safety / data integrity / workflow blocked / cosmetic>
- **Priority (proposed):** P0–P3
- **Environment:** `https://demo.augastam.com/registration` (Build `<version shown top-right>`, Tenant `Miracle HIS Demo`, Facility `Akhil Demo2 Delhi`, role Admin)
- **Reproduced:** <n>/<n> runs (<run ids or dates>)
- **Status:** Draft — needs review

---

## 1. Summary
<Two or three sentences: the input, what the product did, why that is wrong.>

## 2. Steps to reproduce
1. Open `/registration` (New Registration).
2. Fill the valid synthetic patient: Title `Mr.`, First `Agent`, Middle `Testing`, Last `User<Words>`, Gender `Male`, DOB `15/08/1990`, Mobile `<unique>`, PIN `110001`, first Area, Address, tick "Mark current address as permanent".
3. <The one step that differs, with the exact value.>
4. Click **Save**.

## 3. Expected vs actual
| | |
|---|---|
| **Expected** | <behavior> — source: `rules.md` <section> / config `<file>` field `<x>` / requirement `REG-REQ-0xx` / BA `TC_REG_0xx` |
| **Actual** | <behavior, exact toast text, field error text> |
| **Server response** | `POST .../autogenerate` -> HTTP <code>, body `<UHID or {statusCode,...}>` |
| **Created records** | `<UHID>` (synthetic Agent Testing record) or none |

## 4. Evidence
- Screenshot: `<path>`
- Trace: `<path to trace.zip>` (`npx playwright show-trace <path>`)
- Result row: `<results file>` -> `<case id>`

## 5. Suspected cause (hypothesis, not verified)
<File:line from rules.md or EMR source, and the reasoning. Or: "Not investigated.">

## 6. Suggested fix (optional)
<Only if the cause is understood.>
