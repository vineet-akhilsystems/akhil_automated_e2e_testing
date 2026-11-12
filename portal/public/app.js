import { api } from './api.js';
import { start } from './boot.js';
import { $ } from './components/dom.js';
import { bootUrl } from './pages/workspace.js';
import { loadAccess } from './permissions.js';
import { renderPage, renderRoute } from './router.js';
import { state } from './state.js';
import './handlers/main.js';
import './handlers/agent.js';
import './handlers/drop.js';
import './handlers/access.js';
import './handlers/pipeline.js';

await start();
let accessTick = 0;
setInterval(async () => {
  if (!state.data || $('#dialog').open || document.activeElement?.matches('input,textarea,select')) return;
  try {
    const capabilities = state.data.capabilities;
    state.data = await api(bootUrl());
    // Someone may have added or removed this person (or an entry may have expired): refresh what they can do.
    if (++accessTick % 10 === 0 && state.access) {
      const before = JSON.stringify(state.access); await loadAccess();
      if (JSON.stringify(state.access) !== before) { await renderRoute(); return; }
    }
    if (!capabilities?.pdfReport && state.data.capabilities?.pdfReport) { location.reload(); return; }
    if (state.route[0] === 'runs' && state.route[1]) {
      const latest = await api(`/api/runs/${state.route[1]}`);
      if (JSON.stringify(latest) !== JSON.stringify(state.runDetail)) { state.runDetail = latest; renderPage(); }
    } else if (['overview', 'runs', 'environments', 'settings'].includes(state.route[0])) renderPage();
  } catch { /* A transient disconnect is retried on the next poll. */ }
}, 3000);
