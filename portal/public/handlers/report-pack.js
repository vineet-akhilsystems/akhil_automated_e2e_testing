import { toast } from '../components/widgets.js';
import { applyPreset, applyQuickFilter, createPack, markCustom, scheduleEstimate, showReportPackDialog, stopPolling } from '../pages/report-pack.js';
import { state } from '../state.js';

// Report pack dialog: preset cards, live estimate, create and poll.
document.addEventListener('click', event => {
  const button = event.target?.closest?.('[data-action]');
  const action = button?.dataset.action;
  if (action === 'report-pack') showReportPackDialog(state.runDetail);
  if (action === 'pack-preset') applyPreset(button.dataset.preset);
  if (action === 'pack-quick') applyQuickFilter(button.dataset.quick);
});

// Checkboxes and the select report on 'change'; text boxes report on every keystroke ('input').
function edited(event) {
  const node = event.target;
  if (!node?.closest?.('#pack-form') || node.dataset.change !== 'pack-field') return;
  const typing = node.tagName === 'INPUT' && node.type === 'text';
  if ((event.type === 'input') !== typing) return;
  markCustom(); scheduleEstimate();
}
document.addEventListener('change', edited);
document.addEventListener('input', edited);

document.addEventListener('submit', async event => {
  if (event.target?.id !== 'pack-form') return;
  event.preventDefault(); // do not rely on main.js's generic submit handler running first
  try { await createPack(); } catch (error) { toast(error.message, true); }
});

// 'close' does not bubble, so listen in the capture phase to stop timers when the dialog goes away.
// A reopen fires this late with the new dialog already open, so only stop when it really is closed.
document.addEventListener('close', event => { if (event.target?.id === 'dialog' && !event.target.open) stopPolling(); }, true);
