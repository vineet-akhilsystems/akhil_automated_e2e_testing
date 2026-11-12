const fs = require('node:fs');
const path = require('node:path');

module.exports = class PortalReporter {
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
    value.wallMs = result.duration;
    value.startedAt = result.startTime?.toISOString?.();
    if (process.env.PORTAL_SHARD_INDEX !== undefined) value.shard = Number(process.env.PORTAL_SHARD_INDEX);
    value.evidenceWarnings = test.annotations.filter(a => a.type === 'evidence-warning').map(a => a.description);
    fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify(value) + '\n');
  }
};
