# Module Adapter & Scaffolding Templates

Use these templates when scaffolding or reviewing an automated module `<module>` (`tests/<product>/<module>/` and `qa/<product>/<module>/adapter.json`, or a plugin under `portal/modules/<product>/<module>/`).

## 1. Field Map Template (`tests/<product>/<module>/fields.ts`)

```ts
export type FieldKind = 'text' | 'select' | 'date' | 'checkbox' | 'textarea' | 'radio';

export interface FieldDef {
  card: string;
  label: string;
  kind: FieldKind;
  column?: string;
}

export const FIELDS: Record<string, FieldDef> = {
  // Populated from qa/<product>/<module>/discovery/fields-*.json or video insights
  // service_name: { card: 'Service Details', label: 'Service Name', kind: 'text', column: 'service_name' },
};

export const FILL_ORDER: string[] = [
  // Parent fields before dependent child cascades
];
```

## 2. Adapter Manifest (`qa/<product>/<module>/adapter.json`)

```json
{
  "id": "<module>",
  "name": "<Module Name> · Playwright",
  "spec": "tests/<product>/<module>/cases.spec.ts",
  "fields": {
    "workflow": { "label": "Workflow key", "kind": "text" },
    "search": { "label": "Search text", "kind": "text" }
  },
  "actions": {
    "fill": "Fill and inspect fields",
    "save": "Save record",
    "search": "Search records",
    "update": "Update record",
    "workflow": "Run a multi-step workflow",
    "unavailable": "Automation blocked — not implemented"
  },
  "outcomes": [
    "created", "blocked", "field-state", "observe", "no-errors",
    "duplicate-warning", "found", "no-error", "not-found",
    "updated", "created-once", "verified", "automation-blocked"
  ],
  "variants": ["Default"],
  "variantLabel": "Form variant",
  "targetLabel": "Record ID / previous-case reference",
  "targetPlaceholder": "{{recordId@PREFIX-001}}"
}
```

## 3. Result Attachment Contract (`<case-id>-result.json`)

Every case in `tests/<product>/<module>/cases.spec.ts` attaches `<case-id>-result.json` via `info.attach(...)` so `portal/reporter.cjs` and `portal/pdf-report.mjs` render expected-vs-actual diffs and stage screenshots:

```json
{
  "id": "MOD-001",
  "title": "Valid record is created and persisted",
  "category": "happy",
  "priority": "P0",
  "status": "PASS",
  "expected": "outcome=created",
  "actual": "outcome=created (ID ...)",
  "mismatches": [],
  "toasts": ["Saved successfully"],
  "fieldErrors": {},
  "values": {},
  "resolvedInput": {},
  "durationMs": 4200
}
```

## 4. Truthful Runner Invariants & `scanCode` Rules

- **Dialog-first priority:** Resolve controls inside visible modals before active sections/document controls by looping selector arrays (`for (const sel of ['[role="dialog"]:not(.hidden) select', 'section.active select', 'select'])`), never `locator('A, B').first()`.
- **Fail closed on missing UI elements:**
  - Any explicit key in `c.input` whose control is not found on the page must push `"Field control \"<key>\" was not found on the page."` into `mismatches`.
  - Any `save` / `saveTwice` / `saveDoubleClick` / `update` case where no Save/Submit button can be found and clicked must fail in `mismatches`.
  - Any `workflow` case expecting `verified` must fail if `stepResult.performed === 0` or expected screen controls/hints could not be verified (`stepResult.verified === false`).
  - Any `created` or `updated` case with unexpected validation errors must fail in `mismatches`.
- **Checks enforced by `scanCode` (`qa/tools/install-module-adapter.mjs`):**
  - Forbidden tokens anywhere in generated `.ts` code (including strings): `\b(axios|got)\b` -> use `actual` or `found`.
  - Forbidden patterns: `.auth`, `.env`, `.portal`, `eval(`, `new Function`, `fs.writeFile`, `child_process`, and dynamic string concatenation inside `goto(...)` / `fetch(...)`.
