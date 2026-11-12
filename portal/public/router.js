import { api } from './api.js';
import { $ } from './components/dom.js';
import { loadAgent } from './pages/agent.js';
import { aiStudioPage } from './pages/ai-studio.js';
import { casesPage } from './pages/cases.js';
import { coveragePage } from './pages/coverage.js';
import { intakePage, loadIntake } from './pages/intake.js';
import { accessPage, loadMembers, membersPage } from './pages/members.js';
import { modulesPage, overviewPage } from './pages/modules.js';
import { afterRoute, loadPipeline } from './pages/pipeline.js';
import { reviewPage } from './pages/review.js';
import { runDetailPage, runsPage } from './pages/runs.js';
import { environmentsPage, researchPage, settingsPage } from './pages/settings.js';
import { sharedPage } from './pages/shared.js';
import { loadTeams, teamsPage } from './pages/teams.js';
import { usersPage } from './pages/users.js';
import { bootUrl, productName, shell } from './pages/workspace.js';
import { can, canManageAnywhere, canProduct, isAdmin } from './permissions.js';
import { currentModule, state } from './state.js';


export async function renderRoute() {
  if (!state.data) return;
  const generation = ++state.generation;
  state.route = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'modules').split('/');
  if (state.route[0] === 'modules' && state.route[1]) state.cases = await api(`/api/modules/${state.route[1]}/cases`);
  if (state.route[0] === 'modules' && state.route[2] === 'coverage' && state.data.capabilities?.coverage) state.coverage = await api(`/api/modules/${state.route[1]}/coverage?environmentId=${encodeURIComponent(state.coverageEnvironment ?? state.data.environments[0]?.id ?? '')}`);
  if (state.route[0] === 'runs' && state.route[1]) state.runDetail = await api(`/api/runs/${state.route[1]}`);
  if (state.route[0] === 'modules' && state.route[2] === 'intake') await loadIntake(state.route[1]);
  if (state.route[0] === 'modules' && (state.route[2] === 'intake' || state.route[2] === 'review')) loadAgent(state.route[1]);
  if (state.route[0] === 'users' && isAdmin()) { state.users = null; state.usersError = ''; try { const r = await api('/api/users'); state.users = Array.isArray(r) ? r : r.users ?? []; } catch (e) { state.usersError = e.message; } }
  if (state.route[0] === 'modules' && state.route[2] === 'members' && can('members.manage', state.route[1])) await loadMembers({ type: 'module', id: state.route[1], name: currentModule()?.name ?? state.route[1] });
  if (state.route[0] === 'access' && canProduct('members.manage')) await loadMembers({ type: 'product', id: state.productId, name: productName() });
  if (state.route[0] === 'teams' && canManageAnywhere()) await loadTeams();
  if (state.route[0] === 'modules' && state.route[1]) await loadPipeline(state.route[1], state.route[2]);
  if (generation !== state.generation) return;
  shell(); renderPage(); afterRoute();
}
export function renderPage() {
  const key = state.route[0];
  let page;
  if (key === 'modules') {
    if (state.route[1]) {
      const sub = state.route[2];
      page = sub === 'coverage' ? coveragePage()
           : sub === 'ai' ? aiStudioPage()
           : sub === 'intake' ? intakePage()
           : sub === 'review' ? reviewPage()
           : sub === 'members' ? membersPage()
           : casesPage();
    } else {
      page = modulesPage();
    }
  } else if (key === 'runs') {
    page = state.route[1] ? runDetailPage() : runsPage();
  } else {
    const pages = {
      overview: overviewPage,
      users: usersPage,
      teams: teamsPage,
      access: accessPage,
      shared: sharedPage,
      environments: environmentsPage,
      settings: settingsPage,
      research: researchPage
    };
    page = pages[key]?.() ?? modulesPage();
  }
  $('#main').innerHTML = page;
}
export async function reload() { state.data = await api(bootUrl()); state.product = state.data.product ?? state.product; await renderRoute(); }
