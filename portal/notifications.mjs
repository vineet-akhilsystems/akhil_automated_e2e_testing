import { check, textValue } from './registry.mjs';

// Run-finished alerts: one webhook (Slack, Teams, or any URL that accepts JSON) plus a rule for when to send.
// The URL is a secret (Slack/Teams URLs authorize posting), so it is stored server-side and never returned to the browser.
const KEY = 'notifications';
export const WHEN = { failures: 'Only when a run has failures, errors or flaky cases', always: 'After every automated run', never: 'Never (alerts off)' };

export function createNotifications(store, { fetchImpl = globalThis.fetch, logger = null, baseUrl = () => '' } = {}) {
  const read = () => { try { return JSON.parse(store.db.prepare('SELECT value FROM meta WHERE key=?').get(KEY)?.value ?? '{}'); } catch { return {}; } };
  const write = value => store.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(value));
  const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
  const publicView = s => ({ configured: Boolean(s.webhookUrl), host: hostOf(s.webhookUrl), when: s.when ?? 'failures', lastSentAt: s.lastSentAt ?? null, lastResult: s.lastResult ?? null });

  function save(body) {
    const current = read(), next = { ...current };
    if (body.when !== undefined) { check(Object.hasOwn(WHEN, body.when), 'Choose when to send alerts.'); next.when = body.when; }
    if (body.clearWebhook === true) delete next.webhookUrl;
    else if (typeof body.webhookUrl === 'string' && body.webhookUrl.trim()) {
      const url = textValue(body.webhookUrl.trim(), 'Webhook URL', 2000, true);
      let parsed;
      try { parsed = new URL(url); } catch { check(false, 'Enter a full web address that starts with https://'); }
      check(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, 'The webhook must be an http or https address without a username or password.');
      next.webhookUrl = url;
    }
    write(next);
    return publicView(next);
  }

  /** Short, human text plus a structured payload. `text` works for Slack and Teams; other receivers can read `run`. */
  function message(run) {
    const counts = { passed: 0, failed: 0, errors: 0, flaky: 0 };
    for (const r of run.results ?? []) {
      if (r.status === 'PASS') counts.passed++;
      else if (r.status === 'ERROR') counts.errors++;
      else if (['FAIL', 'FAIL (assumed requirement)'].includes(r.status)) counts.failed++;
      if (r.flaky) counts.flaky++;
    }
    const verdict = { passed: 'PASSED', failed: 'FAILED', error: 'ERROR', blocked: 'BLOCKED' }[run.status] ?? String(run.status).toUpperCase();
    const link = baseUrl() ? `${baseUrl()}/#/runs/${run.id}` : '';
    const bad = (run.results ?? []).filter(r => ['FAIL', 'FAIL (assumed requirement)', 'ERROR'].includes(r.status)).slice(0, 5).map(r => `${r.id} ${r.title ?? ''}`.trim());
    const text = [`Test run ${verdict}: ${run.name}`,
      `${run.module?.name ?? run.module?.id} on ${run.environmentName ?? 'environment'}: ${counts.passed} passed, ${counts.failed} failed, ${counts.errors} errors${counts.flaky ? `, ${counts.flaky} flaky (passed only on retry)` : ''}`,
      ...(bad.length ? ['Needs attention: ' + bad.join('; ')] : []), ...(link ? [link] : [])].join('\n');
    return { text, run: { id: run.id, name: run.name, status: run.status, module: run.module?.id, environment: run.environmentName, ...counts, link, finishedAt: run.finishedAt } };
  }

  const shouldSend = (settings, run) => {
    if (!settings.webhookUrl || (settings.when ?? 'failures') === 'never') return false;
    if (settings.when === 'always') return true;
    return run.status !== 'passed' || (run.results ?? []).some(r => r.flaky);
  };

  async function post(url, payload) {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000), redirect: 'error' });
    check(res.ok, `The receiver answered ${res.status}.`);
  }

  /** Called when an automated run ends. Never throws: an unreachable webhook must not affect the test run. */
  async function runFinished(run) {
    if (run.kind !== 'tests' || run.mode !== 'automated') return false;
    const settings = read();
    if (!shouldSend(settings, run)) return false;
    try {
      await post(settings.webhookUrl, message(run));
      write({ ...read(), lastSentAt: new Date().toISOString(), lastResult: 'sent' });
      logger?.(`[alerts] Sent run ${run.id.slice(0, 8)} (${run.status}) to ${hostOf(settings.webhookUrl)}`);
      return true;
    } catch (error) {
      write({ ...read(), lastSentAt: new Date().toISOString(), lastResult: `failed: ${String(error.message ?? error).slice(0, 160)}` });
      logger?.(`[alerts] Could not send run ${run.id.slice(0, 8)}: ${error.message ?? error}`, 'stderr');
      return false;
    }
  }

  async function sendTest() {
    const settings = read();
    check(settings.webhookUrl, 'Save a webhook address first.', 409);
    const text = 'Test Studio: this is a test alert. If you can read this, run alerts will reach this channel.';
    try {
      await post(settings.webhookUrl, { text, run: { test: true } });
      write({ ...read(), lastSentAt: new Date().toISOString(), lastResult: 'test sent' });
      return { ok: true };
    } catch (error) {
      write({ ...read(), lastSentAt: new Date().toISOString(), lastResult: `failed: ${String(error.message ?? error).slice(0, 160)}` });
      check(false, `The test alert did not arrive: ${error.message ?? error}`, 502);
    }
  }

  return { get: () => publicView(read()), save, runFinished, sendTest, message, shouldSend: run => shouldSend(read(), run) };
}
