import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportModel } from '../quality.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'report_pdf.py');
const python = process.env.PORTAL_PYTHON ?? 'python';
const hasDeps = spawnSync(python, ['-c', 'import reportlab, PIL'], { stdio: 'ignore' }).status === 0;
const hasPypdf = hasDeps && spawnSync(python, ['-c', 'import pypdf'], { stdio: 'ignore' }).status === 0;

const module = { id: 'registration', name: 'Registration', area: 'Patient Care', adapter: 'registration', config: { bases: {} } };
const c = (id, extra = {}) => ({ id, version: 1, title: `Case ${id}`, mode: 'automated', enabled: true, priority: 'P1', category: 'Validation', action: 'fill', input: { mobile: '123' }, expected: { outcome: 'field-state' }, requirement: 'REQ-1', ...extra });
const cases = ['A-1', 'A-2', 'A-3', 'A-4'].map(id => c(id));
const results = [
  { id: 'A-1', status: 'PASS', expected: 'ok', actual: 'ok', attachments: [], durationMs: 1200 },
  { id: 'A-2', status: 'FAIL', expected: 'Mobile rejected', actual: 'Authorization: Bearer top-secret-token accepted', mismatches: ['accepted'], attachments: [], durationMs: 2500, resolvedInput: { mobile: '123', password: 'hunter2-private' } },
  { id: 'A-3', status: 'ERROR', expected: 'x', actual: 'timeout', attachments: [] },
];
const run = { id: 'run-12345678', name: 'Acceptance', kind: 'tests', environmentName: 'UAT', environmentUrl: 'https://example.test', module, mode: 'automated', cases, results, status: 'failed',
  createdAt: '2026-11-01T10:00:00Z', startedAt: '2026-11-01T10:00:05Z', finishedAt: '2026-11-01T10:01:10Z', workers: 4,
  triage: { 'A-2': { severity: 'High', owner: 'BA', reference: 'BUG-1', impact: 'Bad mobiles are accepted.' } }, reportDetails: { preparedBy: 'QA', build: '1.2.3' } };

function render(model, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-'))) {
  const output = path.join(dir, 'out.pdf');
  const result = spawnSync(python, [script, '--output', output, '--assets-dir', dir], { input: JSON.stringify(model), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { output, bytes: fs.readFileSync(output) };
}

test('bug report PDF has outline, internal links and page numbers', { skip: !hasDeps && 'reportlab/Pillow not installed' }, () => {
  const model = reportModel(run);
  const { output, bytes } = render(model);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  assert.match(bytes.toString('latin1'), /\/Outlines/);
  if (!hasPypdf) return;
  const check = `
import sys, json, pypdf
r = pypdf.PdfReader(sys.argv[1])
titles = []
def walk(o):
    for x in o:
        if isinstance(x, list): walk(x)
        else: titles.append((x.title, r.get_destination_page_number(x) + 1))
walk(r.outline)
links = 0; targets = set()
for i, pg in enumerate(r.pages):
    for a in pg.get('/Annots') or []:
        a = a.get_object()
        if a.get('/Subtype') == '/Link' and '/Dest' in a:
            links += 1; d = a['/Dest']; targets.add(r.get_page_number(d[0].get_object()) + 1 if isinstance(d, list) else -1)
print(json.dumps({'pages': len(r.pages), 'titles': titles, 'links': links, 'targets': sorted(t for t in targets)}))`;
  const out = spawnSync(python, ['-I', '-c', check, output], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const info = JSON.parse(out.stdout);
  const names = info.titles.map(t => t[0]);
  for (const expected of ['Summary', 'Index', 'Findings', 'Appendix: all cases']) assert.ok(names.includes(expected), `outline lacks ${expected}`);
  for (const f of model.findings) assert.ok(names.some(n => n.startsWith(f.id)), `outline lacks ${f.id}`);
  // Every finding is linked from the index and has a back-link; the appendix links every case.
  assert.ok(info.links >= model.findings.length * 3 + model.cases.length, `too few links: ${info.links}`);
  const indexPage = info.titles.find(t => t[0] === 'Index')[1];
  assert.ok(info.targets.includes(indexPage), 'no link points back to the index page');
});

test('bug report PDF stays redacted and still renders a clean run with no findings', { skip: !hasDeps && 'reportlab/Pillow not installed' }, () => {
  const model = reportModel(run);
  const { output } = render(model);
  if (hasPypdf) {
    const text = spawnSync(python, ['-I', '-c', 'import sys, pypdf; print("".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', output], { encoding: 'utf8' }).stdout;
    assert.ok(text.includes('BUG-A-2') && text.includes('[REDACTED]'));
    for (const secret of ['top-secret-token', 'hunter2-private']) assert.ok(!text.includes(secret));
  }
  const clean = reportModel({ ...run, cases: [cases[0]], results: [results[0]], status: 'passed', workers: undefined, startedAt: undefined });
  assert.equal(clean.findings.length, 0);
  assert.ok(render(clean).bytes.length > 1000);
});

test('bug report PDF embeds screenshots once as JPEG, splits tall ones and flags blank ones', { skip: !hasDeps && 'reportlab/Pillow not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-shots-'));
  fs.mkdirSync(path.join(dir, 'artifacts'));
  // A tall screenshot with visible content, a normal one, and an all-white one.
  const draw = `
import sys
from PIL import Image, ImageDraw
d = sys.argv[1]
for name, size in [('tall.png', (1600, 4000)), ('normal.png', (1600, 1132))]:
    im = Image.new('RGB', size, 'white'); g = ImageDraw.Draw(im)
    for y in range(0, size[1], 40): g.rectangle((40, y, 1500, y + 18), fill=(40, 60, 120))
    im.save(d + '/artifacts/' + name)
Image.new('RGB', (1600, 900), 'white').save(d + '/artifacts/blank.png')`;
  const made = spawnSync(python, ['-I', '-c', draw, dir], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const shot = name => ({ name, path: `artifacts/${name}`, contentType: 'image/png' });
  const shotResults = [
    { ...results[0], attachments: [shot('normal.png')] },
    { ...results[1], attachments: [shot('tall.png'), shot('blank.png')] },
  ];
  const model = reportModel({ ...run, cases: cases.slice(0, 2), results: shotResults });
  const { output, bytes } = render(model, dir);
  const raw = bytes.toString('latin1');
  assert.match(raw, /\/DCTDecode/, 'screenshots should be embedded as JPEG');
  assert.doesNotMatch(raw, /\/ASCII85Decode/, 'image streams should be binary');
  // normal.png = 1 slice, tall.png = 3 slices, blank.png is not embedded: 4 images, each written once.
  assert.equal((raw.match(/\/Subtype \/Image/g) ?? []).length, 4);
  if (!hasPypdf) return;
  const text = spawnSync(python, ['-I', '-c', 'import sys, pypdf; print("".join(p.extract_text() for p in pypdf.PdfReader(sys.argv[1]).pages))', output], { encoding: 'utf8' }).stdout;
  assert.ok(text.includes('tall.png - image 1 of 3') && text.includes('tall.png - image 3 of 3'), 'tall screenshot should be split into 3 labelled slices');
  assert.match(text, /blank\.png\)\s*contains\s*no\s*visible\s*UI/);
});
