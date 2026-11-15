// Report pack: the selected reports, evidence files, run data, README and MANIFEST in one ZIP.
// Every text comes from the redacted report model; evidence files are streamed from disk, never buffered.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { check } from '../registry.mjs';
import { reportModel, safeReportText, TERMINAL } from '../quality.mjs';
import { applyFilter, normalizeFilter, isOpenFailure } from './filter.mjs';
import { buildSummary } from './summary.mjs';
import { jiraCsv } from './csv.mjs';
import { executionLogWorkbook, defectWorkbook } from './xlsx.mjs';
import { summaryMarkdown, VERDICT_LABEL } from './markdown.mjs';
import { redactRun } from './redact.mjs';
import { toJunit } from '../compare.mjs';
import { generatePdf, rendererFingerprint } from '../pdf-report.mjs';
import { zipStream } from '../zip.mjs';

export const REPORTS = {
  summary: { label: 'Release summary', files: ['01-Release-Summary.pdf', '01-Release-Summary.md'] },
  bugs: { label: 'Bug report', files: ['02-Bug-Report.pdf', '02-Bugs.xlsx', '02-Bugs-for-Jira.csv'] },
  log: { label: 'Execution log', files: ['03-Execution-Log.xlsx'] },
};
/** The pack layout version. Raise it when the files or their content change, so cached packs are rebuilt. */
export const PACK_FORMAT = 1;
export const EVIDENCE = ['none', 'findings', 'final', 'all'];
const EVIDENCE_TEXT = {
  none: 'no screenshots', findings: 'all screenshots of the listed findings',
  final: 'all screenshots of the listed findings, plus the final screenshot of every other listed case', all: 'every screenshot of every listed case',
};
const FILE_TEXT = {
  '01-Release-Summary.pdf': 'One-page release summary with the suggested verdict', '01-Release-Summary.md': 'The same summary as Markdown, for chat or email',
  '02-Bug-Report.pdf': 'Listed findings with steps, expected and actual results and screenshots', '02-Bugs.xlsx': 'Defect register (Bugs and Needs review sheets) with captured inputs and evidence links',
  '02-Bugs-for-Jira.csv': 'Failed assertions and business-rule reviews in Jira CSV import format, with steps and inputs (quarantined ones left out)', '03-Execution-Log.xlsx': 'One row per listed case, with evidence links',
};
const MAX_SEGMENT = 60;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A file or folder name made of letters, digits, '-', '_' and '.', with no leading dot and at most 60 characters.
 * Pass a Set to make names unique (compared case-insensitively): repeats get -2, -3, ... */
export function safeSegment(text, taken) {
  let base = String(text ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'item';
  if (RESERVED.test(base)) base = `_${base}`;
  const fit = (s, suffix = '') => s.slice(0, MAX_SEGMENT - suffix.length).replace(/[.-]+$/, '') + suffix;
  let out = fit(base);
  if (!taken) return out;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = fit(base, `-${n}`);
  taken.add(out.toLowerCase());
  return out;
}

/** Validates a pack request: reports a non-empty subset of REPORTS keys, evidence one of EVIDENCE, filter normalized. */
export function normalizeRequest(raw) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), 'A report pack request is required.');
  check(Array.isArray(raw.reports) && raw.reports.length > 0 && raw.reports.every(k => typeof k === 'string' && Object.hasOwn(REPORTS, k)),
    `Choose at least one report: ${Object.keys(REPORTS).join(', ')}.`);
  check(typeof raw.evidence === 'string' && EVIDENCE.includes(raw.evidence), `Evidence must be one of: ${EVIDENCE.join(', ')}.`);
  return { reports: Object.keys(REPORTS).filter(k => raw.reports.includes(k)), filter: normalizeFilter(raw.filter), evidence: raw.evidence };
}

// Cached by model and renderer: a new pack layout (PACK_FORMAT) or a changed PDF renderer gives a new fingerprint.
const fingerprintOf = (model, req, { format = PACK_FORMAT, renderer = rendererFingerprint } = {}) => createHash('sha256')
  .update(JSON.stringify({ format, renderer })).update(JSON.stringify(model)).update(JSON.stringify(req)).digest('hex');
/** Identifies a pack's content: the pack format, the PDF renderer, the run's report model and the normalized request.
 * `versions` ({ format, renderer }) overrides the current ones (tests). */
export function packFingerprint(run, req, versions) {
  return fingerprintOf(reportModel(run), normalizeRequest(req), versions);
}

function assertReportable(run) {
  check(run?.kind !== 'authentication', 'Application login runs do not have report packs.', 409);
  check(TERMINAL.includes(run?.status), 'Finish or close this run before building a report pack.', 409);
  check(Array.isArray(run?.results) && run.results.length > 0, 'This run has no results to report.', 409);
}

function prepare(run, rawReq, previous) {
  assertReportable(run);
  const req = normalizeRequest(rawReq);
  const model = reportModel(run);
  const prevModel = previous ? reportModel(previous) : null;
  // Same definition of a failure as the summary comparison (isOpenFailure), so both agree on what is new.
  const ctx = req.filter.newFailuresOnly && prevModel ? { previousFailedIds: new Set(prevModel.cases.filter(isOpenFailure).map(r => r.id)) } : {};
  const note = req.filter.newFailuresOnly && !prevModel ? NO_PREVIOUS : undefined;
  return { req, model, prevModel, note, listing: applyFilter(model, req.filter, ctx) };
}
const NO_PREVIOUS = 'No previous run to compare with; every failure counts as new.';

const images = attachments => (attachments ?? []).filter(a => String(a?.contentType ?? '').startsWith('image/'));
// 'final': a listed finding keeps all its screenshots; any other listed case keeps the one named like "Final result", else its last.
function chooseEvidence(listing, level) {
  if (level === 'none') return [];
  if (level === 'findings') return listing.findings.map(f => ({ id: f.caseId, shots: images(f.attachments) }));
  return listing.cases.map(r => {
    const all = images(r.attachments);
    if (level === 'all' || r.findingKind || !all.length) return { id: r.id, shots: all };
    return { id: r.id, shots: [all.find(a => /final result/i.test(String(a.name ?? ''))) ?? all.at(-1)] };
  });
}

// Resolves an attachment path to a regular file inside the run folder (after following links), or explains why not.
function locate(root, realRoot, relative) {
  if (!realRoot || typeof relative !== 'string' || !relative) return { reason: 'file not found' };
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) return { reason: 'outside the run folder' };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { reason: 'file not found' };
    if (!fs.realpathSync(target).startsWith(realRoot + path.sep)) return { reason: 'outside the run folder' };
    return { file: target, size: stat.size };
  } catch { return { reason: 'file not found' }; }
}

const stageOf = name => String(name ?? '').replace(/\.(png|jpe?g|gif|webp)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'screenshot';
const extOf = file => (/\.(png|jpe?g|gif|webp)$/i.exec(String(file ?? ''))?.[0] ?? '.png').toLowerCase();

/** The evidence files for a listing: zip entries (streamed from disk), missing ones, and the first entry per case for Excel links. */
function planEvidence(listing, level, runDir) {
  const taken = new Set(), entries = [], missing = [], links = Object.create(null), located = new Map();
  const root = runDir ? path.resolve(runDir) : null;
  let realRoot = null;
  try { realRoot = root && fs.realpathSync(root); } catch { /* no run folder: every file is missing */ }
  let selected = 0, bytes = 0;
  for (const { id, shots } of chooseEvidence(listing, level)) {
    if (!shots.length) continue;
    const folder = safeSegment(id, taken); // one folder per listed occurrence, so repeated case ids never share entry names
    shots.forEach((a, i) => {
      selected++;
      if (!located.has(a.path)) located.set(a.path, locate(root, realRoot, a.path));
      const found = located.get(a.path);
      if (!found.file) { missing.push(`${safeReportText(id)}: ${safeReportText(a.path || a.name || 'screenshot')} (${found.reason})`); return; }
      const name = `evidence/${folder}/${i + 1}-${stageOf(a.name)}${extOf(a.path)}`;
      entries.push({ name, file: found.file, size: found.size });
      bytes += found.size;
      links[id] ??= name;
    });
  }
  return { entries, missing, links, selected, bytes };
}

// The zip writer has no zip64: stay under 65,535 entries and 4 GB (reports and headers get a 256 MB margin).
const checkSize = plan => check(plan.entries.length < 65000 && plan.bytes < 0xF0000000,
  'This pack is too large for one ZIP file. Choose fewer cases or a lower evidence level.', 413);

const pdfScreenshots = (req, listing) => (req.reports.includes('bugs') ? listing.findings.reduce((n, f) => n + images(f.attachments).length, 0) : 0);

/** A cheap preview of a pack: no rendering, no image reads (file sizes from fs.statSync only).
 * Throws the same HttpError(413) as buildPack when the pack would be too large for one ZIP. */
export function estimatePack(run, rawReq, { runDir, previous } = {}) {
  const { req, listing, note } = prepare(run, rawReq, previous);
  const plan = planEvidence(listing, req.evidence, runDir);
  checkSize(plan);
  const seconds = 5 + 0.5 * pdfScreenshots(req, listing) + 0.01 * listing.cases.length;
  return { cases: listing.cases.length, findings: listing.findings.length, screenshots: plan.selected, bytes: plan.bytes, seconds: Math.round(seconds * 100) / 100, ...(note ? { note } : {}) };
}

const KIND_ORDER = { failure: 0, assumption: 1, execution: 2, blocked: 3 };
const byCaseId = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** The bug report's order: failed assertions, business-rule reviews, execution issues, then blocked cases; by case id inside a kind. */
export const bugReportOrder = findings => [...findings].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || byCaseId.compare(String(a.caseId), String(b.caseId)));

const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const sha256File = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

function readme({ model, listing, summary, req, files, plan, who, generatedAt, note }) {
  const t = safeReportText, run = model.run;
  const lines = [model.title, '', `Report pack for run "${run.name}" (${run.id})`, `Module: ${run.module}`, `Environment: ${run.environment}`, `Run status: ${run.status}`, `Version: ${run.version?.text ?? 'version unknown'}`,
    `Generated: ${generatedAt} by ${who}`, '', 'WHAT IS INSIDE', '', '- 00-README.txt: this file'];
  for (const f of files) lines.push(`- ${f}: ${FILE_TEXT[f]}`);
  if (req.evidence !== 'none') lines.push(`- evidence/: ${EVIDENCE_TEXT[req.evidence]} (${plan.entries.length} file(s)), one folder per case`);
  lines.push('- data/results.json: the whole run\'s recorded results, with secrets removed', '- data/junit.xml: the whole run as JUnit XML for CI tools',
    '- MANIFEST.json: every other file with its size and SHA-256 checksum, written last');
  if (plan.missing.length) lines.push('', `${plan.missing.length} screenshot file(s) could not be included; MANIFEST.json lists them under missingEvidence.`);
  lines.push('', 'FILTER USED', '', `Filter: ${t(listing.description)}`, `Listed: ${listing.shown} of ${listing.total} cases.`);
  if (note) lines.push(note);
  if (!listing.shown) lines.push('No cases match this filter. The report files list no cases; the totals below still cover the whole run.');
  lines.push('', 'TOTALS (WHOLE RUN, UNFILTERED)', '', `cases: ${model.counts.total}`, ...Object.entries(model.totalsByClass).map(([k, v]) => `${k}: ${v}`));
  lines.push('', `Suggested verdict: ${VERDICT_LABEL[summary.verdict.value] ?? t(summary.verdict.value)}`,
    'Suggested verdict needs a person: it is worked out from the recorded results only, and a person must confirm it before any release decision.',
    '', 'HOW TO READ IT', '',
    '- Start with the release summary, then the bug report, then the execution log.',
    '- Totals always cover the whole run. When a filter is used, the report files list only the matching cases.',
    '- Not executed, skipped, blocked and observed cases are not passes. A pass does not prove untested requirements.',
    '- Severity is assessed separately from test priority.',
    '- To check that nothing changed, compare each file\'s SHA-256 checksum with MANIFEST.json.',
    '- Review screenshot contents before sharing outside the team.',
    '- This pack is a test record. It is not an approval and not an electronic signature.', '');
  return lines.join('\n');
}

/** Builds the pack ZIP in <runDir>/packs/ and returns its path, size and manifest. */
export async function buildPack({ run, runDir, req: rawReq, who, previous, now = () => new Date(), onProgress }) {
  const step = text => onProgress?.(text);
  step('Preparing the report data...');
  const { req, model, prevModel, listing, note } = prepare(run, rawReq, previous);
  const fingerprint = fingerprintOf(model, req);
  const date = now(), generatedAt = date.toISOString(), by = safeReportText(String(who || 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 200));
  // One summary from the whole run's totals, shared by the summary PDF/Markdown and the execution log.
  const summary = buildSummary(model, listing, prevModel ? { previous: prevModel } : {});
  const narrowed = mode => ({ ...model, cases: listing.cases, findings: mode === 'bugs' ? bugReportOrder(listing.findings) : listing.findings, report: { mode, filterNote: summary.filterNote }, summary });
  const plan = planEvidence(listing, req.evidence, runDir);
  checkSize(plan);

  const packs = path.join(runDir, 'packs');
  fs.mkdirSync(packs, { recursive: true });
  const work = path.join(packs, `.tmp-${randomUUID()}`);
  const temporary = path.join(packs, `.tmp-${randomUUID()}.zip`);
  // Every entry sits in one folder named like the ZIP (local date); manifest paths and Excel links are relative to it.
  const folder = `${safeSegment(safeReportText(run.module?.id ?? model.run.module))}_${localDate(date)}_run-${safeSegment(String(model.run.id).slice(0, 8))}`;
  const target = path.join(packs, `${folder}_${fingerprint.slice(0, 8)}.zip`);
  fs.mkdirSync(path.join(work, 'data'), { recursive: true });
  try {
    const files = [], sources = new Map();
    const put = (name, data) => { const file = path.join(work, name); fs.writeFileSync(file, data); sources.set(name, file); };
    if (req.reports.includes('summary')) {
      step('Building the release summary...');
      sources.set('01-Release-Summary.pdf', await generatePdf(run, runDir, { mode: 'summary', model: narrowed('summary') }));
      put('01-Release-Summary.md', summaryMarkdown(summary));
    }
    if (req.reports.includes('bugs')) {
      step('Building the bug report...');
      sources.set('02-Bug-Report.pdf', await generatePdf(run, runDir, { mode: 'bugs', model: narrowed('bugs') }));
      put('02-Bugs.xlsx', await defectWorkbook(model, listing, { evidenceLinks: plan.links }));
      put('02-Bugs-for-Jira.csv', jiraCsv(model, listing));
    }
    if (req.reports.includes('log')) {
      step('Building the execution log...');
      put('03-Execution-Log.xlsx', await executionLogWorkbook(model, listing, { evidenceLinks: plan.links, summary }));
    }
    for (const k of req.reports) files.push(...REPORTS[k].files);
    step('Adding the run data...');
    put('data/results.json', JSON.stringify(redactRun(run), null, 2));
    put('data/junit.xml', toJunit(run));
    put('00-README.txt', readme({ model, listing, summary, req, files, plan, who: by, generatedAt, note }));

    const entries = [];
    const add = (name, file) => entries.push({ name, file, size: fs.statSync(file).size });
    add('00-README.txt', sources.get('00-README.txt'));
    for (const f of files) add(f, sources.get(f));
    if (plan.entries.length) step('Collecting evidence...');
    entries.push(...plan.entries);
    add('data/results.json', sources.get('data/results.json'));
    add('data/junit.xml', sources.get('data/junit.xml'));

    step('Writing checksums...');
    const manifestFiles = [], digests = new Map(); // a file used by several entries is hashed once
    for (const e of entries) {
      if (!digests.has(e.file)) digests.set(e.file, await sha256File(e.file));
      manifestFiles.push({ path: e.name, bytes: e.size, sha256: digests.get(e.file) });
    }
    const manifest = { run: { id: model.run.id, name: model.run.name, module: model.run.module, environment: model.run.environment, status: model.run.status, version: model.run.version?.text ?? 'version unknown' },
      generatedAt, generatedBy: by, reports: req.reports, filter: redactRun(req.filter), filterDescription: safeReportText(listing.description),
      evidence: req.evidence, listed: listing.shown, total: listing.total, files: manifestFiles, missingEvidence: plan.missing, modelVersion: model.version };
    put('MANIFEST.json', JSON.stringify(manifest, null, 2));
    add('MANIFEST.json', sources.get('MANIFEST.json'));

    step('Writing the ZIP file...');
    await pipeline(zipStream(entries.map(e => ({ name: `${folder}/${e.name}`, file: e.file, size: e.size }))), fs.createWriteStream(temporary));
    fs.renameSync(temporary, target);
    step('Done.');
    return { file: target, size: fs.statSync(target).size, manifest };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(temporary, { force: true });
  }
}
