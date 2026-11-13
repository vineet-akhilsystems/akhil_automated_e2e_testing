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
  const raw = String(new FormData(event.target).get('ai-daily-limit') ?? '').trim();
  if (raw === '') return toast('Enter a number. 0 means no limit.', true);
  try { const saved = await api('/api/ai/policy', 'PUT', { dailyJobLimit: Number(raw) }); paintAiPanel(saved); toast(saved.dailyJobLimit === 0 ? 'Daily limit removed: any number of AI jobs per day.' : `Daily limit saved: ${saved.dailyJobLimit} AI jobs per day.`); }
  catch (error) { toast(error.message, true); }
});
