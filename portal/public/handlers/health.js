import { api } from '../api.js';
import { toast } from '../components/widgets.js';
import { loadAlerts, loadSchedules } from '../pages/health.js';

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
  if (!['alert-test', 'alert-clear', 'schedule-toggle', 'schedule-delete'].includes(action)) return;
  try {
    if (action === 'alert-test') { button.disabled = true; await api('/api/notifications/test', 'POST'); toast('Test alert sent. Check the channel.'); loadAlerts(); }
    if (action === 'alert-clear') { await api('/api/notifications', 'PUT', { clearWebhook: true }); toast('Webhook address removed.'); loadAlerts(); }
    if (action === 'schedule-toggle') { await api(`/api/schedules/${button.dataset.id}`, 'PUT', { enabled: button.dataset.enabled === '1' }); loadSchedules(); }
    if (action === 'schedule-delete') { await api(`/api/schedules/${button.dataset.id}`, 'DELETE'); toast('Schedule deleted.'); loadSchedules(); }
  } catch (error) { toast(error.message, true); loadAlerts(); }
});
