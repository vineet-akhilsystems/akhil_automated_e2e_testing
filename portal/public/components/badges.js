import { badge, esc, icon } from './dom.js';
import { isPending } from '../pages/pipeline.js';
import { currentModule, state } from '../state.js';

// ---------------------------------------------------------------------------
// Intake, review queue, user administration and account dialogs.
// Everything here talks to the endpoints in docs/superpowers/specs/2026-11-09-module-intake-design.md.
// ---------------------------------------------------------------------------
const pendingCount = () => state.cases.filter(c => c.reviewStatus === 'draft').length;
export function reviewBadge(c) {
  if (c.reviewStatus === 'draft') return `${badge('Needs review', 'orange')}<span class="tiny muted">Cannot run until approved</span>`;
  if (c.reviewStatus === 'rejected') return `${badge('Rejected', 'fail')}<span class="tiny muted">Cannot run</span>`;
  return '';
}
export function pendingReviewNote() {
  const n = pendingCount(), m = currentModule();
  return n ? `<div class="warning review-note" role="status">${n} case${n === 1 ? ' is' : 's are'} waiting for review and cannot be run until approved. <a href="#/modules/${m.id}/review">Open the review queue</a></div>` : '';
}
export const humanKey = k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
export const normPct = v => { if (v && typeof v === 'object') v = v.total ? v.done / v.total : v.percent; v = Number(v); if (!Number.isFinite(v)) return 0; return Math.max(0, Math.min(100, Math.round(v <= 1 ? v * 100 : v))); };
export function downloadLink(href, label, cls = '') { return `<a class="button-link ${cls}" href="${esc(href)}" download>${icon('download')} ${esc(label)}</a>`; }

// ----- Intake -----
export function kindInfo(f) {
  const k = String(f.kind || '').toLowerCase(), n = String(f.name || '').toLowerCase(), t = String(f.type || '').toLowerCase();
  if (/video/.test(k + t) || /\.(mp4|webm|mov|mkv|avi|m4v)$/.test(n)) return ['video', 'Video'];
  if (/image/.test(k + t) || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return ['image', 'Image'];
  if (/sheet|excel|csv|table/.test(k + t) || /\.(xlsx?|csv|tsv)$/.test(n)) return ['table', 'Spreadsheet'];
  if (/pdf/.test(k + t) || n.endsWith('.pdf')) return ['file', 'PDF'];
  if (/doc|word/.test(k) || /\.docx?$/.test(n)) return ['file', 'Document'];
  if (/json/.test(k) || n.endsWith('.json')) return ['file', 'JSON'];
  return ['file', f.kind ? humanKey(f.kind) : 'File'];
}
export function extractBadge(f) {
  const isVideo = kindInfo(f)[0] === 'video';
  if (f.extract === 'ok') return badge(f.chars ? `Ready · ${Number(f.chars).toLocaleString()} characters` : 'Ready', 'green');
  if (f.extract === 'partial') return badge('Keyframes only · visuals not interpreted', 'orange');
  if (isPending(f)) return `<span class="badge purple extract-processing" role="status"><span class="spinner" aria-hidden="true"></span>Processing…</span>`;
  if (f.extract === 'unsupported') { const why = f.reason ?? f.extractReason ?? f.extractNote ?? f.note_extract; return `${badge('Unsupported', 'orange')}<div class="tiny muted">${esc(why || (isVideo ? 'Stored. Add a transcript or a document to use it.' : 'Stored only. The text could not be read.'))}</div>`; }
  if (f.extract === 'error') return badge('Could not read text', 'fail');
  return badge('Not read yet');
}
