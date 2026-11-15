import { api } from '../api.js';
import { date, esc, icon } from '../components/dom.js';
import { nodeTone } from '../components/version.js';
import { empty, heading } from '../components/widgets.js';
import { currentModule, state } from '../state.js';
import { moduleTabs } from './modules.js';

// state.treeAvailable[moduleId] is false when the server answered 404, which hides the Tree tab.
state.treeAvailable ??= {};
export async function loadTree(moduleId) {
  try { state.tree = await api(`/api/modules/${moduleId}/tree?run=latest`); state.treeAvailable[moduleId] = true; state.treeError = ''; }
  catch (e) {
    state.tree = null;
    if (e.status === 404) { state.treeAvailable[moduleId] = false; state.treeError = ''; } else { state.treeAvailable[moduleId] = true; state.treeError = e.message; }
  }
}
export async function probeTree(moduleId) {
  if (state.treeAvailable[moduleId] !== undefined) return;
  try { await api(`/api/modules/${moduleId}/tree`); state.treeAvailable[moduleId] = true; }
  catch (e) { state.treeAvailable[moduleId] = e.status !== 404 && e.status !== 403; }
}

const counts = r => {
  const s = r?.subtree ?? {};
  return `<span class="tree-counts"><span class="tc total" title="Cases">${esc(s.total ?? 0)}</span><span class="tc pass" title="Passed">${esc(s.passed ?? 0)}</span><span class="tc fail" title="Failed">${esc(s.failed ?? 0)}</span><span class="tc blocked" title="Blocked">${esc(s.blocked ?? 0)}</span><span class="tc none" title="No result in this run">${esc(s.other ?? 0)}</span></span>`;
};

function nodeHtml(node, kids, t, showEmpty) {
  const r = t.rollup[node.id] ?? {}, sub = r.subtree ?? {};
  if (!showEmpty && !(sub.total > 0) && node.kind !== 'root') return '';
  const children = (kids[node.id] ?? []).map(k => nodeHtml(k, kids, t, showEmpty)).join('');
  const selected = state.treeNode === node.id;
  return `<li class="tree-node ${sub.total ? '' : 'empty-node'}"><div class="tree-row ${nodeTone(sub)} ${selected ? 'selected' : ''}"><button type="button" class="tree-label" data-action="tree-node" data-id="${esc(node.id)}" aria-pressed="${selected}"><span class="tree-name">${esc(node.name)}</span> <span class="tree-kind">${esc(node.kind)}</span></button>${counts(r)}</div>${node.note ? `<div class="tree-note tiny muted">${esc(node.note)}</div>` : ''}${children ? `<ul>${children}</ul>` : ''}</li>`;
}

export function treePage() {
  const m = currentModule(), t = state.tree;
  const out = `<a class="back-link" href="#/modules/${esc(m.id)}">${icon('back')} ${esc(m.name)} cases</a>` + heading(m.area, `Tree · ${m.name}`, 'How the cases are grouped by step, with the result of the latest finished automated run.', '') + moduleTabs(m, 'tree');
  if (!t) return out + `<div class="panel">${empty(state.treeError ? 'The tree could not be loaded' : 'No tree for this module', state.treeError || 'This module has no tree file.')}</div>`;
  const kids = {};
  for (const n of t.tree.nodes) if (n.parent !== undefined) (kids[n.parent] ??= []).push(n);
  const root = t.tree.nodes.find(n => n.parent === undefined);
  const showEmpty = Boolean(state.treeShowEmpty);
  const runLine = t.run ? `Counts reflect the latest finished automated run: <strong>${esc(t.run.name ?? t.run.id)}</strong> (${esc(date(t.run.at))}).` : 'No finished automated run yet, so no results are shown. Counts show how many cases belong to each group.';
  const info = `<div class="info-strip tree-info">${icon('info')}<div><strong>This tree is read-only.</strong><p>${runLine} To change the groups, edit the file <code>${esc(t.file ?? 'tree.json')}</code>.</p></div></div>`;
  const sel = state.treeNode ? t.tree.nodes.find(n => n.id === state.treeNode) : null;
  const byId = Object.fromEntries((state.cases ?? []).map(c => [c.id, c]));
  const casesPanel = (title, ids, id) => `<div class="panel tree-cases" ${id ? `id="${id}"` : ''}><div class="panel-heading"><h2>${esc(title)}</h2><span class="tiny muted">${ids.length} case${ids.length === 1 ? '' : 's'}</span></div>${ids.length ? `<ul class="tree-case-list">${ids.map(cid => `<li><span class="case-id">${esc(cid)}</span> ${esc(byId[cid]?.title ?? '')}</li>`).join('')}</ul>` : empty('No cases', 'No case belongs directly here.')}</div>`;
  const unassigned = t.unassigned ?? [];
  const toolbar = `<div class="toolbar"><label class="checkbox-label"><input type="checkbox" id="tree-show-empty" data-change="tree-show-empty" ${showEmpty ? 'checked' : ''}> Show empty groups</label><span class="tiny muted tree-legend">Counts: <span class="tc total">total</span> <span class="tc pass">passed</span> <span class="tc fail">failed</span> <span class="tc blocked">blocked</span> <span class="tc none">no result</span></span></div>`;
  const side = (sel ? casesPanel(`Cases in ${sel.name}`, t.assigned[sel.id] ?? [], 'tree-selected-cases') : `<div class="panel tree-cases" id="tree-selected-cases">${empty('Select a group', 'Click a group in the tree to list the cases that belong directly to it.')}</div>`)
    + casesPanel('Unassigned cases', unassigned, 'tree-unassigned');
  return `${out}${info}${t.tree.note ? `<p class="tiny muted">${esc(t.tree.note)}</p>` : ''}${toolbar}<div class="tree-layout"><div class="panel tree-panel"><ul class="tree-root">${root ? nodeHtml(root, kids, t, showEmpty) : ''}</ul></div><div class="tree-side">${side}</div></div>`;
}
