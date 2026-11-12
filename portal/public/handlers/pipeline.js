import { api } from '../api.js';
import { $ } from '../components/dom.js';
import { toast } from '../components/widgets.js';
import { runKey, startAgent } from '../pages/agent.js';
import { afterRoute, paintReadiness, rdStore, refreshReadiness, retryAgent } from '../pages/pipeline.js';
import { renderPage } from '../router.js';
import { currentModule, state } from '../state.js';

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'rd-toggle') { state.rdCollapsed = !state.rdCollapsed; rdStore.set(state.rdCollapsed); paintReadiness(); }
    if (action === 'rd-go') { state.pendingScroll = button.dataset.scroll || ''; const href = button.dataset.href; if (location.hash === href) afterRoute(); else location.hash = href.slice(1); }
    if (action === 'notice-dismiss') { state.notices = state.notices.filter(n => String(n.id) !== id); renderPage(); }
    if (action === 'agent-retry') await retryAgent(button.dataset.kind, id);
    if (action === 'agent-force') { const kind = button.dataset.kind; delete state.agentInfo[runKey(currentModule().id, kind)]; await startAgent(kind, true); }
    if (action === 'setup-suggest') {
      const sugg = state.insights?.suggestedSetup ?? {}, m = currentModule();
      const draft = state.setupDraft[m.id] = { ...state.setupDraft[m.id], moduleUrl: sugg.moduleUrl ?? '', variants: Array.isArray(sugg.variants) ? sugg.variants.join(', ') : sugg.variants ?? '' };
      if (sugg.loginProfileId) draft.loginProfileId = sugg.loginProfileId;
      $('#setup-url').value = draft.moduleUrl; $('#setup-variants').value = draft.variants; if (draft.loginProfileId) $('#setup-profile').value = draft.loginProfileId;
      toast('Suggestion filled in. Check it, then confirm.');
    }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => {
  const el = event.target, m = state.route[0] === 'modules' && state.route[1] ? currentModule() : null; if (!m || !el.closest?.('#setup-form')) return;
  const d = state.setupDraft[m.id] ??= {};
  if (el.id === 'setup-url') d.moduleUrl = el.value; if (el.id === 'setup-variants') d.variants = el.value; if (el.id === 'setup-profile') d.loginProfileId = el.value;
});
document.addEventListener('change', event => { if (event.target.id === 'setup-profile') { const m = currentModule(); if (m) (state.setupDraft[m.id] ??= {}).loginProfileId = event.target.value; } });
document.addEventListener('submit', async event => {
  const form = event.target; if (form.id !== 'setup-form') return;
  event.preventDefault();
  const m = currentModule(), f = new FormData(form), button = $('button[type=submit]', form); if (button) button.disabled = true;
  try {
    const body = { moduleUrl: String(f.get('setup-url') ?? '').trim(), variants: String(f.get('setup-variants') ?? '').split(',').map(v => v.trim()).filter(Boolean), loginProfileId: f.get('setup-profile') || '' };
    const r = await api(`/api/modules/${m.id}/setup`, 'PUT', body);
    state.setup[m.id] = r?.setup ?? (r && typeof r === 'object' && 'moduleUrl' in r ? r : { ...body, confirmedBy: state.user?.displayName ?? state.user?.username, confirmedAt: new Date().toISOString() });
    delete state.setupDraft[m.id]; renderPage(); toast('Target setup confirmed.'); refreshReadiness(m.id).catch(() => {});
  } catch (error) { toast(error.message, true); }
  finally { if (button) button.disabled = false; }
});
