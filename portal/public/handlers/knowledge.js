import { toast } from '../components/widgets.js';
import { saveKnowledgeLayer } from '../pages/knowledge.js';
import { renderPage } from '../router.js';
import { currentModule, state } from '../state.js';

document.addEventListener('click', async event => {
  const button = event.target?.closest?.('[data-action="knowledge-save"]');
  if (!button) return;
  try { button.disabled = true; await saveKnowledgeLayer(currentModule().id, button.dataset.layer); renderPage(); }
  catch (error) { toast(error.message, true); button.disabled = false; }
});

// Live character count, so the writer sees how much of the note the agent will actually read.
document.addEventListener('input', event => {
  const box = event.target;
  if (!box?.classList?.contains('knowledge-text')) return;
  const count = document.getElementById(`kn-count-${box.dataset.layer}`);
  if (count) count.textContent = `${box.value.length.toLocaleString()} characters (the agent reads roughly the first part; keep the most important points at the top)`;
});

// Reviewer pass on or off for the next analysis.
document.addEventListener('change', event => {
  if (event.target?.matches?.('[data-agent-critic]')) state.agentCritic = event.target.checked;
});
