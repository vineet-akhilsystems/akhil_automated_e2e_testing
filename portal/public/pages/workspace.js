import { api } from '../api.js';
import { brandName } from '../boot.js';
import { closeDialog, showDialog } from '../components/dialogs.js';
import { $, badge, esc, icon } from '../components/dom.js';
import { empty, field, textArea } from '../components/widgets.js';
import { NO_ACCESS_TEXT, canManageAnywhere, canProduct, isAdmin, loadAccess, roleLabel } from '../permissions.js';
import { reload } from '../router.js';
import { state } from '../state.js';


// Product level: every screen shows one product's data. A 404 from /api/products (older server) means one implicit product.
const productStore = { get() { try { return localStorage.getItem('qa.product'); } catch { return null; } }, set(v) { try { localStorage.setItem('qa.product', v); } catch { /* choice is just not remembered */ } } };
export const bootUrl = () => `/api/bootstrap${state.productId ? `?product=${encodeURIComponent(state.productId)}` : ''}`;
export const productName = () => state.data?.product?.name ?? state.products?.find(p => p.id === state.productId)?.name ?? (state.productId ? state.productId : 'Augastam');
export async function loadProducts() {
  try { const r = await api('/api/products'); state.products = Array.isArray(r) ? r : r.products ?? []; state.productsLegacy = false; }
  catch (e) { if (e.status !== 404) throw e; state.products = [{ id: 'augastam', name: 'Augastam', description: 'Augastam EMR quality workspace', implicit: true }]; state.productsLegacy = true; }
}
export async function enterWorkspace(afterLogin) {
  await Promise.all([loadProducts(), loadAccess()]);
  const known = id => id && state.products.some(p => p.id === id);
  if (state.productsLegacy) return selectProduct(state.products[0].id, true);
  const remembered = state.productId ?? productStore.get();
  if (!afterLogin && known(remembered)) return selectProduct(remembered, true);
  // A shared deep link (e.g. a run or module URL) survives the picker; an explicit "Switch product" does not.
  state.pendingHash = /^#\/(modules\/|runs\/|runs$|shared|environments|settings|teams|access)/.test(location.hash) ? location.hash : '';
  showPicker();
}
export async function selectProduct(id, keepHash) {
  if (id !== state.productId) Object.assign(state, { cases: [], coverage: null, runDetail: null, area: '', moduleSearch: '', runStatus: '', runModule: '', runSearch: '', coverageEnvironment: undefined, intake: null, insights: null, users: null });
  state.selected.clear(); state.productId = id; productStore.set(id);
  const pending = state.pendingHash; state.pendingHash = '';
  if (!keepHash) history.replaceState(null, '', pending || '#/modules');
  await reload();
}
export function showPicker() {
  state.data = null; if ($('#dialog').open) closeDialog();
  const products = state.products ?? [], last = products.find(p => p.id === (productStore.get() ?? state.productId));
  const card = p => `<article class="module-card product-card${last?.id === p.id ? ' last' : ''}"><div class="flex between"><div class="module-icon">${icon('layers')}</div>${last?.id === p.id ? badge('Last used', 'green') : ''}</div><h2>${esc(p.name)}</h2><p class="product-desc">${esc(p.description || 'No description yet.')}</p><dl class="product-stats"><div><dt>Modules</dt><dd>${esc(p.moduleCount ?? 0)}</dd></div><div><dt>Runs</dt><dd>${esc(p.runCount ?? 0)}</dd></div><div><dt>Last run</dt><dd>${p.lastRunAt ? esc(new Date(p.lastRunAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) : 'No runs yet'}</dd></div></dl><button class="primary" data-action="open-product" data-id="${esc(p.id)}">Open ${esc(p.name)} ${icon('arrow')}</button>${!state.productsLegacy && state.access && canProduct('members.manage', p.id) ? `<button class="small" data-action="product-access" data-id="${esc(p.id)}" aria-label="Product access for ${esc(p.name)}">${icon('people')} Product access</button>` : ''}</article>`;
  $('#app').innerHTML = `<div class="picker-shell"><header class="picker-top"><div class="brand"><span class="brand-mark">${icon('check')}</span><span><strong>${esc(brandName())}</strong><small>TEST STUDIO</small></span></div>${userChip()}</header><main class="picker-main" id="main" tabindex="-1"><div class="eyebrow">Choose a product</div><h1>Which product do you want to test?</h1><p class="subtitle">Modules, test runs, shared data and login profiles are kept separately for each product.</p>${last ? `<div class="continue-strip"><span>Pick up where you left off.</span><button class="primary" data-action="open-product" data-id="${esc(last.id)}">Continue with ${esc(last.name)} ${icon('arrow')}</button></div>` : ''}${!products.length && !isAdmin() ? `<div class="panel" role="status">${empty('Nothing to open yet', NO_ACCESS_TEXT)}</div>` : ''}<div class="product-grid">${products.map(card).join('')}${isAdmin() && !state.productsLegacy ? `<button class="add-card product-add" data-action="new-product"><div class="module-icon">${icon('plus')}</div><strong>Add product</strong><span>Create a separate space for another application.</span></button>` : ''}</div></main></div>`;
  $('#main')?.focus({ preventScroll: true });
}
export function showProductDialog() {
  showDialog('Add product', 'A product keeps its own modules, runs, shared data and login profiles.', `<div class="form-grid single">${field('Product name', 'product-name', '', 'required maxlength="60" autocomplete="off"')}${textArea('Description', 'product-description', '', 'maxlength="300" rows="3"')}</div>`, 'product-form', 'Add product', true);
}
function userChip() {
  const u = state.user, initials = u ? String(u.displayName || u.username).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
  return `<div class="user-chip">${u ? `<span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="user-text"><strong>${esc(u.displayName || u.username)}</strong><small>${esc(roleLabel(u.role))}</small></span><button class="quiet small" data-action="change-password" title="Change password" aria-label="Change password">${icon('lock')}<span class="user-btn-text">Password</span></button>` : '<span class="badge">Internal workspace</span>'}<button class="quiet small" data-action="logout" title="Sign out" aria-label="Sign out">${icon('logout')}<span class="user-btn-text">Sign out</span></button></div>`;
}
export function shell() {
  const section = state.route[0] || 'modules';
  const links = [['overview', 'chart', 'Overview'], ['modules', 'grid', 'Module library'], ['runs', 'play', 'Test runs'], ['shared', 'layers', 'Shared data'], ['environments', 'server', 'Environments'], ...(state.access && canProduct('members.manage') ? [['access', 'lock', 'Product access']] : []), ...(state.access && canManageAnywhere() ? [['teams', 'people', 'Teams']] : []), ...(isAdmin() ? [['users', 'people', 'Users'], ['settings', 'settings', 'Settings']] : [])];
  $('#app').innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#/modules"><span class="brand-mark">${icon('check')}</span><span class="brand-text"><strong>${esc(brandName())}</strong><small>TEST STUDIO</small></span></a><div class="nav-label">Workspace</div><nav aria-label="Main navigation">${links.map(([id, name, label]) => `<a href="#/${id}" class="${section === id ? 'active' : ''}" ${section === id ? 'aria-current="page"' : ''}>${icon(name)}<span class="nav-text">${label}</span>${id === 'modules' ? `<span class="nav-count">${state.data.modules.length}</span>` : ''}${id === 'runs' && state.data.runs.some(r => ['queued', 'running'].includes(r.status)) ? `<span class="nav-count">${state.data.runs.filter(r => ['queued', 'running'].includes(r.status)).length}</span>` : ''}</a>`).join('')}</nav><div class="nav-label resources-label">Resources</div><nav><a href="#/research" class="${section === 'research' ? 'active' : ''}">${icon('book')}<span class="nav-text">Design & research</span></a></nav><div class="side-bottom"><div class="flex"><div class="avatar">${icon('check')}</div><div><strong>Built for your team</strong><div class="tiny muted">Business & quality</div></div></div><p class="tiny">One workspace. Every module.</p></div></aside><div class="content"><header class="topbar"><div class="breadcrumb">${esc(productName())} <span>/</span><strong>${esc(({ overview: 'Overview', modules: 'Module library', runs: 'Test runs', shared: 'Shared data', environments: 'Environments', settings: 'Settings', users: 'Users', teams: 'Teams', access: 'Product access', research: 'Design & research' })[section] ?? 'Module library')}</strong></div><div class="topbar-right"><span class="status-label"><span class="dot pulse"></span> Workspace online</span>${state.productsLegacy ? '' : `<button class="product-switch" data-action="switch-product" title="Switch product">${icon('layers')}<span class="product-switch-name">${esc(productName())}</span><span class="product-switch-label">Switch product</span></button>`}${userChip()}</div></header><main class="page" id="main" tabindex="-1"></main></div></div>`;
}
