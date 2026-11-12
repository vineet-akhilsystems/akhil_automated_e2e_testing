import { badge, date, esc, icon, isApproved } from '../components/dom.js';
import { empty, heading, searchBox, stats } from '../components/widgets.js';
import { readinessPanel } from './pipeline.js';
import { productName } from './workspace.js';
import { NO_ACCESS_TEXT, can, canProduct, hasNoAccess } from '../permissions.js';
import { state } from '../state.js';


function moduleCard(m) {
  return `<article class="module-card"><div class="flex between"><div class="module-icon">${icon(m.area === 'Setup' ? 'settings' : 'people')}</div>${badge(m.adapter ? 'Automation connected' : 'Manual testing', m.adapter ? 'green' : '')}</div><h2>${esc(m.name)}</h2><p class="description">${esc(m.description || 'Organize test cases and track execution for this module.')}</p><div class="module-meta"><span><strong>${m.caseCount}</strong> test cases</span><span><strong>${m.automatedCount}</strong> executable</span>${m.blockedAutomationCount ? `<span><strong>${m.blockedAutomationCount}</strong> not automated</span>` : ''}<span><strong>${m.requirementCount ?? (m.config?.requirements?.length ?? 0)}</strong> requirements</span></div><div class="module-bottom"><span class="badge">${esc(m.area)}</span><a href="#/modules/${m.id}">Open module ${icon('arrow')}</a></div></article>`;
}
export function modulesPage() {
  const all = state.data.modules, areas = [...new Set(all.map(m => m.area))];
  const modules = all.filter(m => (!state.area || m.area === state.area) && `${m.name} ${m.area} ${m.description}`.toLowerCase().includes(state.moduleSearch.toLowerCase()));
  return heading(`${productName()} quality workspace`, 'Every module. One testing hub.', 'Create cases, run checks, and understand quality across your application.', `${state.access && canProduct('members.manage') ? `<a class="button-link" href="#/access">${icon('lock')} Product access</a>` : ''}${can('run.start') ? `<button data-action="new-run">${icon('play')} New test run</button>` : ''}${canProduct('module.create') ? `<button class="primary" data-action="new-module">${icon('plus')} Add module</button>` : ''}`)
    + stats([['Modules', all.length, 'Organized by business area', 'grid'], ['Test cases', all.reduce((n, m) => n + m.caseCount, 0), 'Reusable across test runs', 'cases', 'blue'], ['Automation connected', all.filter(m => m.adapter).length, 'Modules ready for browser checks', 'play', 'green'], ['Needs rule review', all.reduce((n, m) => n + m.reviewCount, 0), 'Cases with assumed expectations', 'info', 'orange']])
    + `<div class="toolbar"><div class="filters">${[['', 'All modules'], ...areas.map(a => [a, a])].map(([area, label]) => `<button class="filter ${state.area === area ? 'active' : ''}" data-action="area" data-value="${esc(area)}">${esc(label)}<span class="count">${area ? all.filter(m => m.area === area).length : all.length}</span></button>`).join('')}</div>${searchBox('Find a module…', state.moduleSearch, 'moduleSearch')}</div><div class="section-line"><h2>${state.area ? esc(state.area) : 'Module library'}</h2><small>${modules.length} module${modules.length === 1 ? '' : 's'}</small></div>${all.length ? '' : `<div class="panel" role="status">${hasNoAccess() ? empty('Nothing to open yet', NO_ACCESS_TEXT) : empty(`No modules yet in ${productName()}`, canProduct('module.create') ? 'Add a module or upload its requirements in Intake.' : 'Nothing has been shared with you in this product yet. Ask a module lead to add you.', canProduct('module.create') ? '<button class="primary" data-action="new-module">Add module</button>' : '')}</div>`}<div class="module-grid">${modules.map(moduleCard).join('')}${canProduct('module.create') ? `<button class="add-card" data-action="new-module"><div class="module-icon">${icon('plus')}</div><strong>Add your next module</strong><span>Setup, billing, appointments or any part of your application.</span></button>` : ''}</div><div class="info-strip">${icon('layers')}<div><strong>A shared foundation. A workflow for every module.</strong><p>Create a module and start documenting or manually testing today. Connect a module’s automation adapter when its browser workflow is ready.</p></div></div><div class="footer-note"><span>Cases stay reusable. Every run keeps its own snapshot.</span><span>${esc(productName())} Test Studio</span></div>`;
}
export function runRow(r) {
  return `<div class="run-row"><span class="stat-icon ${r.status === 'passed' ? 'green' : ''}">${icon(r.mode === 'manual' ? 'people' : 'play')}</span><div class="run-text"><button class="run-title-link" data-action="open-run" data-id="${r.id}"><strong>${esc(r.name)}</strong></button><div class="run-meta-line"><span class="run-meta-mod">${esc(r.module.name)}</span><span class="run-meta-sep">·</span><span class="run-meta-env">${esc(r.environmentName)}</span><span class="run-meta-sep">·</span><span class="run-meta-date">${date(r.createdAt)}</span></div></div><span class="result-count">${r.results.length}/${r.total} cases</span>${badge(r.status)}</div>`;
}
export function overviewPage() {
  const runs = state.data.runs.filter(r => r.kind === 'tests'), results = runs.flatMap(r => r.results), pass = results.filter(r => r.status === 'PASS').length;
  return heading(`${productName()} overview`, 'A clear view of quality.', 'See what is covered, what ran, and where your team should look next.', can('run.start') ?`<button class="primary" data-action="new-run">${icon('play')} New test run</button>` : '')
    + stats([['Test cases', state.data.modules.reduce((n, m) => n + m.caseCount, 0), 'Across all modules', 'cases'], ['Test runs', runs.length, 'Manual and automated', 'play', 'blue'], ['Recorded pass rate', results.filter(r => !['SKIPPED', 'OBSERVED'].includes(r.status)).length ? `${Math.round(pass / results.filter(r => !['SKIPPED', 'OBSERVED'].includes(r.status)).length * 100)}%` : '—', 'Excludes skipped and observation-only', 'check', 'green'], ['Active runs', runs.filter(r => ['queued', 'running', 'manual'].includes(r.status)).length, 'Queued, running or manual', 'clock', 'orange']])
    + `<div class="two-col"><div class="panel"><div class="panel-heading"><h2>Recent test runs</h2><a class="tiny" href="#/runs">View all →</a></div>${state.data.runs.length ? state.data.runs.slice(0, 6).map(runRow).join('') : empty('Your first run starts here', 'Choose a module and a set of cases. Your results and evidence will appear here.', can('run.start') ? '<button data-action="new-run">Create a test run</button>' : '')}</div><div class="panel"><div class="panel-heading"><h2>Module coverage</h2><span class="badge">${state.data.modules.length} modules</span></div>${state.data.modules.map(m => `<div class="run-row"><div class="module-icon">${icon('grid')}</div><div class="run-text"><a href="#/modules/${m.id}"><strong>${esc(m.name)}</strong></a><small>${esc(m.area)} · ${m.caseCount} cases</small></div>${badge(m.adapter ? 'Connected' : 'Manual', m.adapter ? 'green' : '')}</div>`).join('')}</div></div>`;
}
export function moduleTabs(m, selected = 'cases') {
  return `<div class="module-tabs"><a class="${selected === 'cases' ? 'active' : ''}" href="#/modules/${m.id}">Test cases <span class="muted">${m.caseCount}</span></a><a class="${selected === 'intake' ? 'active' : ''}" href="#/modules/${m.id}/intake">${icon('upload')} Intake</a><a class="${selected === 'review' ? 'active' : ''}" href="#/modules/${m.id}/review">Review queue${state.cases.filter(c => !isApproved(c) && c.reviewStatus === 'draft').length ? ` <span class="count-pill">${state.cases.filter(c => c.reviewStatus === 'draft').length}</span>` : ''}</a>${can('case.create', m.id) ? `<a class="${selected === 'ai' ? 'active' : ''}" href="#/modules/${m.id}/ai">${icon('sparkle')} Generate with AI</a>` : ''}${state.data.capabilities?.coverage ? `<a class="${selected === 'coverage' ? 'active' : ''}" href="#/modules/${m.id}/coverage">Coverage & gaps</a>` : '<span class="tiny muted">Coverage update pending</span>'}<a href="#/runs?module=${m.id}">Run history</a>${m.adapter ? `<a href="#/shared/${m.id}">Shared test data</a>` : ''}${state.access && can('members.manage', m.id) ? `<a class="${selected === 'members' ? 'active' : ''}" href="#/modules/${m.id}/members">${icon('people')} Members</a>` : ''}${can('module.settings', m.id) ? `<button class="quiet small" data-action="edit-module" data-id="${m.id}">Module settings</button>` : ''}</div>${readinessPanel(m)}`;
}
export function plainCaseSummary(c, adapter) {
  if (c.mode === 'manual') {
    const stepCount = c.steps?.length ?? 0;
    const firstExpected = c.steps?.[0]?.expected ?? '';
    return `Manual flow (${stepCount} step${stepCount === 1 ? '' : 's'})${firstExpected ? ` · Expects: ${firstExpected.slice(0, 90)}${firstExpected.length > 90 ? '…' : ''}` : ''}`;
  }
  const actionLabel = adapter?.actions?.[c.action] ?? c.action;
  const inputs = Object.entries(c.input ?? {}).slice(0, 3).map(([k, v]) => `${adapter?.fields?.[k]?.label ?? k}: ${v === '' ? '<EMPTY>' : String(v).slice(0, 22)}`);
  const outcomeMap = { saved: 'Record saved', blocked: 'Submission blocked', updated: 'Record updated', 'update-blocked': 'Update blocked', 'field-state': 'Field state verified', observe: 'Observe behavior' };
  const outcomeLabel = outcomeMap[c.expected?.outcome] ?? c.expected?.outcome ?? '';
  return `${actionLabel}${c.registrationType ? ` (${c.registrationType})` : ''}${inputs.length ? ` · Inputs: ${inputs.join(', ')}${Object.keys(c.input ?? {}).length > 3 ? ` +${Object.keys(c.input).length - 3} more` : ''}` : ''} · Expects: ${outcomeLabel}`;
}
// Presets come from the server. A module-specific list (m.aiPresets) wins; otherwise the shared list is filtered:
// entries tagged with modules[] only show for those modules, and a module with none of its own gets the neutral ones.
export function presetsFor(m) {
  if (Array.isArray(m?.aiPresets)) return m.aiPresets;
  const all = state.data.aiPresets ?? [];
  const own = all.filter(p => p.modules?.includes(m?.id));
  return own.length ? own : all.filter(p => !p.modules);
}
