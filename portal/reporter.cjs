const fs = require('node:fs');
const path = require('node:path');

module.exports = class PortalReporter {
  // Earlier attempts of a retried test, so a pass-on-retry keeps the evidence of why the first attempt failed.
  attempts = new Map();
  onTestEnd(test, result) {
    const root = process.env.PORTAL_RUN_DIR;
    if (!root) return;
    // Shards write events under their own folder; attachment paths stay relative to the run folder the portal serves.
    const base = process.env.PORTAL_RUN_ROOT || root;
    const attachment = result.attachments.find(a => a.name.endsWith('-result.json') && a.body);
    const value = attachment ? JSON.parse(attachment.body.toString()) : {
      id: test.title.split(' ')[0], title: test.title, expected: '', actual: result.error?.message ?? result.status,
      status: result.status === 'skipped' ? 'SKIPPED' : 'ERROR', mismatches: [], durationMs: result.duration,
    };
    if (['timedOut', 'interrupted', 'failed'].includes(result.status) && value.status === 'PASS') value.status = 'ERROR';
    value.attachments = result.attachments.filter(a => a.path).map(a => ({
      name: a.name, path: path.relative(base, a.path).split(path.sep).join('/'), contentType: a.contentType,
    })).filter(a => !a.path.startsWith('../'));
    const a11y = result.attachments.find(a => a.name.endsWith('-a11y.json') && a.body);
    if (a11y) { try { value.accessibility = JSON.parse(a11y.body.toString()); } catch { /* a bad scan file is ignored */ } }
    try {
      // Hashes of the configuration this process saw: the first test's parts win, later tests only add parts it lacked.
      const prof = result.attachments.find(a => a.name === 'profile.json' && a.body);
      if (prof) {
        const file = path.join(root, 'profile.json'), next = JSON.parse(prof.body.toString());
        let current = null;
        try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no file yet */ }
        fs.writeFileSync(file, JSON.stringify({ parts: { ...(next.parts ?? {}), ...(current?.parts ?? {}) }, count: Math.max(current?.count ?? 0, next.count ?? 0) }));
      }
    } catch { /* profile capture never breaks reporting */ }
    value.wallMs = result.duration;
    const earlier = this.attempts.get(test.id) ?? [];
    earlier.push({ attempt: result.retry + 1, status: value.status, actual: String(value.actual ?? '').slice(0, 400), mismatches: (value.mismatches ?? []).slice(0, 5) });
    this.attempts.set(test.id, earlier);
    value.attempts = earlier.length;
    // Only a PASS that needed a retry is flaky; a case that failed every attempt is a real failure.
    if (earlier.length > 1) value.attemptHistory = earlier;
    if (earlier.length > 1 && value.status === 'PASS') value.flaky = true;
    value.startedAt = result.startTime?.toISOString?.();
    if (process.env.PORTAL_SHARD_INDEX !== undefined) value.shard = Number(process.env.PORTAL_SHARD_INDEX);
    value.evidenceWarnings = test.annotations.filter(a => a.type === 'evidence-warning').map(a => a.description);
    fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify(value) + '\n');
  }
};
