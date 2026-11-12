import { api } from '../api.js';
import { caseFromForm, checkRow, closeDialog, dialogError, fileBase64, inputRow, readInputs, renderRunSelection, showCaseDialog, showDialog, showModuleDialog, showReportDetails, showRequirementDialog, showRunDialog, showTemplateDialog, showTriage, stepRow, toggleCaseMode } from '../components/dialogs.js';
import { $, $$, esc, isApproved } from '../components/dom.js';
import { toast } from '../components/widgets.js';
import { CASE_PAGE_SIZE, visibleCases } from '../pages/cases.js';
import { loginScreen } from '../pages/login.js';
import { presetsFor } from '../pages/modules.js';
import { noteReadiness } from '../pages/pipeline.js';
import { isFindingResult } from '../pages/runs.js';
import { showEnvironmentDialog } from '../pages/settings.js';
import { enterWorkspace, loadProducts, selectProduct, showPicker, showProductDialog } from '../pages/workspace.js';
import { can, loadAccess } from '../permissions.js';
import { reload, renderPage, renderRoute } from '../router.js';
import { adapterFor, currentModule, drafts, state } from '../state.js';

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, id, value, name } = button.dataset;
  try {
    if (action === 'close-dialog') closeDialog();
    if (action === 'new-requirement') showRequirementDialog();
    if (action === 'edit-requirement') showRequirementDialog((currentModule()?.config?.requirements ?? []).find(r => r.id === id));
    if (action === 'delete-requirement') {
      const m = currentModule();
      await api(`/api/modules/${m.id}/requirements`, 'PUT', { version: m.version, requirements: (m.config.requirements ?? []).filter(r => r.id !== id) });
      await reload(); toast(`Requirement ${id} removed.`);
    }
    if (action === 'report-details') showReportDetails();
    if (action === 'triage') { event.preventDefault(); showTriage(id); }
    if (action === 'download-report') {
      button.disabled = true; const label = button.innerHTML; button.textContent = 'Preparing PDF…';
      try {
        const response = await fetch(`/api/runs/${id}/export?format=pdf`);
        if (!response.ok) { const e = await response.json(); throw new Error(e.error); }
        if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The server update is pending. Refresh after the active run finishes.');
        const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
        link.href = url; link.download = `${state.runDetail.module.id}-bug-report-${id.slice(0, 8)}.pdf`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast('PDF bug report downloaded.');
      } finally { button.disabled = false; button.innerHTML = label; }
    }
    if (action === 'open-product') await selectProduct(id);
    if (action === 'switch-product') showPicker();
    if (action === 'new-product') showProductDialog();
    if (action === 'new-module') showModuleDialog();
    if (action === 'edit-module') showModuleDialog(state.data.modules.find(m => m.id === id));
    if (action === 'area') { state.area = value; renderPage(); }
    if (action === 'set-page-size') {
      state.casePageSize = Number(value);
      state.caseLimit = state.casePageSize;
      renderPage();
    }
    if (action === 'load-more-cases') {
      const ps = state.casePageSize || CASE_PAGE_SIZE;
      const firstNew = state.caseLimit ?? ps;
      state.caseLimit = firstNew + ps;
      renderPage();
      // Keep keyboard users in place: focus the first newly shown case.
      $$('.case-title')[firstNew]?.focus();
    }
    if (action === 'suite') { state.suite = value; renderPage(); }
    if (action === 'run-status') { state.runStatus = value; renderPage(); }
    if (action === 'run-case-filter') { state.runCaseFilter = value; renderPage(); }
    if (action === 'new-case') showCaseDialog();
    if (action === 'open-ai-studio') location.hash = `/modules/${currentModule().id}/ai`;
    if (action === 'ai-preset') {
      const preset = presetsFor(currentModule()).find(p => p.id === id);
      if (preset) {
        state.aiOptions.presetId = preset.id;
        state.aiOptions.prompt = preset.prompt;
        state.aiOptions.focus = preset.focus;
        renderPage();
      }
    }
    if (action === 'ai-select-all') { state.aiDrafts.forEach((_, idx) => state.aiSelected.add(idx)); renderPage(); }
    if (action === 'ai-clear-all') { state.aiSelected.clear(); renderPage(); }
    if (action === 'ai-edit-draft') {
      const idx = Number(button.dataset.index);
      showCaseDialog(state.aiDrafts[idx], false, idx);
    }
    if (action === 'ai-remove-draft') {
      const idx = Number(button.dataset.index);
      state.aiDrafts.splice(idx, 1);
      state.aiSelected = new Set(state.aiDrafts.map((_, i) => i));
      renderPage();
    }
    if (action === 'ai-accept-save' || action === 'ai-accept-run') {
      const m = currentModule();
      const chosen = state.aiDrafts.filter((_, idx) => state.aiSelected.has(idx));
      if (!chosen.length) throw new Error('Select at least one AI-generated draft case to accept.');
      await api(`/api/modules/${m.id}/import`, 'POST', { format: 'json', data: chosen, upsert: true });
      const acceptedIds = chosen.map(c => c.id);
      const runMode = chosen[0].mode;
      state.aiDrafts = state.aiDrafts.filter((_, idx) => !state.aiSelected.has(idx));
      state.aiSelected = new Set(state.aiDrafts.map((_, i) => i));
      await reload();
      toast(`${acceptedIds.length} AI-generated case(s) accepted and saved to ${m.name}.`);
      if (action === 'ai-accept-run') {
        location.hash = `/modules/${m.id}`;
        await showRunDialog(m.id, acceptedIds, runMode);
      } else if (!state.aiDrafts.length) {
        location.hash = `/modules/${m.id}`;
      }
    }
    if (action === 'quick-select') {
      state.selected.clear();
      const targetMode = currentModule()?.adapter ? 'automated' : 'manual';
      visibleCases().filter(c => c.enabled !== false && isApproved(c) && c.mode === targetMode).forEach(c => {
        const hay = `${c.category ?? ''} ${c.title} ${c.notes ?? ''}`.toLowerCase();
        if (value === 'critical' && ['P0', 'P1'].includes(c.priority)) state.selected.add(c.id);
        if (value === 'ui' && /(ui|cascade|reset|layout|sticky|focus|mask|dropdown|visibility|state)/.test(hay)) state.selected.add(c.id);
        if (value === 'security' && /(security|xss|sql|crash|breakage|regex|injection|payload|overflow)/.test(hay)) state.selected.add(c.id);
        if (value === 'review' && c.expected?.assumed) state.selected.add(c.id);
      });
      renderPage();
      toast(`${state.selected.size} matching case(s) selected.`);
    }
    if (action === 'edit-case' || action === 'duplicate-case') showCaseDialog(state.cases.find(c => c.id === id), action === 'duplicate-case');
    if (action === 'delete-case') {
      await api(`/api/modules/${currentModule().id}/cases/${id}`, 'DELETE');
      state.selected.delete(id);
      await reload(); toast(`${id} deleted.`);
    }
    if (['bulk-enable', 'bulk-disable', 'bulk-delete'].includes(action)) {
      const bulkAction = action.replace('bulk-', '');
      const ids = [...state.selected];
      await api(`/api/modules/${currentModule().id}/cases/bulk`, 'POST', { action: bulkAction, caseIds: ids });
      if (bulkAction === 'delete') state.selected.clear();
      await reload(); toast(`${ids.length} case(s) ${bulkAction}d.`);
    }
    if (action === 'add-input') $('#input-rows').insertAdjacentHTML('beforeend', inputRow(drafts.editorDraft.adapter));
    if (action === 'template-add-input') $('#input-rows').insertAdjacentHTML('beforeend', inputRow(adapterFor(drafts.templateModule)));
    if (action === 'add-check') $('#check-rows').insertAdjacentHTML('beforeend', checkRow(drafts.editorDraft.adapter));
    if (action === 'add-step') $('#step-rows').insertAdjacentHTML('beforeend', stepRow());
    if (action === 'remove-row') button.parentElement.remove();
    if (action === 'clear-selection') { state.selected.clear(); renderPage(); }
    if (action === 'run-selected') {
      const picked = state.cases.filter(c => state.selected.has(c.id) && c.enabled !== false), selected = picked.filter(isApproved);
      if (picked.length > selected.length) toast(`${picked.length - selected.length} selected case(s) are not approved yet and were left out. Approve them in the Review queue first.`, true);
      if (!selected.length) throw new Error('Select at least one enabled, approved case before starting a run.');
      if (new Set(selected.map(c => c.mode)).size > 1) throw new Error('Select one execution type per run. Filter cases to Manual or Automated first.');
      await showRunDialog(currentModule().id, selected.map(c => c.id));
    }
    if (action === 'run-module') await showRunDialog(currentModule().id);
    if (action === 'new-run') await showRunDialog();
    if (action === 'select-run-all') {
      const q = (drafts.runDraft.search || '').toLowerCase();
      drafts.runDraft.cases.filter(c => c.mode === drafts.runDraft.mode && c.enabled !== false && isApproved(c) && (!q || `${c.id} ${c.title} ${c.category ?? ''} ${c.requirement ?? ''}`.toLowerCase().includes(q))).forEach(c => drafts.runDraft.selected.add(c.id));
      renderRunSelection();
    }
    if (action === 'clear-run-all') { drafts.runDraft.selected.clear(); renderRunSelection(); }
    if (action === 'open-run') location.hash = `/runs/${id}`;
    if (action === 'cancel-run') { await api(`/api/runs/${id}/cancel`, 'POST', {}); await reload(); toast('Cancellation requested.'); }
    if (action === 'complete-run') { await api(`/api/runs/${id}/complete`, 'POST', {}); await reload(); toast('Run closed. Results are preserved.'); }
    if (action === 'rerun' || action === 'rerun-failed') {
      const r = state.runDetail, current = await api(`/api/modules/${r.module.id}/cases`);
      const sourceIds = action === 'rerun-failed' ? r.results.filter(isFindingResult).map(x => x.id) : r.cases.map(c => c.id);
      const eligible = sourceIds.filter(cid => current.some(x => x.id === cid && x.enabled !== false && isApproved(x)));
      if (!eligible.length) throw new Error('None of the requested cases are currently enabled and approved.');
      await showRunDialog(r.module.id, eligible, r.mode);
    }
    if (action === 'show-log') {
      const response = await fetch(`/api/runs/${id}/files/runner.log`); if (!response.ok) throw new Error('Runner log is not available yet.');
      const log = await response.text(); $('#runner-log').innerHTML = `<pre class="log-view">${esc(log.slice(-60000))}</pre>`;
    }
    if (action === 'new-template' || action === 'edit-template') showTemplateDialog(id, name);
    if (action === 'delete-template') {
      await api(`/api/modules/${id}/templates/${encodeURIComponent(name)}`, 'DELETE');
      await reload(); toast(`Template "${name}" deleted.`);
    }
    if (action === 'new-environment') showEnvironmentDialog();
    if (action === 'edit-environment') showEnvironmentDialog(state.data.environments.find(e => e.id === id));
    if (action === 'refresh-auth') { const r = await api(`/api/environments/${id}/auth`, 'POST', {}); location.hash = `/runs/${r.id}`; await reload(); toast('Application login queued.'); }
    if (action === 'export-cases') showDialog('Export test cases', 'JSON preserves every case field. Excel provides an editable team spreadsheet.', `<p><a href="/api/modules/${currentModule().id}/export?format=xlsx">Download Excel workbook ↗</a></p><p><a href="/api/modules/${currentModule().id}/export">Download full JSON dataset ↗</a></p>`, 'export-form', 'Done', true);
    if (action === 'import-cases') showDialog('Import test cases', 'Use a portal export as your template. Existing case IDs are protected unless you choose to update them.', '<label class="form-field">JSON or Excel file<input type="file" name="file" accept=".json,.xlsx" required></label><p><label class="checkbox-label"><input type="checkbox" name="upsert"> Update existing cases when Case ID matches</label></p><p class="form-help">The complete import is validated before anything is saved.</p>', 'import-form', 'Import cases', true);
    if (action === 'logout') { await api('/api/logout', 'POST', {}); const s = await api('/api/session'); if (s.authRequired || !s.authenticated) loginScreen(); else toast('This local workspace does not require a login.'); }
  } catch (error) { toast(error.message, true); }
});

document.addEventListener('change', async event => {
  const el = event.target;
  try {
    if (el.matches('[data-select-case]')) { if (el.checked) state.selected.add(el.dataset.selectCase); else state.selected.delete(el.dataset.selectCase); renderPage(); }
    if (el.matches('[data-ai-select]')) { const idx = Number(el.dataset.aiSelect); if (el.checked) state.aiSelected.add(idx); else state.aiSelected.delete(idx); renderPage(); }
    if (el.matches('[data-select-all]')) { visibleCases().filter(c => c.enabled !== false).forEach(c => el.checked ? state.selected.add(c.id) : state.selected.delete(c.id)); renderPage(); }
    if (el.matches('[data-run-case]')) { if (el.checked) drafts.runDraft.selected.add(el.dataset.runCase); else drafts.runDraft.selected.delete(el.dataset.runCase); $('#run-selection-count').textContent = `· ${drafts.runDraft.cases.filter(c => c.mode === drafts.runDraft.mode && drafts.runDraft.selected.has(c.id)).length} selected`; }
    if (el.dataset.change === 'coverage-environment') { state.coverageEnvironment = el.value; await renderRoute(); }
    if (el.dataset.change === 'case-mode') toggleCaseMode(el.value);
    if (el.dataset.change === 'shared-module') location.hash = `/shared/${el.value}`;
    if (el.dataset.change === 'run-module') await showRunDialog(el.value);
    if (el.dataset.change === 'run-mode') { drafts.runDraft.mode = el.value; drafts.runDraft.selected.clear(); renderRunSelection(); }
    if (el.matches('[data-filter]') && el.tagName === 'SELECT') { state[el.dataset.filter] = el.value; renderPage(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.matches('input[data-run-search]')) {
    drafts.runDraft.search = el.value;
    renderRunSelection();
    return;
  }
  if (el.matches('input[data-filter]')) {
    const start = el.selectionStart, end = el.selectionEnd, key = el.dataset.filter;
    state[key] = el.value; renderPage();
    const next = $(`[data-filter="${key}"]`); next.focus(); next.setSelectionRange(start, end);
  }
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, button = $('button[type=submit]', form);
  if (button) button.disabled = true;
  try {
    const f = new FormData(form);
    if (form.id === 'login-form' || form.id === 'token-form') {
      try {
        const res = await api('/api/login', 'POST', form.id === 'token-form' ? { token: f.get('token') } : { username: f.get('username').trim(), password: f.get('password') });
        state.user = res.user ?? null; await enterWorkspace(true);
      } catch (error) { $('#login-error').textContent = error.status === 401 ? 'That username or password is not correct.' : error.message; }
      return;
    }

    if (form.id === 'product-form') {
      await api('/api/products', 'POST', { name: f.get('product-name').trim(), description: f.get('product-description').trim() });
      closeDialog(); await loadProducts(); showPicker(); toast('Product added.');
    } else
    if (form.id === 'environment-form') {
      await api('/api/environments', 'POST', {
        id: f.get('profile-id'), name: f.get('profile-name'), url: f.get('website-url'), productId: state.productId, version: Number(f.get('profile-version')),
        credentials: Object.fromEntries(['username', 'password', 'tenant', 'facility', 'role'].map(k => [k, f.get('login-' + k)]))
      });
      closeDialog(); await reload(); toast('Profile saved. Refresh application login before running tests.');
    } else
    if (form.id === 'requirement-form') {
      const m = currentModule(), reqId = f.get('requirement-id'), reqTitle = f.get('requirement-title');
      const existingReqs = m.config.requirements ?? [];
      const requirements = drafts.editorDraft ? existingReqs.map(r => r.id === drafts.editorDraft.id ? { id: reqId, title: reqTitle } : r) : [...existingReqs, { id: reqId, title: reqTitle }];
      await api(`/api/modules/${m.id}/requirements`, 'PUT', { version: m.version, requirements });
      closeDialog(); await reload(); toast(drafts.editorDraft ? 'Requirement updated.' : 'Requirement added. Link its ID in the relevant test cases.');
    }
    if (form.id === 'report-details-form') {
      await api(`/api/runs/${state.runDetail.id}/report`, 'PUT', { title: f.get('report-title'), preparedBy: f.get('prepared-by'), release: f.get('release'), build: f.get('build'), notes: f.get('report-notes') });
      closeDialog(); await reload(); toast('Report details saved.');
    }
    if (form.id === 'triage-form') {
      await api(`/api/runs/${state.runDetail.id}/triage/${drafts.editorDraft.caseId}`, 'PUT', { severity: f.get('severity'), owner: f.get('issue-owner'), reference: f.get('issue-reference'), impact: f.get('issue-impact'), notes: f.get('triage-notes') });
      closeDialog(); await reload(); toast('Finding triage saved.');
    }
    if (form.id === 'module-form') {
      const module = drafts.editorDraft;
      const result = await api(module ? `/api/modules/${module.id}` : '/api/modules', module ? 'PUT' : 'POST', { name: f.get('name'), area: f.get('area'), prefix: f.get('prefix'), description: f.get('description'), adapter: f.get('adapter') || null, ...(module ? (f.has('require-second') || $('#require-second') ? { settings: { requireSecondApprover: f.has('require-second') } } : {}) : { productId: state.productId }), version: module?.version });
      closeDialog(); if (!module) await loadAccess(); await reload(); location.hash = `/modules/${result.id}`; toast(module ? 'Module updated.' : 'Module created. Add your first case.');
    }
    if (form.id === 'ai-generate-form') {
      const m = currentModule();
      state.aiOptions = {
        ...state.aiOptions,
        prompt: f.get('ai-prompt') ?? '',
        count: Number(f.get('ai-count') || 5),
        focus: f.get('ai-focus') || 'all',
        priority: f.get('ai-priority') || 'auto',
        targetField: f.get('ai-field') || '',
        variant: f.get('ai-variant') || '',
        mode: f.get('ai-mode') || (m.adapter ? 'automated' : 'manual'),
      };
      state.aiThinking = true;
      state.aiThinkingStep = 0;
      state.aiDrafts = [];
      renderPage();
      $('.ai-thinking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const stepTimer = setInterval(() => {
        if (state.aiThinking && state.aiThinkingStep < 3) {
          state.aiThinkingStep++;
          renderPage();
        }
      }, 260);
      try {
        const [res] = await Promise.all([
          api(`/api/modules/${m.id}/ai-generate`, 'POST', state.aiOptions),
          new Promise(resolve => setTimeout(resolve, 1050)),
        ]);
        state.aiDrafts = res.drafts ?? [];
        state.aiSummary = res.summary ?? null;
        state.aiSelected = new Set(state.aiDrafts.map((_, i) => i));
      } catch (e) {
        clearInterval(stepTimer); state.aiThinking = false;
        if (e.status === 409 && e.body?.readiness) noteReadiness(m.id, e.body.readiness);
        renderPage(); throw e;
      } finally {
        clearInterval(stepTimer);
        state.aiThinking = false;
      }
      renderPage();
      toast(`AI generated ${state.aiDrafts.length} edge-case draft(s) for review.`);
      $('.ai-review-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (form.id === 'case-form') {
      const m = drafts.editorDraft.module, value = caseFromForm(form);
      if (drafts.editorDraft.aiDraftIndex !== null && drafts.editorDraft.aiDraftIndex !== undefined) {
        value.aiRationale = state.aiDrafts[drafts.editorDraft.aiDraftIndex]?.aiRationale;
        state.aiDrafts[drafts.editorDraft.aiDraftIndex] = value;
        closeDialog(); renderPage(); toast(`Draft ${value.id} updated.`);
      } else {
        await api(`/api/modules/${m.id}/cases${drafts.editorDraft.original ? `/${value.id}` : ''}`, drafts.editorDraft.original ? 'PUT' : 'POST', value);
        state.revealCaseId = value.id; // keep the saved case on screen even if it sorts past the loaded rows
        closeDialog(); await reload(); toast(`${value.id} saved.`);
      }
    }
    if (form.id === 'run-form') {
      const caseIds = drafts.runDraft.cases.filter(c => c.mode === drafts.runDraft.mode && isApproved(c) && drafts.runDraft.selected.has(c.id)).map(c => c.id);
      if (!caseIds.length) throw new Error('Select at least one case for this run.');
      const r = await api('/api/runs', 'POST', { name: f.get('run-name'), moduleId: drafts.runDraft.module.id, mode: drafts.runDraft.mode, environmentId: f.get('run-environment'), caseIds });
      closeDialog(); await reload(); location.hash = `/runs/${r.id}`; toast(r.mode === 'manual' ? 'Manual run opened. Record your results.' : 'Run added to the execution queue.');
    }
    if (form.id === 'template-form') {
      await api(`/api/modules/${drafts.templateModule.id}/templates`, 'PUT', { name: f.get('template-name'), input: readInputs(form, adapterFor(drafts.templateModule)), version: drafts.templateModule.version });
      closeDialog(); await reload(); toast('Shared data template saved.');
    }
    if (form.id === 'import-form') {
      const file = f.get('file'); if (!file?.size || file.size > 6 * 1024 * 1024) throw new Error('Choose a JSON or Excel file up to 6 MB.');
      let data, format;
      if (file.name.endsWith('.xlsx')) {
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        data = btoa(binary); format = 'xlsx';
      } else { try { data = JSON.parse(await file.text()); } catch { throw new Error('The selected file is not valid JSON.'); } format = 'json'; }
      const result = await api(`/api/modules/${currentModule().id}/import`, 'POST', { format, data, upsert: f.has('upsert') }); closeDialog(); await reload(); toast(`${result.imported} cases imported.`);
    }
    if (form.id === 'export-form') closeDialog();
    if (form.dataset.manualResult) {
      const id = form.dataset.manualResult;
      const evidence = f.get('evidence');
      if (evidence?.size && (evidence.size > 4 * 1024 * 1024 || !evidence.name.toLowerCase().endsWith('.png'))) throw new Error('Choose a PNG screenshot up to 4 MB.');
      await api(`/api/runs/${state.runDetail.id}/results`, 'POST', { id, status: f.get(`status-${id}`), actual: f.get(`actual-${id}`) });
      if (evidence?.size) await api(`/api/runs/${state.runDetail.id}/evidence`, 'POST', { caseId: id, name: evidence.name, data: await fileBase64(evidence) });
      await reload(); toast(`${id} result recorded.`);
    }
  } catch (error) { dialogError(error); }
  finally { if (button) button.disabled = false; }
});
window.addEventListener('hashchange', () => { state.reviewSel.clear(); state.selected.clear(); state.suite = ''; state.search = ''; state.caseMode = ''; state.priority = ''; state.runCaseFilter = ''; state.runCaseSearch = ''; renderRoute().catch(e => toast(e.message, true)); });
document.addEventListener('keydown', async event => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    if (!state.data || !can('run.start')) return;
    try {
      if ($('#dialog').open) {
        if ($('#run-form')) $('#run-form').requestSubmit();
        return;
      }
      if (currentModule() && state.selected.size > 0) {
        const selected = state.cases.filter(c => state.selected.has(c.id));
        if (new Set(selected.map(c => c.mode)).size > 1) throw new Error('Select one execution type per run. Filter cases to Manual or Automated first.');
        await showRunDialog(currentModule().id, [...state.selected]);
      } else if (state.route[0] === 'runs' && state.route[1] && $('[data-action="rerun"]:not(:disabled)')) {
        $('[data-action="rerun"]').click();
      } else {
        await showRunDialog(currentModule()?.id);
      }
    } catch (error) { toast(error.message, true); }
  }
});
