import { api } from '../api.js';
import { badge, esc, icon } from '../components/dom.js';
import { empty, heading, toast } from '../components/widgets.js';
import { can, isAdmin } from '../permissions.js';
import { currentModule, state } from '../state.js';
import { moduleTabs } from './modules.js';

// Tester knowledge: what the AI agent is told about how a senior tester thinks, the product's domain, and this module's lessons.
// Plus small helpers that show the agent's reasoning (risk, basis, reviewer note) where cases and insights are read.

export async function loadKnowledge(moduleId) {
  try { state.knowledge = await api(`/api/modules/${moduleId}/knowledge`); state.knowledgeError = ''; }
  catch (error) { state.knowledge = null; state.knowledgeError = error.message; }
}

const HELP = {
  mindset: 'How an experienced tester decides what to test. Shared by every module, so only an administrator changes it.',
  domain: 'What a good hospital-software tester knows that the documents rarely say. Shared by the whole product, so only an administrator changes it. Treat it as a draft until a senior tester has corrected it.',
  module: 'What went wrong here before, what is confirmed, and which risks matter most for this module. A module lead keeps this up to date: every real defect found is a lesson.',
};

export function knowledgePage() {
  const m = currentModule();
  if (!m) return empty('Module not found', 'Choose a module from the library.');
  const k = state.knowledge;
  const head = `<a class="back-link" href="#/modules/${m.id}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Tester knowledge · ${m.name}`, 'The experience the AI agent brings when it analyses files and drafts cases for this module.', '') + moduleTabs(m, 'knowledge');
  if (!k) return head + `<div class="panel">${empty('Tester knowledge is not available', state.knowledgeError || 'Try again in a moment.')}</div>`;
  const used = k.used;
  const editable = layer => layer === 'module' ? can('module.settings', m.id) : isAdmin();
  const layerPanel = l => `<section class="panel knowledge-layer" aria-labelledby="kn-${l.layer}">
      <div class="panel-heading"><div><h2 id="kn-${l.layer}">${esc(l.label)}</h2><span class="tiny muted">${esc(HELP[l.layer])}</span></div>${l.exists ? '' : badge('Not written yet', 'orange')}</div>
      <textarea class="knowledge-text" id="kn-text-${l.layer}" data-layer="${l.layer}" rows="${l.layer === 'module' ? 16 : 10}" ${editable(l.layer) ? '' : 'readonly'} aria-label="${esc(l.label)}" maxlength="20000">${esc(l.text)}</textarea>
      <div class="flex between"><span class="tiny muted" id="kn-count-${l.layer}">${l.text.length.toLocaleString()} of about ${l.limit.toLocaleString()} characters the agent will read${l.text.length > l.limit ? ' (the rest is cut off, so put the most important points first)' : ''}</span>${editable(l.layer) ? `<button class="primary small" data-action="knowledge-save" data-layer="${l.layer}">Save</button>` : '<span class="tiny muted">Read only for your role</span>'}</div>
    </section>`;
  return head
    + `<div class="info-strip">${icon('info')}<div><strong>This is experience, not requirements.</strong><p>The agent uses these notes to decide what to test and where the risk is. Anything that rests only on them is marked as tester experience and as an assumed rule, so it needs a business analyst to confirm it. The files you upload stay the only source of confirmed rules.</p></div></div>`
    + `<div class="panel knowledge-used"><h2>What the agent will read for ${esc(m.name)}</h2>${used.files.length ? `<ul class="group-list">${used.files.map(f => `<li><strong>${esc(f.name)}</strong> <span class="muted">${f.chars.toLocaleString()} characters${f.truncated ? ', trimmed to fit the reading budget' : ''}</span></li>`).join('')}</ul>` : '<p class="muted">No notes yet, so the agent works from the uploaded files alone.</p>'}</div>`
    + k.layers.slice().reverse().map(layerPanel).join('');
}

/** Where a draft case came from: the risk it covers, whether its expectation is confirmed or experience, and the reviewer's note. */
export function caseContext(c) {
  if (!c.risk && !c.basis) return '';
  return `<div class="case-context">${c.risk ? `<span class="tiny"><strong>Risk:</strong> ${esc(c.risk)}</span>` : ''}${c.basis === 'experience' ? badge('Tester experience: confirm the rule', 'orange') : c.basis === 'source' ? badge('Confirmed by a source file', 'green') : ''}</div>`;
}

const LEVEL = { high: 'fail', medium: 'orange', low: '' };
/** Risks the agent identified before writing cases, and what the reviewer pass changed. */
export function risksPanel(d) {
  if (!d?.risks?.length && !d?.critic) return '';
  const c = d.critic;
  return `<div class="insight-block"><h3>Risks the agent weighed first</h3>${d.risks?.length ? `<table class="health-table"><thead><tr><th>Risk</th><th>Impact</th><th>Likelihood</th><th>Covered by</th></tr></thead><tbody>${d.risks.map(r => `<tr><td>${esc(r.risk)}${r.source ? `<div class="tiny muted">${esc(r.source)}</div>` : ''}</td><td>${r.impact ? badge(r.impact, LEVEL[r.impact]) : ''}</td><td>${r.likelihood ? badge(r.likelihood, LEVEL[r.likelihood]) : ''}</td><td class="tiny">${esc(r.coverage || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">The agent did not list risks.</p>'}</div>`
    + (c ? `<div class="insight-block"><h3>Reviewer pass</h3><p>${esc(c.summary || 'The reviewer checked the draft cases.')}</p><p class="tiny muted">Kept ${c.stats.kept}, improved ${c.stats.improved}, dropped ${c.stats.dropped}, added ${c.stats.added}.${c.stats.dropGuard ? ' It asked to drop too many cases, so none were dropped.' : ''}</p>${c.dropped?.length ? `<details><summary class="tiny">Dropped cases (${c.dropped.length})</summary><ul class="group-list">${c.dropped.map(x => `<li><strong>${esc(x.title)}</strong> <span class="muted">${esc(x.reason)}</span></li>`).join('')}</ul></details>` : ''}${c.missingRisks?.length ? `<h4>Risks the reviewer says are still uncovered</h4><ul>${c.missingRisks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '');
}

export async function saveKnowledgeLayer(moduleId, layer) {
  const text = document.getElementById(`kn-text-${layer}`)?.value ?? '';
  const saved = await api(`/api/modules/${moduleId}/knowledge`, 'PUT', { layer, text });
  state.knowledge = { layers: saved.layers, used: saved.used };
  toast(saved.overBudget ? 'Saved. Part of it is beyond the reading budget and will be cut off.' : 'Saved. The next analysis will use it.');
}
