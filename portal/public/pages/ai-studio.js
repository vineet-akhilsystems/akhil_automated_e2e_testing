import { nextId } from '../components/dialogs.js';
import { badge, esc, icon } from '../components/dom.js';
import { empty, heading, selectField, textArea } from '../components/widgets.js';
import { moduleTabs, presetsFor } from './modules.js';
import { aiBlocked, aiGateInner } from './pipeline.js';
import { renderKvBox } from './runs.js';
import { adapterFor, currentModule, state } from '../state.js';

export function aiStudioPage() {
  const m = currentModule();
  if (!m) return empty('Module not found', 'Choose a module from the library.');
  const a = adapterFor(m);
  const presets = presetsFor(m);
  const optsState = state.aiOptions;
  const modeVal = optsState.mode || (a ? 'automated' : 'manual');
  const fieldOptions = [['', 'Any field (AI chooses high-risk fields)'], ...Object.entries(a?.fields ?? {}).map(([k, v]) => [k, `${v.label} (${k})`])];
  const variantOptions = [['', 'Any variant'], ...(a?.variants ?? []).map(v => [v, v])];
  const selectedDraftCount = state.aiDrafts.filter((_, idx) => state.aiSelected.has(idx)).length;
  return `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>`
    + heading(m.area, `Create test cases with AI · ${m.name}`, 'Tell AI what kind of edge cases you want in plain English. AI thinks out of the box, builds ready-to-run test cases for our dynamic script, and lets you review and accept them.', `<a class="back-link" href="#/modules/${m.id}">Back to ${m.caseCount} cases</a>`)
    + moduleTabs(m, 'ai')
    + `<div id="ai-gate">${aiGateInner(m)}</div>`
    + `<section class="panel ai-studio-panel"><div class="panel-heading"><div><h2>1. Choose your testing goal & prompt</h2><span class="tiny muted">Click a smart preset below or describe any scenario in your own words — minimal effort, maximum coverage.</span></div>${badge(a ? 'Dynamic browser automation ready' : 'Manual test step generator', a ? 'green' : 'purple')}</div>
      <div class="ai-body">
        <div class="ai-presets-label tiny muted">One-click smart presets (click to fill prompt & focus):</div>
        <div class="ai-preset-grid">${presets.map(p => `<button type="button" class="ai-preset-card ${optsState.presetId === p.id ? 'active' : ''}" data-action="ai-preset" data-id="${esc(p.id)}"><div class="flex between"><strong>${esc(p.label)}</strong>${badge(p.focus, 'purple')}</div><p>${esc(p.description)}</p></button>`).join('')}</div>
        <form id="ai-generate-form" class="ai-form">
          ${textArea('What kind of test cases or edge cases should AI generate?', 'ai-prompt', optsState.prompt, 'rows="3" maxlength="3000" placeholder="e.g. Think out of the box: find UI state bugs, invalid formats, boundary values, XSS payloads, or contradictory field combinations that could break the application…"')}
          <div class="form-grid three">
            ${selectField('How many test cases?', 'ai-count', [['3', '3 test cases (Quick check)'], ['5', '5 test cases (Recommended)'], ['8', '8 test cases (Deep dive)'], ['10', '10 test cases (Comprehensive)'], ['15', '15 test cases (Full stress batch)']], String(optsState.count || 5))}
            ${selectField('Focus area', 'ai-focus', [['all', 'All out-of-the-box edge cases'], ['ui', 'UI state, layout & cascade bugs'], ['functional', 'Functional & business rules'], ['security', 'Security, XSS, SQLi & regex crashes'], ['update', 'Edit / update & data persistence'], ['coverage', 'Fill uncovered fields & variants']], optsState.focus || 'all')}
            ${selectField('Target priority', 'ai-priority', [['auto', 'Auto (AI assigns P0–P2 by risk)'], ['P0', 'P0 — Critical blocker'], ['P1', 'P1 — High business impact'], ['P2', 'P2 — Standard edge case'], ['P3', 'P3 — Cosmetic / low priority']], optsState.priority || 'auto')}
          </div>
          <div class="form-grid three">
            ${a ? selectField('Focus on specific field (optional)', 'ai-field', fieldOptions, optsState.targetField || '') : ''}
            ${a?.variants?.length ? selectField(a.variantLabel ?? 'Variant (optional)', 'ai-variant', variantOptions, optsState.variant || '') : ''}
            ${selectField('Execution mode', 'ai-mode', a ? [['automated', 'Automated browser test (dynamic runner)'], ['manual', 'Manual step-by-step test']] : [['manual', 'Manual step-by-step test']], modeVal)}
          </div>
          <div class="ai-submit-bar">
            <span class="tiny muted">AI automatically validates every generated case against ${esc(m.name)}’s field definitions and assigns sequential IDs starting at <strong>${esc(nextId(m))}</strong>.</span>
            <button type="submit" id="ai-submit" class="primary ${state.aiThinking ? 'ai-btn-thinking' : ''}" ${state.aiThinking || aiBlocked(m) ? 'disabled' : ''}>${icon('sparkle')} ${state.aiThinking ? 'AI is thinking…' : 'Generate edge cases with AI'}</button>
          </div>
        </form>
      </div>
    </section>`
    + (state.aiThinking ? `<section class="panel ai-thinking-panel spaced-panel" role="status" aria-live="polite">
      <div class="ai-rainbow-bar"></div>
      <div class="ai-thinking-content">
        <div class="ai-thinking-header">
          <div class="ai-orb-wrap">
            <span class="ai-orb-glow"></span>
            <span class="ai-orb-ring"></span>
            <span class="ai-orb-core">${icon('sparkle')}</span>
          </div>
          <div class="ai-thinking-title">
            <div class="ai-thinking-badge">AI EDGE-CASE ENGINE ACTIVE</div>
            <h2>AI is thinking out of the box for ${esc(m.name)}…</h2>
            <p class="tiny muted">Analyzing field constraints, UI cascades, security boundaries, and business rules to craft ${optsState.count || 5} ready-to-run cases.</p>
          </div>
          <div class="ai-wave-bars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        </div>
        <div class="ai-step-pills">
          ${[
            `1. Scanning ${Object.keys(a?.fields ?? {}).length || 'module'} fields & coverage gaps`,
            `2. Synthesizing ${optsState.count || 5} out-of-the-box edge cases`,
            `3. Mapping dynamic browser script inputs & checks`,
            `4. Validating rules & preparing review board`,
          ].map((label, idx) => `<div class="ai-step-pill ${state.aiThinkingStep > idx ? 'done' : state.aiThinkingStep === idx ? 'active' : ''}"><span class="ai-step-dot"></span><span>${esc(label)}</span></div>`).join('')}
        </div>
        <div class="ai-skeleton-grid" aria-hidden="true">
          <div class="ai-skeleton-card"><div class="ai-skel-line wide"></div><div class="ai-skel-line medium"></div><div class="ai-skel-chips"><span></span><span></span><span></span></div></div>
          <div class="ai-skeleton-card"><div class="ai-skel-line wide"></div><div class="ai-skel-line medium"></div><div class="ai-skel-chips"><span></span><span></span><span></span></div></div>
        </div>
      </div>
    </section>` : '')
    + (state.aiDrafts.length ? `<section class="panel ai-review-panel spaced-panel">
      <div class="panel-heading ai-review-head">
        <div>
          <h2>2. Review & accept AI-generated test cases (${state.aiDrafts.length} drafts)</h2>
          <span class="tiny muted">Review the plain-English AI rationale and dynamic automation script inputs below. Customize any draft, uncheck any you do not need, then accept to save or run immediately.</span>
        </div>
        <div class="flex ai-review-actions">
          <button type="button" class="small quiet" data-action="ai-select-all">Select all (${state.aiDrafts.length})</button>
          <button type="button" class="small quiet" data-action="ai-clear-all">Clear</button>
          <button type="button" class="small" data-action="ai-accept-save" ${!selectedDraftCount ? 'disabled' : ''}>${icon('check')} Accept & save selected (${selectedDraftCount})</button>
          <button type="button" class="small primary" data-action="ai-accept-run" ${!selectedDraftCount ? 'disabled' : ''}>${icon('play')} Accept & run selected now (${selectedDraftCount})</button>
        </div>
      </div>
      ${state.aiSummary ? `<div class="info-strip ai-summary-strip">${icon('sparkle')}<div><strong>AI synthesis summary · ${state.aiSummary.count} out-of-the-box cases prepared for ${esc(m.name)}</strong><p>Focus: <strong>${esc(state.aiSummary.focus)}</strong> · Mode: <strong>${esc(state.aiSummary.mode)}</strong>${state.aiSummary.coverageGapFields?.length ? ` · Unchecked module fields detected: <strong>${state.aiSummary.coverageGapFields.length}</strong> (${esc(state.aiSummary.coverageGapFields.slice(0, 5).map(k => a?.fields?.[k]?.label ?? k).join(', '))})` : ''}</p></div></div>` : ''}
      <div class="ai-draft-list">${state.aiDrafts.map((d, idx) => {
        const inputEntries = Object.entries(d.input ?? {}).map(([k, v]) => [a?.fields?.[k]?.label ?? k, v === '' ? '<EMPTY (clears field)>' : String(v)]);
        const checkEntries = ['values', 'fieldErrors', 'hints', 'persisted'].flatMap(kind => Object.entries(d.expected?.[kind] ?? {}).map(([k, v]) => [`${kind === 'fieldErrors' ? 'Error on' : kind === 'persisted' ? 'Saved' : kind === 'hints' ? 'Hint on' : 'Value of'} ${a?.fields?.[k]?.label ?? k}`, v === '' ? '<EMPTY>' : String(v)]));
        return `<article class="ai-draft-card ${state.aiSelected.has(idx) ? 'selected' : ''}">
          <div class="ai-draft-top">
            <label class="ai-draft-check"><input type="checkbox" data-ai-select="${idx}" ${state.aiSelected.has(idx) ? 'checked' : ''} aria-label="Select draft ${esc(d.id)}"><span class="case-id">${esc(d.id)}</span></label>
            <div class="ai-draft-title-wrap">
              <h3>${esc(d.title)}</h3>
              <div class="tag-line">
                <span class="priority ${d.priority.toLowerCase()}">● ${esc(d.priority)}</span>
                ${badge(d.category || 'Edge Cases')}
                ${badge(d.mode, d.mode === 'automated' ? 'purple' : '')}
                ${d.registrationType ? badge(d.registrationType, 'green') : ''}
                ${d.requirement ? badge(d.requirement) : ''}
                ${d.expected?.assumed ? badge('Rule review recommended', 'orange') : ''}
              </div>
            </div>
            <div class="flex">
              <button type="button" class="small" data-action="ai-edit-draft" data-index="${idx}">${icon('edit')} Customize draft</button>
              <button type="button" class="small quiet" data-action="ai-remove-draft" data-index="${idx}" title="Discard draft" aria-label="Discard ${esc(d.id)}">${icon('trash')}</button>
            </div>
          </div>
          ${d.aiRationale ? `<div class="ai-rationale"><strong>${icon('sparkle')} Why AI suggested this out-of-the-box edge case:</strong><p>${esc(d.aiRationale)}</p></div>` : ''}
          ${d.mode === 'automated' ? `<div class="ai-script-preview">
            <div class="tiny muted ai-script-meta"><strong>Dynamic automation script plan:</strong> Action: <code>${esc(a?.actions?.[d.action] ?? d.action)}</code> · Starting template: <code>${esc(d.base || 'None')}</code>${d.target ? ` · Target: <code>${esc(d.target)}</code>` : ''} · Expected outcome: <code>${esc(d.expected?.outcome)}</code></div>
            <div class="kv-grid">
              ${renderKvBox('Inputs dynamic script will enter', inputEntries.length ? inputEntries : [['Starting template', d.base || 'Default']])}
              ${renderKvBox('Checks dynamic script will verify', [['Outcome', d.expected?.outcome ?? 'blocked'], ...(d.expected?.toastContains ? [['Toast contains', d.expected.toastContains]] : []), ...(d.expected?.saveDisabled !== undefined ? [['Update button disabled', String(d.expected.saveDisabled)]] : []), ...checkEntries])}
            </div>
          </div>` : `<div class="ai-script-preview">${(d.steps ?? []).map((s, i) => `<div class="manual-step"><span class="step-no">${i + 1}</span><div>${esc(s.action)}</div><div class="muted">${esc(s.expected)}</div></div>`).join('')}</div>`}
        </article>`;
      }).join('')}</div>
    </section>` : '');
}
