// Failure analysis for a finished run: classify every failing result, group identical failures, and give a rule-based hint.
// Nothing here calls an AI model and nothing edits a test. Hints are starting points for a person (or the healer agent) to review.

const BAD = new Set(['FAIL', 'FAIL (assumed requirement)', 'ERROR']);

export const CLASSES = {
  session: { label: 'Login or session', hint: 'The application session looks expired or the account lost access. Refresh the application login in Settings, then re-run the failed cases.' },
  network: { label: 'Application or network error', hint: 'The application or network answered with an error. Check that the environment is up and healthy before suspecting the tests; re-run the failures once it is.' },
  data: { label: 'Test data or prerequisite', hint: 'A case needed data from an earlier case, or the data already exists. Check the case this one depends on, and whether leftover records from a previous run clash.' },
  locator: { label: 'Element not found', hint: 'A control could not be found or was not usable. If the screen changed on purpose, update the page object; otherwise the page may be slow to render.' },
  timeout: { label: 'Timed out', hint: 'The step did not finish in time. If it passes on retry it is flaky (slow environment); if it always times out, check the screen or raise PORTAL_CASE_TIMEOUT_MS.' },
  assertion: { label: 'Expected result not met', hint: 'The application behaved differently from the stated expectation. This is a candidate defect: confirm the rule, then triage it.' },
  unknown: { label: 'Other', hint: 'No known pattern matched. Open the case to read the full message and evidence.' },
};

const text = r => [r.actual, ...(r.mismatches ?? [])].filter(Boolean).join(' | ');

/** Class of one failing result. Order matters: infrastructure causes are checked before assertions. */
export function classify(result) {
  const t = text(result);
  if (/session (is )?(missing|expired)|storage ?state|sign[- ]?in (page|failed)|login page|redirected to .*login|unauthori[sz]ed|\b401\b/i.test(t)) return 'session';
  if (/net::ERR|ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|bad gateway|service unavailable|\b50[0-4]\b|"statusCode":\s*5\d\d|server error/i.test(t)) return 'network';
  if (/needs \{\{|did not produce|did not create a patient|missing saved registration|already exists|duplicate/i.test(t)) return 'data';
  if (/waiting for (locator|getBy)|strict mode violation|resolved to \d+ elements|no selectable options|element (is )?not (found|visible|enabled|attached)|locator\.|getBy\w+\(/i.test(t)) return 'locator';
  if (/timeout \d+ms exceeded|timed out|exceeded while/i.test(t)) return 'timeout';
  if (result.status === 'FAIL' || result.status === 'FAIL (assumed requirement)' || (result.mismatches ?? []).length) return 'assertion';
  return 'unknown';
}

/** Same failure, different data: strip numbers, ids and quoted values so identical causes share one signature. */
export function signature(result) {
  return text(result).toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#')
    .replace(/"[^"]*"|'[^']*'/g, '"…"').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Locator text mentioned in an error, and how robust that kind of locator is. */
export function locatorAdvice(result) {
  const t = text(result), found = /(getBy\w+\([^)]*\)|locator\((['"`])[\s\S]*?\2\))/.exec(t)?.[1];
  if (!found) return null;
  const kind = /getByTestId/.test(found) ? 'test id' : /getByRole|getByLabel/.test(found) ? 'role or label' : /getBy(Text|PlaceholderText|Title|AltText)/.test(found) ? 'visible text' : 'CSS or XPath';
  const fragile = kind === 'CSS or XPath' || kind === 'visible text';
  return { locator: found.slice(0, 200), kind, fragile,
    advice: fragile ? `This locator uses ${kind}, which breaks easily when the screen changes. Prefer a role, label or test id.` : `This locator already uses a ${kind}, so the screen probably changed or loaded slowly. Check the page object before replacing it.` };
}

const agentPrompt = (r, moduleId) => `Use the playwright-test-healer agent on ${r.id} (${moduleId}). Fix only locators and waiting; do not change the expected results. Show me the diff before anything is kept.`;

/** Groups, clusters and per-case hints for a run. Quarantined failures are listed but flagged. */
export function analyzeRun(run) {
  const failing = (run.results ?? []).filter(r => BAD.has(r.status));
  const items = failing.map(r => ({ id: r.id, title: r.title, status: r.status, quarantined: Boolean(r.quarantined), cls: classify(r), sig: signature(r), result: r }));
  const groups = Object.keys(CLASSES).map(cls => {
    const members = items.filter(i => i.cls === cls);
    return members.length ? { class: cls, label: CLASSES[cls].label, hint: CLASSES[cls].hint, count: members.length, caseIds: members.map(m => m.id) } : null;
  }).filter(Boolean).sort((a, b) => b.count - a.count);
  const byKey = new Map();
  for (const i of items) {
    const key = `${i.cls}|${i.sig}`, entry = byKey.get(key) ?? { class: i.cls, signature: i.sig, sample: text(i.result).slice(0, 300), caseIds: [] };
    entry.caseIds.push(i.id); byKey.set(key, entry);
  }
  const clusters = [...byKey.values()].map(c => ({ ...c, count: c.caseIds.length })).sort((a, b) => b.count - a.count);
  const suggestions = items.filter(i => i.cls === 'locator' || i.cls === 'timeout').map(i => ({ caseId: i.id, class: i.cls, locator: locatorAdvice(i.result), prompt: agentPrompt(i.result, run.module?.id ?? 'module'), review: 'A person must review the change. Business expectations must stay as they are.' }));
  return { total: items.length, gating: items.filter(i => !i.quarantined).length, groups, clusters, suggestions, postmortem: postmortem(run, items, groups, clusters) };
}

/** Plain-language summary written from the facts above; an assistant can refine it, but this is always available. */
export function postmortem(run, items, groups, clusters) {
  const results = run.results ?? [], flaky = results.filter(r => r.flaky), quarantined = items.filter(i => i.quarantined);
  const lines = [`${run.name}: ${results.filter(r => r.status === 'PASS').length} of ${results.length} cases passed; ${items.length} failed${quarantined.length ? ` (${quarantined.length} quarantined)` : ''}.`];
  if (!items.length) lines.push('No failures to explain.');
  else {
    const top = groups[0];
    lines.push(`Most failures (${top.count}) were "${top.label}". ${top.hint}`);
    const repeat = clusters.find(c => c.count > 1);
    if (repeat) lines.push(`${repeat.count} cases failed with the same message, so they likely share one cause: "${repeat.sample.slice(0, 140)}". Fix that first (${repeat.caseIds.slice(0, 6).join(', ')}).`);
    if (groups.some(g => ['session', 'network'].includes(g.class))) lines.push('Some failures point at the environment or login rather than the application behaviour; confirm the environment before filing defects.');
  }
  if (flaky.length) lines.push(`${flaky.length} case${flaky.length === 1 ? '' : 's'} passed only on retry (${flaky.slice(0, 5).map(f => f.id).join(', ')}): the pass is real but unreliable.`);
  return lines.join(' ');
}
