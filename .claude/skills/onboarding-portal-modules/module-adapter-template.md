# Module Adapter & Scaffolding Templates

Use these templates when scaffolding a new automated module `<module>` (e.g., `billing`, `appointments`, `facility-setup`) in `tests/modules/<module>/` and registering its adapter (as `qa/modules/<module>/adapter.json`, or as a plugin under `portal/modules/<module>/`).

## 1. Field Map Template (`tests/modules/<module>/fields.ts`)

```ts
export type FieldKind = 'text' | 'select' | 'date' | 'checkbox' | 'textarea' | 'radio';

export interface FieldDef {
  card: string;
  label: string;
  kind: FieldKind;
  column?: string;
}

export const FIELDS: Record<string, FieldDef> = {
  // Populated from qa/modules/<module>/discovery/fields-*.json
  // Example:
  // service_name: { card: 'Service Details', label: 'Service Name', kind: 'text', column: 'service_name' },
};

export const FILL_ORDER: string[] = [
  // Parent fields before dependent child cascades
];
```

## 2. Adapter Registration Template (the adapter object; place it in `qa/modules/<module>/adapter.json` as JSON, or in `portal/modules/<module>/adapter.mjs` for a plugin)

```js
export const adapters = {
  // ...existing adapters
  '<module>': {
    id: '<module>',
    name: '<Module Name> · Playwright',
    spec: 'tests/modules/<module>/cases.spec.ts',
    fields: {
      ...MODULE_FIELDS,
      workflow: { label: 'Workflow key', kind: 'text' },
      search: { label: 'Search text', kind: 'text' },
    },
    actions: {
      fill: 'Fill and inspect fields',
      save: 'Save record',
      search: 'Search records',
      update: 'Update record',
      workflow: 'Run a multi-step workflow',
      unavailable: 'Automation blocked — not implemented',
    },
    outcomes: [
      'created', 'blocked', 'field-state', 'observe', 'no-errors',
      'duplicate-warning', 'found', 'no-error', 'not-found',
      'updated', 'created-once', 'verified', 'automation-blocked',
    ],
    variants: ['Default'],
    variantLabel: 'Form variant',
    targetLabel: 'Record ID / previous-case reference',
    targetPlaceholder: '{{recordId@PREFIX-001}}',
  },
};
```

## 3. Result Attachment Contract (`<case-id>-result.json`)

Every case in `tests/modules/<module>/cases.spec.ts` must attach `<case-id>-result.json` via `info.attach(...)` with this structure so `portal/reporter.cjs` and `portal/pdf-report.mjs` can render expected-vs-actual diffs and stage screenshots:

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
