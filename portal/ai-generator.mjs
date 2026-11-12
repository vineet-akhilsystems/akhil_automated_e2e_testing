import './modules/registration/index.mjs';
import { adapters, validateCase, check, textValue } from './registry.mjs';
import { moduleCoverage } from './quality.mjs';
import { nextCaseIds } from './insights.mjs';
import { plugins, pluginFor } from './modules/index.mjs';

const SYNTH = Symbol('synthesized');

// Module-neutral presets: no domain wording, valid for any module (with or without an automation adapter).
const NEUTRAL_PRESETS = [
  {
    id: 'out-of-box', label: 'Out-of-the-box edge cases', focus: 'all',
    description: 'A broad mix of unusual but realistic edge cases that real users could trigger.',
    prompt: 'Think out of the box: generate high-impact UI, functional, cross-field contradiction, and workflow bypass edge cases that real users could trigger.',
  },
  {
    id: 'ui-state', label: 'UI state & dependent fields', focus: 'ui',
    description: 'Premature errors, tab or variant switching, parent-child resets and locked buttons.',
    prompt: 'Focus on UI state bugs: switching tabs or form variants without premature errors, dependent field resets when a parent value changes, derived values staying in sync, and dirty-state button locks.',
  },
  {
    id: 'validation-mandatory', label: 'Validation & mandatory fields', focus: 'functional',
    description: 'Empty, whitespace-only, boundary and contradictory values on required and dependent fields.',
    prompt: 'Focus on validation: mandatory and conditionally mandatory fields, whitespace-only values, length and format boundaries, and contradictory combinations of field values.',
  },
  {
    id: 'security-injection', label: 'Security, XSS & regex crashes', focus: 'security',
    description: 'HTML or script payloads, SQL-like characters, regex metacharacters and extreme lengths.',
    prompt: 'Focus on backend and frontend resilience: unescaped regex characters in search, HTML/script payloads in text fields, SQL-like characters, whitespace-only bypasses, and extreme input lengths.',
  },
  {
    id: 'update-persistence', label: 'Edit / update & data persistence', focus: 'update',
    description: 'Clearing required values on edit and checking saved values survive a reopen.',
    prompt: 'Focus on editing existing records and persistence: clearing mandatory fields during an update, changing dependent selections on saved records, and verifying optional fields stay saved when reopened.',
  },
  {
    id: 'coverage-gaps', label: 'Fill uncovered fields & variants', focus: 'coverage',
    description: 'Targets fields, variants and requirements the current cases do not assert yet.',
    prompt: 'Inspect current module coverage gaps and generate test cases that explicitly assert uncovered fields, under-tested form variants, and unverified business requirements.',
  },
];

// Served to the client as bootstrap `aiPresets`. Plugin entries carry `modules: [plugin.id]`; the client
// (and presetsFor) shows a module only its own entries when it has any, otherwise the neutral ones.
export const AI_PRESETS = [...NEUTRAL_PRESETS, ...plugins().flatMap(plugin => (plugin.ai?.presets ?? []).map(p => ({ ...p, modules: [plugin.id] })))];

export function presetsFor(module) {
  const own = AI_PRESETS.filter(p => p.modules?.includes(module?.id));
  return own.length ? own : AI_PRESETS.filter(p => !p.modules);
}

function buildDynamicBlueprints(module, adapter, existingCases, coverage, options) {
  const { prompt = '', focus = 'all', targetField = '', targetVariant = '', priority = '' } = options;
  const pLower = prompt.toLowerCase();
  const hasBaseValid = Boolean(module.config?.bases?.valid);
  const baseName = hasBaseValid ? 'valid' : Object.keys(module.config?.bases ?? {})[0] || undefined;
  const defaultVariant = targetVariant || adapter?.variants?.[0] || undefined;
  const ai = pluginFor(module.id)?.ai;
  const firstReq = module.config?.requirements?.[0]?.id ?? '';
  const reqFor = cat => (ai ? ai.requirementByCategory?.[cat] ?? firstReq : firstReq);

  // If the module has no automation adapter (or user requested manual mode), build rich manual edge cases
  if (!adapter || options.mode === 'manual') {
    // The free-text prompt is never a case subject (it would become a title); it only goes into the notes.
    const subject = targetField || module.name;
    const manualTemplates = [
      {
        category: 'ui',
        priority: priority || 'P1',
        title: `Verify ${subject} does not show premature validation errors before user interaction`,
        preconditions: `User is signed in and has opened ${module.name}.`,
        aiRationale: 'Catches premature blur/state evaluation bugs when switching tabs or opening the form.',
        steps: [
          { action: `Open ${module.name} and switch between available tabs or form types without typing into any field.`, expected: 'Form loads cleanly with no red required-field messages.' },
          { action: `Focus and tab through ${subject} without saving.`, expected: 'Inline guidance is clear and layout does not shift or clip.' },
        ],
      },
      {
        category: 'mandatory',
        priority: priority || 'P1',
        title: `Reject whitespace-only input in mandatory fields for ${subject}`,
        preconditions: `Open ${module.name} creation workflow.`,
        aiRationale: 'Operators often press Spacebar by mistake; untrimmed strings frequently bypass required checks.',
        steps: [
          { action: `Fill all required fields in ${module.name}, but enter only spaces ("     ") in the primary mandatory field (${subject}).`, expected: 'Input is treated as empty.' },
          { action: 'Click Save / Submit.', expected: 'Submission is blocked with a clear required-field validation message.' },
        ],
      },
      {
        category: 'security',
        priority: priority || 'P0',
        title: `Sanitize HTML/XSS script tags and regex metacharacters in ${subject}`,
        preconditions: `Open ${module.name} form and search bar.`,
        aiRationale: 'Prevents stored XSS in text inputs and unhandled HTTP 500 regex crashes in backend search endpoints.',
        steps: [
          { action: `Type "<script>alert(1)</script>" into ${subject} and attempt to save.`, expected: 'The payload is rejected or stripped; script never executes.' },
          { action: `Type unclosed regex characters "Test[a-" and "+9198765" into the ${module.name} search box.`, expected: 'Search returns 0 results or matching records cleanly without an HTTP 500 server error.' },
        ],
      },
      {
        category: 'update',
        priority: priority || 'P1',
        title: `Prevent clearing mandatory fields when editing an existing ${module.name} record`,
        preconditions: `At least one saved record exists in ${module.name}.`,
        aiRationale: 'Edit endpoints often skip creation-time mandatory checks, allowing users to wipe out critical fields.',
        steps: [
          { action: `Open an existing record in ${module.name} for editing.`, expected: 'Update button is disabled until a field is modified.' },
          { action: `Clear the mandatory ${subject} field and click Update.`, expected: 'Update is blocked and the original saved value remains intact.' },
        ],
      },
      {
        category: 'duplicate',
        priority: priority || 'P1',
        title: `Rapid double-click on Save in ${module.name} creates at most one record`,
        preconditions: `Open ${module.name} with valid mandatory data entered.`,
        aiRationale: 'Catches missing button-disable locks that create duplicate database rows on slow networks.',
        steps: [
          { action: `Fill valid data for ${subject} and rapidly double-click the Save button.`, expected: 'Save button locks immediately on the first click.' },
          { action: `Search ${module.name} for the newly created record.`, expected: 'Exactly one record was created with no duplicate IDs.' },
        ],
      },
      {
        category: 'functional',
        priority: priority || 'P1',
        title: `Cascade reset when changing parent dropdown in ${module.name} (${subject})`,
        preconditions: `Open ${module.name} form.`,
        aiRationale: 'Changing a parent selector after child values are auto-filled often leaves stale child values that corrupt the saved record.',
        steps: [
          { action: `Select a parent option in ${module.name} that populates dependent fields, then switch the parent option to a different value.`, expected: 'All dependent child dropdowns and derived fields reset immediately.' },
          { action: 'Attempt to save without re-selecting required dependent fields.', expected: 'Save is blocked until consistent child values are chosen.' },
        ],
      },
      {
        category: 'boundary',
        priority: priority || 'P2',
        title: `Boundary length and special punctuation handling in ${subject}`,
        preconditions: `Open ${module.name} form.`,
        aiRationale: 'Verifies that legitimate punctuation (hyphens, apostrophes) is preserved while 500+ character overflow is handled safely.',
        steps: [
          { action: `Enter a value with valid punctuation (e.g. "O'Connor-Smith") and a 500-character string into ${subject}.`, expected: 'Valid punctuation is preserved and maximum length is enforced without UI truncation errors.' },
        ],
      },
    ];
    return manualTemplates.map(t => ({
      ...t,
      mode: 'manual',
      enabled: true,
      requirement: firstReq,
      notes: `AI generated for prompt: "${prompt || t.title}". Rationale: ${t.aiRationale}`,
    }));
  }

  // Automated templates for plugin / adapter-connected modules
  // The curated pool comes from the module's plugin (plugin.ai.curatedPool); other modules
  // only receive blueprints synthesized from their own adapter below.
  const pool = ai?.curatedPool ? ai.curatedPool({ defaultVariant, baseName }) : [];

  // Generic adapter-driven synthesis (any module): whitespace bypass, boundary/special chars, select persistence,
  // clean-open check per variant, and search regex resilience.
  const can = (action, outcome) => Object.hasOwn(adapter.actions ?? {}, action) && (adapter.outcomes ?? []).includes(outcome);
  const INTERNAL_FIELDS = new Set(['search', 'id_proof_file', 'workflow', 'peer']);
  const usable = ([key, def]) => !INTERNAL_FIELDS.has(key) && def.supported !== false;
  const allFields = Object.entries(adapter.fields ?? {}).filter(usable);
  const textFields = allFields.filter(([, d]) => d.kind === 'text' || d.kind === 'textarea');
  const requiredText = textFields.filter(([, d]) => d.required);
  const bypassFields = (requiredText.length ? requiredText : textFields).slice(0, 3);
  const generic = [];
  if (can('save', 'blocked')) {
    for (const [key, def] of bypassFields) generic.push({
      category: 'mandatory', focusTag: 'functional', priority: priority || 'P1',
      title: `${def.label} containing only whitespace is treated as empty and blocks save`,
      registrationType: defaultVariant, action: 'save', base: baseName, input: { [key]: '     ' },
      expected: { outcome: 'blocked', assumed: true, note: `Whitespace-only ${def.label} must not satisfy a required-field check.` },
      aiRationale: `Mandatory bypass: untrimmed spaces in ${def.label} (${key}) often slip past required-field validation.`,
    });
  }
  if (can('save', 'blocked')) {
    for (const [key, def] of textFields.slice(0, 3)) generic.push({
      category: 'boundary', focusTag: 'security', priority: priority || 'P2',
      title: `${def.label} rejects or safely handles a 500-character value with special characters`,
      registrationType: defaultVariant, action: 'save', base: baseName,
      input: { [key]: `O'Connor-<b>&"${'x'.repeat(500)}` },
      expected: { outcome: 'blocked', assumed: true, note: `Over-long ${def.label} containing markup and quotes should be rejected or sanitized, never saved verbatim.` },
      aiRationale: `Boundary and special-character handling for ${def.label} (${key}): maximum length plus quote/markup characters.`,
    });
  }
  if (can('save', 'created')) {
    for (const [key, def] of allFields.filter(([, d]) => d.kind === 'select').slice(0, 3)) generic.push({
      category: 'ui', focusTag: 'ui', priority: priority || 'P1',
      title: `Selecting an option in ${def.label} is retained and persisted on save`,
      registrationType: defaultVariant, action: 'save', base: baseName, input: { [key]: '{{first}}' },
      expected: { outcome: 'created', persisted: { [key]: '*' }, note: `${def.label} selection must survive save and reload.` },
      aiRationale: `Dropdown persistence for ${def.label} (${key}): verifies selection state and backend storage.`,
    });
  }
  if (can('fill', 'no-errors')) {
    for (const variant of adapter.variants ?? []) generic.push({
      category: 'ui', focusTag: 'ui', priority: priority || 'P1',
      title: `Opening the ${variant} variant shows no premature validation errors`,
      registrationType: variant, action: 'fill', input: {},
      expected: { outcome: 'no-errors', note: `${variant} must open cleanly without marking untouched fields invalid.` },
      aiRationale: `UI state check: switching to ${variant} must not fire blur validation on untouched fields.`,
    });
  }
  if (Object.hasOwn(adapter.actions ?? {}, 'search') && Object.hasOwn(adapter.fields ?? {}, 'search') && can('search', 'no-error')) {
    for (const [text, prio] of [['Agent(test', 'P0'], ['Agent++', 'P1']]) generic.push({
      category: 'search', focusTag: 'security', priority: priority || prio,
      title: `Search with regex metacharacters '${text}' does not crash with HTTP 500`,
      action: 'search', input: { search: text },
      expected: { outcome: 'no-error', note: 'Unescaped regex metacharacters in search must not cause a server error.' },
      aiRationale: 'Backend crash vector: unescaped regex input in search endpoints throws SyntaxError / HTTP 500.',
    });
  }
  const curated = new Set(pool); // curated blueprints stay strict; everything added after this is synthesized
  pool.push(...generic);

  // Also dynamically synthesize field-specific edge cases if the user selected a specific targetField or mentioned a field in their prompt!
  const matchedFields = Object.entries(adapter.fields ?? {}).filter(([key, def]) => {
    if (INTERNAL_FIELDS.has(key) || def.supported === false) return false;
    if (targetField && key === targetField) return true;
    return pLower && (pLower.includes(key.replace(/_/g, ' ')) || pLower.includes(def.label.toLowerCase()));
  });

  for (const [key, def] of matchedFields) {
    if (def.kind === 'text' || def.kind === 'textarea') {
      pool.unshift({
        category: key.includes('phone') || key.includes('mobile') || key === 'whatsapp' ? 'phone' : 'mandatory',
        focusTag: 'custom',
        priority: priority || 'P1',
        title: `AI Edge Case: Special characters & whitespace boundary in ${def.label} (${targetVariant || defaultVariant || module.name || module.id})`,
        registrationType: defaultVariant,
        action: 'save',
        base: baseName,
        input: { [key]: '   <script>   ' },
        expected: {
          outcome: 'blocked',
          assumed: true,
          note: `Generated from prompt for ${def.label}: untrimmed whitespace and script tags in ${def.label} should be blocked.`,
        },
        aiRationale: `Targeted edge case for ${def.label} (${key}): tests input sanitization and save-time validation when invalid markup/spaces are entered.`,
      });
      const updateTarget = adapter.targetPlaceholder ?? (ai?.updateTarget ?? '');
      if (Object.hasOwn(adapter.actions ?? {}, 'update') && updateTarget) pool.unshift({
        category: 'update',
        focusTag: 'custom',
        priority: priority || 'P1',
        title: `AI Edge Case: Updating ${def.label} on an existing record persists the new value accurately`,
        action: 'update',
        target: updateTarget,
        input: { [key]: key.includes('mobile') || key === 'whatsapp' || key.includes('alternate') ? '{{phone2}}' : `AgentUpdated${def.label.replace(/[^A-Za-z]/g, '')}` },
        expected: {
          outcome: 'updated',
          persisted: { [key]: key.includes('mobile') || key === 'whatsapp' || key.includes('alternate') ? '{{phone2}}' : `AgentUpdated${def.label.replace(/[^A-Za-z]/g, '')}` },
          note: `Verifies that updating ${def.label} via the Edit workflow persists when the record is reopened.`,
        },
        aiRationale: `Targeted persistence check for ${def.label} (${key}): confirms the Edit/Update API does not silently ignore changes to ${def.label}.`,
      });
    } else if (def.kind === 'select') {
      pool.unshift({
        category: 'ui',
        focusTag: 'custom',
        priority: priority || 'P1',
        title: `AI Edge Case: Selecting first option in ${def.label} populates state and persists on Save`,
        registrationType: defaultVariant,
        action: 'save',
        base: baseName,
        input: { [key]: '{{first}}' },
        expected: {
          outcome: 'created',
          persisted: { [key]: '*' },
          note: `Verifies that selecting an option in ${def.label} is retained in the UI and persisted in the database.`,
        },
        aiRationale: `Targeted dropdown check for ${def.label} (${key}): verifies both React-Select state binding and backend persistence.`,
      });
    }
  }

  // Coverage-gap driven synthesis: if focus === 'coverage', prioritize any fields with low assertion counts
  if (focus === 'coverage' && coverage?.fields) {
    const lowChecked = [...coverage.fields]
      .filter(f => f.key !== 'id_proof_file' && f.key !== 'search' && adapter.fields[f.key])
      .sort((a, b) => a.checkedBy.length - b.checkedBy.length)
      .slice(0, 5);
    for (const f of lowChecked) {
      const def = adapter.fields[f.key];
      const sampleVal = def.kind === 'checkbox' ? true : def.kind === 'select' ? '{{first}}' : def.kind === 'date' ? '{{today}}' : 'AgentCoverageCheck';
      const expVal = def.kind === 'checkbox' ? 'true' : def.kind === 'select' ? '*' : sampleVal;
      pool.unshift({
        category: 'ui',
        focusTag: 'coverage',
        priority: priority || 'P1',
        title: `Coverage Gap Check: Verify field state and inline hints for ${def.label}`,
        registrationType: defaultVariant,
        action: 'fill',
        base: baseName,
        input: { [f.key]: sampleVal },
        expected: {
          outcome: 'field-state',
          values: { [f.key]: expVal },
          note: `Auto-generated to increase explicit assertion coverage on ${def.label} (${f.key}).`,
        },
        aiRationale: `Coverage Analyzer detected only ${f.checkedBy.length} explicit assertion(s) on "${def.label}" (${f.key}). This case adds a direct field-state assertion.`,
      });
    }
  }

  // Filter and rank by focus and user prompt keywords
  const existingTitles = new Set(existingCases.map(c => c.title.toLowerCase()));
  const filtered = pool.filter(item => !existingTitles.has(item.title.toLowerCase()));
  const scored = filtered.map((item, idx) => {
    let score = 100 - idx;
    if (focus && focus !== 'all' && (item.focusTag === focus || item.category === focus)) score += 200;
    if (item.focusTag === 'custom') score += 300;
    if (pLower) {
      const words = pLower.split(/\W+/).filter(w => w.length > 2);
      for (const w of words) {
        if (`${item.title} ${item.category} ${item.aiRationale} ${JSON.stringify(item.input)}`.toLowerCase().includes(w)) {
          score += 50;
        }
      }
    }
    return { item, score };
  }).sort((a, b) => b.score - a.score);

  return scored.map(({ item }) => {
    const { focusTag, aiRationale, ...rest } = item;
    const isSynth = !curated.has(item);
    if (priority && ['P0', 'P1', 'P2', 'P3'].includes(priority)) rest.priority = priority;
    if (targetVariant && adapter.variants?.includes(targetVariant) && rest.action !== 'search' && rest.action !== 'update') {
      rest.registrationType = targetVariant;
    }
    rest.mode = 'automated';
    rest.enabled = true;
    rest.requirement = reqFor(rest.category);
    rest.notes = [rest.expected?.note, `AI Rationale: ${aiRationale}`].filter(Boolean).join('\n');
    return { ...rest, aiRationale, ...(isSynth ? { [SYNTH]: true } : {}) };
  });
}

export async function generateAiCases({ module, existingCases, runs = [], options = {}, environment, environments }) {
  check(module && typeof module === 'object', 'Module is required.');
  const count = Math.min(Math.max(Number(options.count ?? 5) || 5, 1), 20);
  const prompt = textValue(options.prompt ?? '', 'AI prompt', 4000);
  const focus = textValue(options.focus ?? 'all', 'Focus area', 80);
  const targetField = textValue(options.targetField ?? '', 'Target field', 80);
  const targetVariant = textValue(options.targetVariant ?? '', 'Target variant', 120);
  const priority = textValue(options.priority ?? '', 'Priority override', 10);
  const mode = options.mode && ['automated', 'manual'].includes(options.mode) ? options.mode : (module.adapter ? 'automated' : 'manual');

  const adapter = adapters[module.adapter];
  // Coverage is environment-specific: use the caller's environment, else the first configured one, else the
  // environment of the latest run for this module.
  const environmentId = String(environment ?? options.environmentId ?? environments?.[0]?.id ?? runs.find(r => r.module?.id === module.id)?.environmentId ?? '');
  const coverage = moduleCoverage(module, existingCases, runs, environmentId);
  const candidates = buildDynamicBlueprints(module, adapter, existingCases, coverage, {
    prompt,
    focus,
    targetField,
    targetVariant,
    priority,
    mode,
  });

  // Numbering continues from the highest existing id for the module prefix (001 for an empty module).
  const ids = nextCaseIds(module, existingCases, count);
  const drafts = [];
  for (const candidate of candidates) {
    if (drafts.length >= count) break;
    const isSynth = candidate[SYNTH] === true;
    const raw = { ...candidate, id: ids[drafts.length] };
    delete raw[SYNTH];
    const aiRationale = raw.aiRationale;
    try {
      drafts.push({ ...validateCase(raw, module), aiRationale });
    } catch (error) {
      // Curated plugin blueprints must validate; any synthesized candidate an adapter cannot express is skipped.
      if (!isSynth || !(error?.status === 400)) throw error;
    }
  }

  return {
    moduleId: module.id,
    engine: 'Augastam Schema & Coverage AI Synthesizer',
    prompt: prompt || 'Out-of-the-box edge case generation',
    focus,
    count: drafts.length,
    coverageInsights: {
      totalCases: existingCases.length,
      fieldsWithoutChecks: coverage.counts.fieldsWithoutChecks,
      uncoveredRequirements: coverage.counts.uncoveredRequirements,
    },
    drafts,
  };
}
