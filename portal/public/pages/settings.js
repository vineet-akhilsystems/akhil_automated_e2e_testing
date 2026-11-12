import { showDialog } from '../components/dialogs.js';
import { badge, esc, icon } from '../components/dom.js';
import { empty, field, heading } from '../components/widgets.js';
import { productName } from './workspace.js';
import { can, isAdmin } from '../permissions.js';
import { state } from '../state.js';

export function settingsPage() {
  return heading(`${productName()} configuration`, 'Settings', 'Named application login profiles for developers, BAs and QA.', isAdmin() ?'<button class="primary" data-action="new-environment">'+icon('plus')+' Add login profile</button>' : '')
    + '<div class="info-strip">'+icon('info')+'<div><strong>Shared workspace profiles</strong><p>Give each team member or test role a separate profile. Everyone with workspace access can use these profiles; they are not private user accounts. Passwords are encrypted on the server and never returned to the browser.</p><p>The current adapter supports Augastam username/password login with tenant, facility and role. Other websites and SSO/OTP flows need a compatible automation adapter.</p></div></div>'
    + environmentsPage(true)
    + '<div class="panel settings-guide"><h2>Run automation from the UI</h2><ol><li>Add or edit a login profile here.</li><li>Refresh application login and wait for success.</li><li>Open Module library, choose a module with automation connected and Run cases.</li><li>Select Automated browser run, your profile and cases, then Create run.</li><li>Use Test runs to view progress, cancel a run and download results or evidence.</li></ol><a href="#/modules">Open Module library</a></div>';
}
export function showEnvironmentDialog(profile) {
  const login = profile?.login ?? {};
  showDialog(profile ? 'Edit login profile' : 'Add login profile', `Save a named ${productName()} test environment and application login. Saving requires a fresh login before tests can run.`,
    '<input type="hidden" name="profile-version" value="'+(profile?.version ?? 0)+'"><div class="form-grid">'
    + field('Profile ID', 'profile-id', profile?.id ?? '', 'required maxlength="80" pattern="[a-z0-9]+(-[a-z0-9]+)*" '+(profile ? 'readonly' : ''), 'Example: ba-uat or developer-demo')
    + field('Profile name', 'profile-name', profile?.name ?? '', 'required maxlength="120"')
    + field('Website URL', 'website-url', profile?.url ?? '', 'type="url" required maxlength="2000"', 'Website origin only, for example https://demo.augastam.com')
    + field('Username', 'login-username', login.username ?? '', 'required autocomplete="off" maxlength="1000"')
    + field('Password', 'login-password', '', 'type="password" autocomplete="new-password" maxlength="1000" '+(profile?.passwordSaved ? 'placeholder="Saved password configured"' : 'required'), profile?.passwordSaved ? 'Your saved password is configured and hidden. Leave blank to keep it for the same website. Enter a password when changing the website.' : 'Stored encrypted on the portal server; never included in run snapshots.')
    + field('Tenant', 'login-tenant', login.tenant ?? '', 'required maxlength="1000"')
    + field('Facility', 'login-facility', login.facility ?? '', 'required maxlength="1000"')
    + field('Application role', 'login-role', login.role ?? '', 'required maxlength="1000"')
    + '</div><p class="form-help">Profiles are shared within this workspace. Editing a profile is blocked while it has queued or running jobs. Saving invalidates its prior session.</p>', 'environment-form', 'Save login profile');
}
export function environmentsPage(cardsOnly = false) {
  return (cardsOnly ? '' : heading('Execution settings', 'Environments', 'Choose where your tests run and check the application’s saved login session.'))
    + `${state.data.environments.length ? '' : `<div class="panel">${empty(`No login profiles yet in ${productName()}`, isAdmin() ? 'Add a login profile in Settings to run automated checks.' : 'Ask an administrator to add a login profile.', isAdmin() ? '<a class="button-link" href="#/settings">Open Settings</a>' : '')}</div>`}<div class="module-grid">${state.data.environments.map(e => `<article class="panel environment-card"><div class="flex between"><span class="module-icon">${icon('server')}</span>${badge(e.session === 'saved' ? 'Session saved' : e.session === 'expired' ? 'Login expired' : 'Login required', e.session === 'saved' ? 'green' : 'orange')}</div><h2 class="environment-title">${esc(e.name)}</h2><div class="environment-url">${esc(e.url)}</div>${e.passwordSaved ? '<p class="tiny muted">Password configured (hidden)</p>' : ''}${e.login?.username ? `<p class="tiny muted">Account: ${esc(e.login.username)}<br>Tenant: ${esc(e.login.tenant)} | Facility: ${esc(e.login.facility)} | Role: ${esc(e.login.role)}</p>` : ''}<p>${e.session === 'saved' ? 'A saved session is available. Application access is verified when the browser opens.' : 'Refresh the application login before running automated checks.'}</p>${can('run.start') ? `<button class="small" data-action="refresh-auth" data-id="${e.id}" ${!e.loginConfigured ? 'disabled' : ''}>${icon('play')} Refresh application login</button>` : ''}${isAdmin() ? `<button class="small quiet" data-action="edit-environment" data-id="${e.id}">Edit login settings</button>` : ''}${!e.loginConfigured ? '<p class="form-help">Add application credentials in Settings to enable login refresh.</p>' : ''}</article>`).join('')}</div><div class="info-strip">${icon('info')}<div><strong>One environment, one application session</strong><p>Browser sessions stay on the server. Login refreshes share the execution queue, so they cannot overwrite a session while another test run is active.</p></div></div><p class="form-help">Manage website URLs and application credentials in Settings. Choose a named profile when creating a run.</p>`;
}
export function researchPage() {
  const sources = [
    ['TestRail', 'A reusable case repository, separate executions, and preserved historical runs.', 'Our module repositories and immutable run snapshots follow this separation.', 'https://support.testrail.com/hc/en-us/articles/7076810203028-Introduction-to-TestRail'],
    ['Testmo', 'Folder-based case selection, filters and separate run configurations.', 'Our suite filters, explicit selection and environment picker keep execution deliberate.', 'https://support.testmo.com/hc/en-us/articles/47544002336653-Test-Runs'],
    ['Qase', 'Shared steps keep recurring setup workflows consistent across cases.', 'Our shared data templates reuse a valid starting state. Shared executable step libraries remain a future extension.', 'https://docs.qase.io/en/articles/5563709-shared-steps'],
    ['Tricentis Tosca', 'Test steps are built from the attributes of a connected module.', 'Our editor gets available fields and actions from an adapter registry, rather than hard-coding one module into the UI.', 'https://docs.tricentis.com/tosca-2026.1/en-us/content/tosca_commander/teststep_from_module.htm'],
    ['Xray', 'Repository organization, manual/automated test types, requirement references and execution history.', 'Cases include requirement references and manual steps; execution capability is shown per module.', 'https://docs.getxray.app/space/XRAYCLOUD/44579728/Tips%2Bfor%2Ba%2Bsuccessful%2Bmigration%2Bpath%2Bfrom%2BqTest%2Bto%2BXray'],
    ['Playwright', 'Custom reporters expose results for integration into an application.', 'The existing browser runner reports directly to the portal, with separate artifacts for each run.', 'https://playwright.dev/docs/test-reporters'],
  ];
  return heading('Research-informed design', 'Familiar patterns. Your workflow.', 'Product patterns adapted from official documentation, reviewed on 1 November 2026.')
    + `<div class="research-grid">${sources.map(([name, pattern, decision, url]) => `<article class="panel research-card"><h3>${name}</h3><p>${esc(pattern)}</p><p>${esc(decision)}</p><a href="${url}" target="_blank" rel="noopener">Read the official documentation ↗</a></article>`).join('')}</div><div class="info-strip">${icon('grid')}<div><strong>Application → business area → module → suite → case → execution</strong><p>The workspace can grow across Setup, Patient Care, Operations and custom business areas. Module definitions and automation capabilities are separate, so new modules do not require redesigning the portal.</p></div></div>`;
}
