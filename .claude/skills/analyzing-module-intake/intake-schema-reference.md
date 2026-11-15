# Intake & Insights JSON Schema Reference

Both `portal/agent.mjs` (`<job>/output/insights.json`) and `portal/mcp-server.mjs` (`save_insights`) validate against `saveExternalInsights` in `portal/insights.mjs`.

## Required JSON Shape (`output/insights.json`)

```json
{
  "summary": "Plain-language overview of what the module does (3-8 sentences).",
  "risks": [
    {
      "risk": "What could fail in production and who/what is harmed.",
      "impact": "high",
      "likelihood": "medium",
      "coverage": "Which case titles cover it, or why it is not covered.",
      "source": "walkthrough.mp4 @ 01:15"
    }
  ],
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
      "text": "Video walkthrough had keyframes only (no audio transcript); confirm expected duplicate handling.",
      "source": "walkthrough.mp4 @ 02:10"
    }
  ],
  "suggestedSetup": {
    "moduleUrl": "/emr",
    "variants": ["Default", "Doctor"]
  },
  "cases": [
    {
      "title": "Reject registration when Mobile Number is fewer than 10 digits",
      "category": "Phone Validation",
      "priority": "P1",
      "mode": "manual",
      "risk": "Invalid phone numbers accepted into patient records",
      "basis": "source",
      "preconditions": "User is logged in and on the New Registration screen.",
      "requirement": "REG-REQ-002",
      "source": "Registration_Test_Cases 1.xlsx",
      "node": "optional-tree-node-id",
      "steps": [
        {
          "action": "Open New Registration tab, fill valid patient fields, enter '98765' in 'Mobile Number', and click 'Save'.",
          "expected": "Save is blocked and an inline validation error states a valid 10-digit mobile number is required."
        }
      ]
    }
  ]
}
```

## Field Limits Enforced by `portal/insights.mjs` and `portal/registry.mjs`

- `summary`: required non-empty string, up to `8000` characters.
- `risks[]`: up to `30` items (`cleanRisks` in `portal/insights.mjs`); `{ risk (<= 500), impact ('high'|'medium'|'low'), likelihood ('high'|'medium'|'low'), coverage (<= 500), source (<= 300) }`.
- `fields[]`: up to `500` items; `name` required (`<= 200` chars), `type` (`<= 80` chars), `required` (`boolean`), `description` (`<= 1000` chars), `source` (`<= 300` chars).
- `rules[]`, `edgeCases[]`, `openQuestions[]`: up to `500` items; each `{ text, source }` with `text <= 2000` chars.
- `flows[]`: up to `500` items; `name` (`<= 200` chars), `steps[]` (`<= 500` chars each), `source` (`<= 300` chars).
- `suggestedSetup`: optional `{ moduleUrl, variants[] }`; never applied automatically until a lead confirms it.
- `cases[]`:
  - `title` (`<= 200` chars), `category` (`<= 120` chars), `priority` (`P0`|`P1`|`P2`|`P3`), `preconditions` (`<= 1000` chars), `requirement` (`<= 200` chars).
  - `mode`: `'manual'` or `'automated'` (when `input/adapter-schema.json` is present and valid `action`/`input`/`expected` match it; update targets in AI-authored cases must use `{{field@CASE-ID}}`, never literal IDs). Modules with a synthesized dynamic adapter (`portal/automate.mjs`) also auto-convert manual specs via `convertCaseToAutomated`.
  - `risk`: short risk statement; `basis`: `'source'` (confirmed in uploaded material) or `'experience'` (tester experience -> sets `assumed: true` on automated expectations).
  - `node`: optional tree node id (portal sandbox agent only; ignored by MCP `save_insights`), saved as `suggestedNode` only if valid in `qa/<product>/<module>/tree.json`.
  - `steps[]`: `1..100` items; `foldSteps` in `portal/insights.mjs` folds bare action-only entries before validating non-empty `action` and `expected` (`<= 500` chars).
