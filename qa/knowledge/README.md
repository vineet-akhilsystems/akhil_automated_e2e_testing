# Tester knowledge pack

Plain markdown that Test Studio's AI agent reads before it analyses a module's files and drafts test cases (see "Senior-tester agent" in the main README). Edit these files like documents; the Tester knowledge tab on a module shows exactly what the agent will read.

| File | What it holds | Who edits |
|---|---|---|
| `mindset.md` | How an experienced tester thinks. Shared by every product. | Administrator |
| `domain/<product>.md` | Domain knowledge for one product. Chosen by the module's product id; falls back to `domain/default.md`. | Administrator |
| `modules/<module>.md` | Lessons for one module: defect patterns, confirmed rules, risks. | Module lead |

Current files and how far each can be trusted:

| File | Status |
|---|---|
| `mindset.md` | General practice. |
| `domain/augastam.md` | Draft. Mixes confirmed facts (rules, config, bug reports), things seen in BA videos, and general practice, each labelled. |
| `domain/miracle.md` | Draft. Almost nothing about Miracle billing is confirmed yet; money rules are general practice for a billing analyst to correct. |
| `modules/registration.md` | Confirmed: built from rules.md and 11 confirmed defect reports. |
| `modules/emr.md` | Seen on screen in BA videos only (no transcript); nothing confirmed. |

Rules for keeping it useful:
- Label every statement: Confirmed, Observed, Practice or Ask. The agent is told that only uploaded files confirm a rule; anything resting on these notes alone is tagged "tester experience" and its expectation is marked assumed.
- Each file is read up to a limit (mindset 6,000, domain 8,000, module 8,000 characters). Put the most important points first.
- When a real defect is found, add it to the module's lessons as a pattern to look for again.
- Replace a draft with confirmed facts as soon as the business analyst answers an "Ask" question.
