import { api } from '../api.js';
import { esc } from '../components/dom.js';
import { isAdmin } from '../permissions.js';

// Settings > AI usage (administrators). Plain language only: three presets and a daily limit. Model names are an internal detail.
export const fmtTokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? 0);
export const usageText = job => job?.usage ? ` Used ${esc(job.usage.model)}: ${fmtTokens(job.usage.inputTokens)} in, ${fmtTokens(job.usage.outputTokens)} out.` : (job?.plan ? ` Model: ${esc(job.plan.model)} (${esc(job.plan.preset)}).` : '');

export const aiPanelShell = () => isAdmin() ? '<div class="panel ai-panel" id="ai-panel"><p class="muted">Loading AI settings…</p></div>' : '';

export function paintAiPanel(p) {
  const node = document.getElementById('ai-panel'); if (!node) return;
  const u = p.usage, models = Object.entries(u.byModel ?? {});
  node.innerHTML = `<h2>AI usage and quality</h2>
    <p class="form-help">Choose how much the AI reads and how much it may spend. Each job automatically uses the lightest model that can do it well, and stops after a fixed number of steps.</p>
    <div class="ai-presets" role="radiogroup" aria-label="AI quality">${p.presets.map(x => `<label class="ai-preset${x.id === p.preset ? ' selected' : ''}"><input type="radio" name="ai-preset" value="${esc(x.id)}" ${x.id === p.preset ? 'checked' : ''}><span><strong>${esc(x.label)}${x.id === 'balanced' ? ' (recommended)' : ''}</strong><small>${esc(x.blurb)}</small></span></label>`).join('')}</div>
    <form id="ai-limit-form" class="flex ai-limit"><label for="ai-daily-limit">Most AI jobs per day</label><input id="ai-daily-limit" name="ai-daily-limit" type="number" min="0" max="1000" step="1" value="${Number(p.dailyJobLimit)}"><button class="small" type="submit">Save limit</button><span class="tiny muted">0 means no limit. Today: ${Number(u.today)} job${u.today === 1 ? '' : 's'}.</span></form>
    <h3>Last ${Number(u.days)} days</h3>
    <p>${Number(u.jobs)} job${u.jobs === 1 ? '' : 's'} · ${fmtTokens(u.inputTokens)} tokens read · ${fmtTokens(u.outputTokens)} tokens written${u.costUsd ? ` · about $${Number(u.costUsd).toFixed(2)} at list price (for comparison; subscriptions are not billed per token)` : ''}</p>
    ${models.length ? `<ul class="ai-models">${models.map(([name, m]) => `<li><strong>${esc(name)}</strong>: ${m.jobs} job${m.jobs === 1 ? '' : 's'}, ${fmtTokens(m.inputTokens)} in / ${fmtTokens(m.outputTokens)} out</li>`).join('')}</ul>` : '<p class="muted">No AI jobs have run yet.</p>'}
    ${u.recent.length ? `<details><summary>Recent jobs</summary><ul class="ai-recent">${u.recent.map(j => `<li>${esc(String(j.startedAt).slice(0, 16).replace('T', ' '))} · ${esc(j.moduleId)} · ${j.kind === 'automation' ? 'automation proposal' : 'analysis'} · ${esc(j.modelLabel ?? '-')} · ${fmtTokens(j.inputTokens)} in · ${esc(j.status)}</li>`).join('')}</ul></details>` : ''}`;
}

export async function loadAiPanel() {
  const node = document.getElementById('ai-panel'); if (!node) return;
  try { paintAiPanel(await api('/api/ai/policy')); }
  catch (e) { node.innerHTML = `<h2>AI usage and quality</h2><p class="form-help">${esc(e.message)}</p>`; }
}
