import { api } from '../api.js';
import { $, $$, esc, icon, isApproved, opts } from './dom.js';
import { empty, field, selectField, textArea, toast } from './widgets.js';
import { fourEyes } from '../pages/review.js';
import { productName } from '../pages/workspace.js';
import { can, canProduct } from '../permissions.js';
import { adapterFor, currentModule, drafts, state } from '../state.js';

export function showDialog(title, description, content, formId, button = 'Save', narrow = false, footnote = '') {
  const dialog = $('#dialog');
  if (dialog.open) dialog.close(); dialog.className = narrow ? 'narrow' : '';
  dialog.innerHTML = `<form id="${formId}"><div class="dialog-head"><div><div class="eyebrow">${esc(state.data ? `${productName()} ` : '')}Test Studio</div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div><button type="button" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body"><div class="error-banner hidden" id="form-error" role="alert"></div>${content}</div><div class="dialog-foot"><small>${esc(footnote)}</small><div class="flex"><button type="button" data-action="close-dialog">Cancel</button><button type="submit" class="primary">${esc(button)}</button></div></div></form>`;
  dialog.showModal();
}
export const closeDialog = () => $('#dialog').close();
export function dialogError(error) { const node = $('#form-error'); if (node) { node.textContent = error.message; node.classList.remove('hidden'); node.scrollIntoView({ block: 'nearest' }); } else toast(error.message, true); }
export function nextId(module, cases = state.cases) {
  let n = 1;
  const ids = new Set(cases.map(c => c.id));
  for (const c of cases) { const m = new RegExp(`^${module.prefix}-(\\d+)$`).exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
  let candidate; do { candidate = `${module.prefix}-${String(n++).padStart(3, '0')}`; } while (ids.has(candidate)); return candidate;
}
export function showModuleDialog(module) {
  drafts.editorDraft = module;
  const adapterOptions = [['', 'None (Manual testing)'], ...state.data.adapters.map(a => [a.id, a.name])];
  showDialog(module ? 'Module settings' : 'Add a module', 'Group cases by the way your business works.', `<div class="form-grid">${field('Module name', 'name', module?.name, 'required maxlength="120" placeholder="e.g. Facility Setup"')}${field('Business area', 'area', module?.area ?? 'Setup', 'required list="business-areas" maxlength="80"')}<datalist id="business-areas">${['Setup', 'Patient Care', 'Operations', 'Finance', ...state.data.modules.map(m => m.area)].map(a => `<option value="${esc(a)}">`).join('')}</datalist>${!module ? field('Case ID prefix', 'prefix', '', 'required pattern="[A-Za-z][A-Za-z0-9]{1,11}" maxlength="12" placeholder="e.g. FAC"', 'Cases will use IDs such as FAC-001.') : ''}${selectField('Automation adapter', 'adapter', adapterOptions, module?.adapter ?? '')}${textArea('Description', 'description', module?.description, 'maxlength="1000"')}</div>${!module ? '<div class="warning">Start with manual test cases immediately, or connect an available Playwright automation adapter when its browser workflow is ready.</div>' : `<div class="info-strip">${icon('info')}<div><strong>${module.adapter ? 'Automation is connected' : 'Manual execution is available'}</strong><p>Case prefix: ${esc(module.prefix)}. Connect or switch registered automation adapters here as new module runners are added.</p></div></div>${state.access ? `<div class="form-section switch-row"><label class="switch-label" for="require-second"><input type="checkbox" role="switch" id="require-second" name="require-second" ${fourEyes(module) ? 'checked' : ''}><span><strong>Require a second person to approve cases</strong><small id="require-second-help">When on, nobody can approve or reject a case they created or last edited, including admins and leads. Turn it off only for a one-person team. Cases written by the agent or assistant count as created by the person who ran it.</small></span></label></div>` : ''}`}`, 'module-form', module ? 'Save changes' : 'Create module', true);
}
export function inputRow(adapter, key = '', value = '') {
  return `<div class="field-row" data-input-row><select data-input-key aria-label="Input field">${opts(Object.entries(adapter.fields).map(([k, v]) => [k, v.label]), key, 'Choose a field')}</select><input data-input-value aria-label="Input value" value="${esc(value)}" placeholder="Value (empty clears the field)"><button type="button" class="quiet" data-action="remove-row" aria-label="Remove input">×</button></div>`;
}
export function checkRow(adapter, type = 'values', key = '', value = '') {
  return `<div class="field-row check-row" data-check-row><select data-check-type aria-label="Assertion type">${opts([['values', 'Field value'], ['fieldErrors', 'Field error contains'], ['hints', 'Hint contains'], ['persisted', 'Saved value']], type)}</select><select data-check-key aria-label="Assertion field">${opts(Object.entries(adapter.fields).map(([k, v]) => [k, v.label]), key, 'Choose a field')}</select><input data-check-value aria-label="Expected value" value="${esc(value)}" placeholder="Expected value"><button type="button" class="quiet" data-action="remove-row" aria-label="Remove assertion">×</button></div>`;
}
export function stepRow(step = {}) { return `<div class="step-row" data-step-row><textarea data-step-action placeholder="Action: what should the tester do?" aria-label="Step action" required>${esc(step.action)}</textarea><textarea data-step-expected placeholder="Expected: what should happen?" aria-label="Step expected result" required>${esc(step.expected)}</textarea><button type="button" class="quiet" data-action="remove-row" aria-label="Remove step">×</button></div>`; }
export function showCaseDialog(c, duplicate = false, aiDraftIndex = null) {
  const m = currentModule(), a = adapterFor(m);
  const value = c ? structuredClone(c) : { id: nextId(m), mode: a ? 'automated' : 'manual', priority: 'P2', category: state.suite || 'General', input: {}, expected: { outcome: 'blocked' }, action: 'save', enabled: true, steps: [] };
  if (duplicate && value.action === 'unavailable') throw new Error('This source case has no executable workflow to duplicate. Add a new case with supported assertions instead.');
  if (duplicate) { delete value.sourceWorkbook; delete value.automationReadiness; delete value.automationBlocker; value.id = nextId(m); value.title = `${c.title} (copy)`; delete value.version; }
  drafts.editorDraft = { module: m, adapter: a, original: c && !duplicate && aiDraftIndex === null ? c : null, aiDraftIndex, value };
  const checks = ['values', 'fieldErrors', 'hints', 'persisted'].flatMap(kind => Object.entries(value.expected?.[kind] ?? {}).map(([key, val]) => checkRow(a, kind, key, val)));
  showDialog(c && !duplicate ? `Edit ${c.id}` : 'Create a test case', `Define the behavior you expect in ${m.name}.`, `<div class="form-grid">${field('Test case title', 'title', value.title, 'required maxlength="500" placeholder="e.g. Reject a mobile number with fewer than 10 digits"')}${field('Case ID', 'case-id', value.id, `required pattern="[A-Za-z0-9](?:[A-Za-z0-9_]|-)*" ${c && !duplicate ? 'readonly' : ''}`)}${field('Suite / feature', 'category', value.category, 'required maxlength="120" list="suite-options"')}<datalist id="suite-options">${[...new Set(state.cases.map(c => c.category))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>${selectField('Priority', 'case-priority', ['P0', 'P1', 'P2', 'P3'], value.priority)}${selectField('Execution type', 'case-mode', value.sourceWorkbook ? [['automated', 'Automatic execution']] : a ? [['automated', 'Automated browser test'], ['manual', 'Manual test steps']] : [['manual', 'Manual test steps']], value.mode, 'data-change="case-mode"')}${field('Requirement / ticket reference', 'requirement', value.requirement, 'maxlength="500" list="known-requirements" placeholder="Requirement ID(s), comma-separated"')}<datalist id="known-requirements">${(m.config?.requirements ?? []).map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</datalist>${textArea('Preconditions', 'preconditions', value.preconditions, 'maxlength="10000" placeholder="Anything the tester should know before starting"')}</div>
    ${value.sourceWorkbook ? `<div class="info-strip"><div><strong>${value.action === 'unavailable' ? 'Not automated: execution blocked' : 'Connected workbook workflow'}</strong><p>${esc(value.automationBlocker || 'The original procedure is connected to reviewed browser assertions. The execution contract is locked to prevent accidental reduction of coverage.')}</p>${value.executionAdaptation ? `<p><strong>Current-build adaptation:</strong> ${esc(value.executionAdaptation)}</p>` : ''}${value.steps.map(step => `<p>${esc(step.action)}<br>Expected: ${esc(step.expected)}</p>`).join('')}</div></div>` : ''}<div id="automated-fields" class="${value.mode === 'manual' ? 'hidden' : ''}">${a ? `<div class="form-grid ${a.variants?.length ? 'three' : ''}">${selectField('Action', 'case-action', Object.entries(a.actions), value.action)}${selectField('Starting data template', 'case-base', [['', 'No starting template'], ...Object.keys(m.config.bases).map(b => [b, b])], value.base ?? '')}${a.variants?.length ? selectField(a.variantLabel ?? 'Variant', 'case-variant', a.variants, value.registrationType ?? a.variants[0]) : ''}</div>${field(a.targetLabel ?? 'Target record (for updates)', 'case-target', value.target, `placeholder="${esc(a.targetPlaceholder ?? `{{id@${m.prefix || 'TC'}-001}}`)}" maxlength="200"`) }<div class="form-section"><div class="section-line"><h3>Test inputs</h3><button type="button" class="small" data-action="add-input">${icon('plus')} Add field</button></div><div id="input-rows">${Object.entries(value.input ?? {}).map(([k, v]) => inputRow(a, k, v)).join('')}</div><p class="form-help">Starting template fields are filled first. These values override them. Use <code>{{phone}}</code> for a unique mobile, <code>{{today}}</code> for today, or an empty value to clear a field.</p></div><div class="form-section"><div class="section-line"><h3>Expected result</h3><button type="button" class="small" data-action="add-check">${icon('plus')} Add field check</button></div><div class="form-grid">${selectField('Expected outcome', 'case-outcome', a.outcomes.map(o => [o, o === 'observe' ? 'Observe only (no pass/fail judgment)' : o]), value.expected?.outcome)}${field('Toast should contain', 'toast-contains', value.expected?.toastContains, 'placeholder="Optional message text"')}${selectField('Update button state before changes', 'save-disabled', [['', 'Do not check'], ['true', 'Disabled'], ['false', 'Enabled']], value.expected?.saveDisabled === undefined ? '' : String(value.expected.saveDisabled))}</div><div id="check-rows">${checks.join('')}</div><p class="form-help">Field values: <code>*</code> means any non-empty value, <code>~text</code> means contains, an empty value means empty. Error and hint checks always mean contains.</p><label class="checkbox-label"><input type="checkbox" name="assumed" ${value.expected?.assumed ? 'checked' : ''}> This expectation is an assumption and needs business-rule review</label>${textArea('Business rule / expectation note', 'expected-note', value.expected?.note, 'maxlength="10000"')}</div>` : ''}</div>
    <div id="manual-fields" class="${value.mode === 'automated' ? 'hidden' : ''}"><div class="section-line"><h3>Steps and expected results</h3><button type="button" class="small" data-action="add-step">${icon('plus')} Add step</button></div><div id="step-rows">${(value.steps?.length ? value.steps : [{}]).map(stepRow).join('')}</div></div><div class="form-section">${textArea('Notes', 'case-notes', value.notes, 'maxlength="10000"')}<p><label class="checkbox-label"><input type="checkbox" name="enabled" ${value.enabled !== false ? 'checked' : ''}> Enabled for new test runs</label></p></div>`, 'case-form', 'Save test case', false, 'Past runs keep their original case snapshot.');
  toggleCaseMode(value.mode);
}
export function toggleCaseMode(mode) {
  const automated = mode === 'automated', locked = Boolean(drafts.editorDraft?.value?.sourceWorkbook);
  $('#automated-fields').classList.toggle('hidden', !automated || locked); $('#manual-fields').classList.toggle('hidden', automated);
  $$('input,select,textarea', $('#automated-fields')).forEach(n => n.disabled = !automated || locked);
  $$('input,select,textarea', $('#manual-fields')).forEach(n => n.disabled = automated);
}
export function readInputs(form, adapter) {
  const input = {};
  for (const row of $$('[data-input-row]', form)) {
    const key = $('[data-input-key]', row).value, value = $('[data-input-value]', row).value;
    if (!key) throw new Error('Choose a field for each input row, or remove the empty row.');
    if (Object.hasOwn(input, key)) throw new Error(`The field ${key} appears more than once.`);
    input[key] = adapter.fields[key].kind === 'checkbox' && ['true', 'false'].includes(value) ? value === 'true' : value;
    if (adapter.fields[key].kind === 'checkbox' && typeof input[key] !== 'boolean') throw new Error(`Use true or false for ${adapter.fields[key].label}.`);
  }
  return input;
}
export function caseFromForm(form) {
  const f = new FormData(form), old = drafts.editorDraft.value;
  const value = { ...old, id: f.get('case-id'), title: f.get('title'), priority: f.get('case-priority'), category: f.get('category'), mode: f.get('case-mode'), notes: f.get('case-notes'), preconditions: f.get('preconditions'), requirement: f.get('requirement'), enabled: f.has('enabled') };
  if (value.sourceWorkbook) { value.mode = 'automated'; return value; }
  if (value.mode === 'manual') value.steps = $$('[data-step-row]', form).map(row => ({ action: $('[data-step-action]', row).value, expected: $('[data-step-expected]', row).value }));
  else {
    value.input = readInputs(form, drafts.editorDraft.adapter); value.action = f.get('case-action'); value.base = f.get('case-base'); value.target = f.get('case-target'); value.registrationType = f.get('case-variant');
    // Named workflows select their own variant and starting state.
    if (value.action === 'workflow') { delete value.base; delete value.registrationType; }
    value.expected = { outcome: f.get('case-outcome'), assumed: f.has('assumed'), note: f.get('expected-note') };
    if (f.get('toast-contains')) value.expected.toastContains = f.get('toast-contains');
    if (f.get('save-disabled')) value.expected.saveDisabled = f.get('save-disabled') === 'true';
    for (const row of $$('[data-check-row]', form)) {
      const type = $('[data-check-type]', row).value, key = $('[data-check-key]', row).value;
      if (!key) throw new Error('Choose a field for each expected-result check.');
      value.expected[type] ??= {};
      if (Object.hasOwn(value.expected[type], key)) throw new Error(`Duplicate ${type} check for ${key}.`);
      value.expected[type][key] = $('[data-check-value]', row).value;
    }
  }
  return value;
}

export async function showRunDialog(moduleId, ids, mode) {
  const runnable = state.data.modules.filter(x => can('run.start', x.id));
  const m = runnable.find(m => m.id === moduleId) ?? runnable[0];
  if (!m) { if (canProduct('module.create')) showModuleDialog(); else throw new Error('You do not have permission to start runs in any module.'); return; }
  const cases = await api(`/api/modules/${m.id}/cases`), enabled = cases.filter(c => c.enabled !== false && isApproved(c)), waiting = cases.filter(c => c.enabled !== false && !isApproved(c)).length;
  const selected = (ids?.length ? ids : enabled.filter(c => c.mode === (mode ?? (m.adapter ? 'automated' : 'manual'))).map(c => c.id)).filter(id => enabled.some(c => c.id === id));
  const chosen = enabled.filter(c => selected.includes(c.id));
  drafts.runDraft = { module: m, cases, selected: new Set(selected), mode: mode ?? chosen[0]?.mode ?? 'manual', search: '', waiting };
  showDialog('Create a test run', 'Choose a module, cases and target environment.', `<div class="form-grid">${field('Run name', 'run-name', `${m.name} · ${new Date().toLocaleDateString()}`, 'required maxlength="200"')}${selectField('Module', 'run-module', runnable.map(m => [m.id, `${m.area} / ${m.name}`]), m.id, 'data-change="run-module"')}${selectField('Environment', 'run-environment', state.data.environments.map(e => [e.id, `${e.name}${e.session !== 'saved' ? ' · login required for automation' : ''}`]), state.data.environments[0]?.id)}${selectField('Execution type', 'run-mode', m.adapter ? [['automated', 'Automated browser run'], ['manual', 'Manual execution']] : [['manual', 'Manual execution']], drafts.runDraft.mode, 'data-change="run-mode"')}</div>${waiting ? `<div class="warning review-warning">${waiting} case${waiting === 1 ? ' is' : 's are'} waiting for review and cannot be run until approved. <a href="#/modules/${m.id}/review" data-action="close-dialog">Open the review queue</a></div>` : ''}<div class="warning">Each run keeps a snapshot of the selected cases and shared data. Required prerequisite cases are included automatically. Cases marked Not automated report BLOCKED and execute no application assertions. They never request manual results. Automated runs can create or update test records when those actions are selected.</div><div class="form-section"><div class="section-line"><h3>Cases to include <span class="muted tiny" id="run-selection-count"></span></h3><div class="flex"><input aria-label="Filter cases in run dialog" placeholder="Filter by ID, title or suite…" data-run-search><button type="button" class="small" data-action="select-run-all">Select all of this type</button><button type="button" class="small quiet" data-action="clear-run-all">Clear</button></div></div><div id="run-case-list"></div></div>`, 'run-form', 'Create run', false, 'Automated runs execute one at a time · Ctrl+Shift+B');
  renderRunSelection();
}
export function renderRunSelection() {
  const q = (drafts.runDraft.search || '').toLowerCase();
  const eligible = drafts.runDraft.cases.filter(c => c.enabled !== false && isApproved(c) && c.mode === drafts.runDraft.mode);
  const visible = eligible.filter(c => !q || `${c.id} ${c.title} ${c.category ?? ''} ${c.requirement ?? ''}`.toLowerCase().includes(q));
  $('#run-case-list').innerHTML = visible.length ? `<div class="table-scroll"><table><thead><tr><th></th><th>Case</th><th>Suite</th><th>Action</th></tr></thead><tbody>${visible.map(c => `<tr><td><input type="checkbox" data-run-case="${c.id}" ${drafts.runDraft.selected.has(c.id) ? 'checked' : ''} aria-label="Include ${esc(c.id)}"></td><td><span class="case-id">${esc(c.id)}</span> ${esc(c.title)}</td><td class="tiny">${esc(c.category || 'General')}</td><td class="tiny">${esc(c.mode === 'manual' ? `${c.steps.length} steps` : adapterFor(drafts.runDraft.module)?.actions[c.action] ?? c.action)}</td></tr>`).join('')}</tbody></table></div>` : empty('No enabled cases of this type', 'Add a case or switch the execution type.');
  $('#run-selection-count').textContent = `· ${eligible.filter(c => drafts.runDraft.selected.has(c.id)).length} of ${eligible.length} selected`;
}
export function showTemplateDialog(moduleId, name) {
  const m = state.data.modules.find(m => m.id === moduleId), a = adapterFor(m);
  drafts.templateModule = m;
  showDialog(name ? `Edit ${name}` : 'New shared data template', 'These values provide the starting state for automated cases.', `${field('Template name', 'template-name', name, `required pattern="(?:[A-Za-z0-9_]|-)+" ${name ? 'readonly' : ''}`)}<div class="form-section"><div class="section-line"><h3>Starting field values</h3><button type="button" class="small" data-action="template-add-input">${icon('plus')} Add field</button></div><div id="input-rows">${Object.entries(m.config.bases[name] ?? {}).map(([k, v]) => inputRow(a, k, v)).join('')}</div><p class="form-help">Updating a template affects future runs. Existing runs keep the data they captured.</p></div>`, 'template-form');
}
export function showReportDetails() {
  const d = state.runDetail.reportDetails ?? {};
  showDialog('Prepare the final report', 'Add report context without changing the execution evidence.', `<div class="form-grid">${field('Report title', 'report-title', d.title, 'maxlength="500"')}${field('Prepared by', 'prepared-by', d.preparedBy, 'maxlength="500"')}${field('Release / version', 'release', d.release, 'maxlength="500"')}${field('Build identifier', 'build', d.build, 'maxlength="500"')}${textArea('Executive notes', 'report-notes', d.notes, 'maxlength="10000"')}</div>`, 'report-details-form');
}
export function showTriage(caseId) {
  const t = state.runDetail.triage?.[caseId] ?? {};
  drafts.editorDraft = { caseId };
  showDialog(`Triage ${caseId}`, 'Triage adds context; the recorded test outcome stays unchanged.', `<div class="form-grid">${selectField('Reported severity', 'severity', state.runDetail.results.find(r => r.id === caseId)?.status === 'FAIL' ? ['Not assessed', 'Critical', 'High', 'Medium', 'Low'] : ['Not assessed'], t.severity ?? 'Not assessed')}${field('Owner', 'issue-owner', t.owner, 'maxlength="500"')}${field('Ticket / external reference', 'issue-reference', t.reference, 'maxlength="500"')}${textArea('Observed business impact', 'issue-impact', t.impact, 'maxlength="10000"')}${textArea('Triage notes', 'triage-notes', t.notes, 'maxlength="10000"')}</div><p class="form-help">Severity is separate from test priority. Assumptions, execution errors and blocked tests are classified separately in the PDF.</p>`, 'triage-form');
}
export function showRequirementDialog(req) {
  drafts.editorDraft = req ?? null;
  showDialog(req ? `Edit ${req.id}` : 'Add a business requirement', 'Define an agreed behavior, then link its ID from your test cases.', `<div class="form-grid">${field('Requirement ID', 'requirement-id', req?.id ?? '', `required maxlength="120" placeholder="e.g. FAC-REQ-001" ${req ? 'readonly' : ''}`)}${field('Requirement description', 'requirement-title', req?.title ?? '', 'required maxlength="500"')}</div>`, 'requirement-form', req ? 'Save requirement' : 'Add requirement', true);
}
export async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
