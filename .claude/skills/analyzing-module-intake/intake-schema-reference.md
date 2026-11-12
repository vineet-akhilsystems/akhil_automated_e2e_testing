# Intake & Insights JSON Schema Reference

Both `portal/agent.mjs` (`output/insights.json`) and `portal/mcp-server.mjs` (`save_insights`) validate against the structure enforced by `saveExternalInsights` in `portal/insights.mjs`.

## Required JSON Shape (`output/insights.json`)

```json
{
  "summary": "Plain-language overview of what the module does (3-8 sentences).",
  "fields": [
    {
      "name": "Mobile Number",
      "type": "text",
      "required": true,
      "description": "10-digit Indian mobile number starting with 6-9.",
      "source": "Registration_Test_Cases 1.xlsx"
    }
  ],
  "rules": [
    {
      "text": "Mobile number must be exactly 10 digits starting with 6, 7, 8, or 9.",
      "source": "Registration_Test_Cases 1.xlsx"
    }
  ],
  "flows": [
    {
      "name": "New Patient Registration and UHID Generation",
      "steps": [
        "Open Registration page and select New Registration.",
        "Fill mandatory demographic, contact, address, and payer fields.",
        "Click Save and verify UHID generation."
      ],
      "source": "Registration_Test_Cases 1.xlsx"
    }
  ],
  "edgeCases": [
    {
      "text": "Submitting whitespace-only strings in mandatory text fields.",
      "source": "Registration_Test_Cases 1.xlsx"
    }
  ],
  "openQuestions": [
    {
      "text": "Video file patient_registration.mp4 has no transcript; please provide a transcript or confirm if additional flows are shown.",
      "source": "patient_registration.mp4"
    }
  ],
  "cases": [
    {
      "title": "Reject registration when Mobile Number is fewer than 10 digits",
      "category": "Phone Validation",
      "priority": "P1",
      "preconditions": "User is logged in and on the New Registration screen.",
      "requirement": "REG-REQ-002",
      "source": "Registration_Test_Cases 1.xlsx",
      "steps": [
        {
          "action": "Fill all valid patient fields, enter '98765' in Mobile Number, and click Save.",
          "expected": "Save is blocked and an inline validation error states that a valid 10-digit mobile number is required."
        }
      ]
    }
  ]
}
```

## Field Limits Enforced by `portal/insights.mjs` and `portal/registry.mjs`

- `summary`: required non-empty string, up to `8000` characters.
- `fields[]`: up to `500` items; `name` required (`<= 200` chars), `type` (`<= 80` chars), `required` (`boolean`), `description` (`<= 1000` chars), `source` (`<= 300` chars).
- `rules[]`, `edgeCases[]`, `openQuestions[]`: up to `500` items; each `{ text, source }` with `text <= 2000` chars.
- `flows[]`: up to `500` items; `name` (`<= 200` chars), `steps[]` (`<= 500` chars each), `source` (`<= 300` chars).
- `cases[]`: `title` (`<= 200` chars), `category` (`<= 120` chars), `priority` (`P0`|`P1`|`P2`|`P3`), `preconditions` (`<= 1000` chars), `requirement` (`<= 200` chars), `steps[]` (`1..100` items, each with non-empty `action` and non-empty `expected` up to `500` chars).
