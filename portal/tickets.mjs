import { check, textValue } from './registry.mjs';
import { classification, FINDINGS } from './quality.mjs';

// Defect tickets: create a GitHub issue or a Jira Cloud issue from a finding in a finished run.
// Credentials are stored on the server, never returned to the browser, and the ticket text is redacted like the PDF report.
const KEY = 'tickets';

export const redact = t => String(t ?? '')
  .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted token]')
  .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]');

export function ticketText(run, caseDef, result, { link = '' } = {}) {
  const kind = classification(result), finding = FINDINGS[kind] ?? { label: result.status, note: '' };
  const lines = [
    `Found by an automated run in Test Studio.`, '',
    `Case: ${caseDef?.id ?? result.id} ${caseDef?.title ?? result.title ?? ''}`.trim(),
    `Module: ${run.module?.name ?? run.module?.id} | Environment: ${run.environmentName ?? ''} | Run: ${run.name}`,
    `Classification: ${finding.label}${finding.note ? ` (${finding.note})` : ''}`,
    ...(result.flaky ? ['This case also passed on retry in some runs, so it may be intermittent.'] : []), '',
    'Expected:', redact(result.expected ?? ''), '', 'Actual:', redact(result.actual ?? ''),
    ...((result.mismatches ?? []).length ? ['', 'Differences:', ...result.mismatches.slice(0, 10).map(m => `- ${redact(m)}`)] : []),
    ...(link ? ['', `Evidence (screenshots, trace): ${link}`] : []),
  ];
  return { title: `[${caseDef?.id ?? result.id}] ${caseDef?.title ?? result.title ?? 'Test finding'}`.slice(0, 200), body: lines.join('\n') };
}

export function createTickets(store, { fetchImpl = globalThis.fetch, logger = null, baseUrl = () => '' } = {}) {
  const read = () => { try { return JSON.parse(store.db.prepare('SELECT value FROM meta WHERE key=?').get(KEY)?.value ?? '{}'); } catch { return {}; } };
  const write = v => store.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(v));
  const view = s => ({ provider: s.provider ?? null, configured: s.provider === 'github' ? Boolean(s.github?.token && s.github?.repo) : s.provider === 'jira' ? Boolean(s.jira?.token && s.jira?.baseUrl && s.jira?.projectKey) : false,
    target: s.provider === 'github' ? s.github?.repo : s.provider === 'jira' ? `${s.jira?.projectKey} at ${s.jira?.baseUrl}` : '', hasSecret: Boolean(s.provider === 'github' ? s.github?.token : s.jira?.token) });

  function save(body) {
    const next = { ...read() };
    if (body.provider === 'none') return write({}), view({});
    check(['github', 'jira'].includes(body.provider), 'Choose GitHub or Jira.');
    next.provider = body.provider;
    if (body.provider === 'github') {
      const repo = textValue(body.repo ?? next.github?.repo ?? '', 'Repository', 200, true);
      check(/^[\w.-]+\/[\w.-]+$/.test(repo), 'Enter the repository as owner/name, for example my-company/my-app.');
      next.github = { repo, token: body.token ? textValue(body.token, 'Token', 400, true) : next.github?.token };
      check(next.github.token, 'Enter a GitHub token that can create issues in this repository.');
    } else {
      const baseUrl = textValue(body.baseUrl ?? next.jira?.baseUrl ?? '', 'Jira address', 300, true).replace(/\/+$/, '');
      check(/^https:\/\/[^/\s]+$/.test(baseUrl), 'Enter the Jira address such as https://your-company.atlassian.net');
      next.jira = { baseUrl, email: textValue(body.email ?? next.jira?.email ?? '', 'Jira email', 200, true), projectKey: textValue(body.projectKey ?? next.jira?.projectKey ?? '', 'Project key', 20, true).toUpperCase(),
        issueType: textValue(body.issueType ?? next.jira?.issueType ?? 'Bug', 'Issue type', 60, true), token: body.token ? textValue(body.token, 'API token', 400, true) : next.jira?.token };
      check(next.jira.token, 'Enter a Jira API token.');
    }
    write(next);
    return view(next);
  }

  async function create(run, caseId) {
    const s = read();
    check(view(s).configured, 'Set up defect tickets in Settings first.', 409);
    const result = (run.results ?? []).find(r => r.id === caseId);
    check(result && classification(result), 'This case has no recorded finding.', 404);
    const caseDef = (run.cases ?? []).find(c => c.id === caseId);
    const link = baseUrl() ? `${baseUrl()}/#/runs/${run.id}` : '';
    const { title, body } = ticketText(run, caseDef, result, { link });
    try {
      if (s.provider === 'github') {
        const res = await fetchImpl(`https://api.github.com/repos/${s.github.repo}/issues`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${s.github.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'test-studio' }, body: JSON.stringify({ title, body, labels: ['bug', 'test-studio'] }) });
        const data = await res.json().catch(() => ({}));
        check(res.ok && data.html_url, `GitHub refused the ticket (${res.status}): ${data.message ?? 'check the token and repository'}`, 502);
        return { url: data.html_url, key: `#${data.number}`, provider: 'github' };
      }
      const auth = Buffer.from(`${s.jira.email}:${s.jira.token}`).toString('base64');
      const adf = { type: 'doc', version: 1, content: body.split('\n\n').map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p || ' ' }] })) };
      const res = await fetchImpl(`${s.jira.baseUrl}/rest/api/3/issue`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { project: { key: s.jira.projectKey }, summary: title, issuetype: { name: s.jira.issueType }, description: adf } }) });
      const data = await res.json().catch(() => ({}));
      check(res.ok && data.key, `Jira refused the ticket (${res.status}): ${(data.errorMessages ?? []).join(' ') || Object.values(data.errors ?? {}).join(' ') || 'check the project key and issue type'}`, 502);
      return { url: `${s.jira.baseUrl}/browse/${data.key}`, key: data.key, provider: 'jira' };
    } catch (error) { logger?.(`[tickets] ${error.message ?? error}`, 'stderr'); throw error; }
  }

  return { get: () => view(read()), save, create, ticketText };
}
