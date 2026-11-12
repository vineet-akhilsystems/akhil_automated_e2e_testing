import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, HttpError, check } from './registry.mjs';
import { reportModel, TERMINAL } from './quality.mjs';

const pending = new Map();
// The renderer's time grows with the screenshots it embeds, so the limit does too:
// a run with no screenshots gets 90 s, a 1,000-screenshot run gets 90 s + 1,000 x 500 ms = 590 s.
// Measured: a 957-screenshot run (262 cases) renders in about 290 s, so this leaves about 2x headroom.
export const pdfTimeoutMs = screenshots => 90000 + 500 * Math.max(0, Number(screenshots) || 0);
const rendererFingerprint = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'portal/report_pdf.py'))).digest('hex');
export function generatePdf(run, runDir) {
  check(run.kind !== 'authentication', 'Application login runs do not have bug reports.', 409);
  check(TERMINAL.includes(run.status), 'Finish or close this run before downloading its final report.', 409);
  const model = reportModel(run), fingerprint = createHash('sha256').update(rendererFingerprint + JSON.stringify(model)).digest('hex');
  const key = `${runDir}:${fingerprint}`;
  if (pending.has(key)) return pending.get(key);
  const operation = (async () => {
    const directory = path.join(runDir, 'report'); fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `bug-report-${fingerprint.slice(0, 16)}.pdf`);
    if (fs.existsSync(target)) return target;
    const temporary = path.join(directory, `${randomUUID()}.pdf`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.env.PORTAL_PYTHON ?? 'python', [path.join(ROOT, 'portal/report_pdf.py'), '--output', temporary, '--assets-dir', runDir], { cwd: ROOT, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
        let diagnostic = '';
        let spawnFailed = false;
        const limitMs = pdfTimeoutMs(model.evidenceCounts?.totalScreenshots);
        const timer = setTimeout(() => {
          spawnFailed = true; // the close event that follows the kill is not a renderer failure
          child.kill();
          console.error(`PDF export timed out after ${Math.round(limitMs / 1000)} s (${model.evidenceCounts?.totalScreenshots ?? 0} screenshots) and was stopped.`);
          reject(new HttpError(503, 'PDF generation took too long. Try again or export Excel.'));
        }, limitMs);
        child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-6000); });
        child.once('error', () => { spawnFailed = true; clearTimeout(timer); reject(new HttpError(503, 'PDF export requires Python with ReportLab and Pillow. Install: python -m pip install -r portal/requirements-report.txt')); });
        child.once('close', code => {
          clearTimeout(timer);
          if (spawnFailed) return;
          if (code === 0) resolve();
          else { console.error('PDF export failed:', diagnostic); reject(new HttpError(503, 'The PDF could not be generated. Check report dependencies and the server log; Excel export is still available.')); }
        });
        child.stdin.on('error', () => { /* The close/error event reports a failed renderer. */ });
        child.stdin.end(JSON.stringify(model));
      });
      check(fs.existsSync(temporary) && fs.statSync(temporary).size > 100, 'PDF generation produced no document.', 503);
      fs.renameSync(temporary, target); return target;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  })();
  pending.set(key, operation);
  operation.finally(() => pending.delete(key)).catch(() => {});
  return operation;
}
