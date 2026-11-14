import { api } from '../api.js';
import { toast } from '../components/widgets.js';
import { loadAlerts, loadSchedules, loadTickets } from '../pages/health.js';
import { reload } from '../router.js';
import { state } from '../state.js';

// Settings > Run alerts and Scheduled runs.
document.addEventListener('submit', async event => {
  const form = event.target;
  if (form?.id === 'alerts-form') {
    event.preventDefault();
    const data = new FormData(form), body = { when: data.get('when') };
    const url = String(data.get('webhookUrl') ?? '').trim();
    if (url) body.webhookUrl = url;
    try { await api('/api/notifications', 'PUT', body); toast('Run alerts saved.'); loadAlerts(); } catch (error) { toast(error.message, true); }
  }
  if (form?.id === 'tickets-form') {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form)), body = { provider: data.provider, token: data.token || undefined };
    for (const k of data.provider === 'github' ? ['repo'] : ['baseUrl', 'email', 'projectKey', 'issueType']) if (data[k]) body[k] = data[k];
    try { await api('/api/tickets/settings', 'PUT', body); toast('Defect ticket settings saved.'); loadTickets(); } catch (error) { toast(error.message, true); }
  }
  if (form?.id === 'schedule-form') {
    event.preventDefault();
    const data = new FormData(form);
    const body = { name: data.get('name'), moduleId: data.get('moduleId'), environmentId: data.get('environmentId'), time: data.get('time'), days: data.getAll('days').map(Number) };
    try { await api('/api/schedules', 'POST', body); toast('Schedule added.'); loadSchedules(); } catch (error) { toast(error.message, true); }
  }
});

document.addEventListener('click', async event => {
  const button = event.target?.closest?.('[data-action]');
  const action = button?.dataset.action;
  if (!['alert-test', 'alert-clear', 'schedule-toggle', 'schedule-delete', 'tickets-clear', 'create-ticket'].includes(action)) return;
  try {
    if (action === 'alert-test') { button.disabled = true; await api('/api/notifications/test', 'POST'); toast('Test alert sent. Check the channel.'); loadAlerts(); }
    if (action === 'alert-clear') { await api('/api/notifications', 'PUT', { clearWebhook: true }); toast('Webhook address removed.'); loadAlerts(); }
    if (action === 'schedule-toggle') { await api(`/api/schedules/${button.dataset.id}`, 'PUT', { enabled: button.dataset.enabled === '1' }); loadSchedules(); }
    if (action === 'tickets-clear') { await api('/api/tickets/settings', 'PUT', { provider: 'none' }); toast('Defect tickets turned off.'); loadTickets(); }
    if (action === 'create-ticket') {
      button.disabled = true;
      const made = await api(`/api/runs/${state.runDetail.id}/ticket`, 'POST', { caseId: button.dataset.id });
      toast(`Ticket ${made.key} created.`); await reload();
    }
    if (action === 'schedule-delete') { await api(`/api/schedules/${button.dataset.id}`, 'DELETE'); toast('Schedule deleted.'); loadSchedules(); }
  } catch (error) { toast(error.message, true); loadAlerts(); }
});

document.addEventListener('change', event => {
  if (event.target?.id !== 'tk-provider') return;
  for (const part of document.querySelectorAll('[data-tk]')) part.hidden = part.dataset.tk !== event.target.value;
});
