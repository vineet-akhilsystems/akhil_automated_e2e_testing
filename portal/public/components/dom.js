

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paths = {
  check: '<path d="m5 12 4 4 10-10"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V4m0 16h16M8 15l4-5 4 2 4-7"/>', cases: '<path d="M8 4H5a1 1 0 0 0-1 1v15h15V5a1 1 0 0 0-1-1h-3"/><rect x="8" y="2" width="7" height="5" rx="1"/><path d="m8 12 1 1 2-2m2 1h3m-8 4h8"/>',
  play: '<path d="m9 5 11 7-11 7V5Z"/>', layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', back: '<path d="M19 12H5m5-5-5 5 5 5"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>', edit: '<path d="m15 3 6 6-12 12H3v-6L15 3Zm-3 3 6 6"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M15 4V2H2v13h2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
  sparkle: '<path d="m12 3 1.9 4.9L19 9.8l-5.1 1.9L12 16.6l-1.9-4.9L5 9.8l5.1-1.9L12 3Zm6.5 11 .9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3ZM6 15l.7 1.8 1.8.7-1.8.7L6 20l-.7-1.8-1.8-.7 1.8-.7L6 15Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>', server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.1M7 17.5h.1"/>', book: '<path d="M12 5c-3-2-6-2-10-1v16c4-1 7-1 10 1m0-16c3-2 6-2 10-1v16c-4-1-7-1-10 1V5Z"/>',
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.grid}</svg>`;
export const badge = (text, cls = '') => `<span class="badge ${esc(cls || String(text).toLowerCase().replace(/[^a-z-]/g, ''))}">${esc(text)}</span>`;
export const opts = (values, selected, empty) => `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ''}${values.map(v => { const [id, label] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}`;
export const date = v => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const isApproved = c => (c.reviewStatus ?? 'approved') === 'approved';
export const formatBytes = n => { n = Number(n) || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`; };
Object.assign(paths, {
  file: '<path d="M6 3h8l5 5v13H6V3Zm8 0v5h5"/>', video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', logout: '<path d="M10 4H5v16h5m4-12 4 4-4 4m4-4H9"/>', x: '<path d="m6 6 12 12M18 6 6 18"/>',
});
