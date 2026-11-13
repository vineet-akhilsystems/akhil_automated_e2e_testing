import { api } from '../api.js';
import { toast } from '../components/widgets.js';
import { loadAiPanel, paintAiPanel } from '../pages/ai-settings.js';

// Settings > AI usage: choosing a preset or saving the daily limit saves straight away.
document.addEventListener('change', async event => {
  const input = event.target;
  if (!input?.matches?.('input[name="ai-preset"]')) return;
  try { paintAiPanel(await api('/api/ai/policy', 'PUT', { preset: input.value })); toast('AI quality updated.'); }
  catch (error) { toast(error.message, true); loadAiPanel(); }
});
document.addEventListener('submit', async event => {
  if (event.target?.id !== 'ai-limit-form') return;
  event.preventDefault();
  try { paintAiPanel(await api('/api/ai/policy', 'PUT', { dailyJobLimit: Number(new FormData(event.target).get('ai-daily-limit')) })); toast('Daily limit saved.'); }
  catch (error) { toast(error.message, true); }
});
