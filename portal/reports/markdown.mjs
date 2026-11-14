// Pure Markdown rendering of a buildSummary() result. The verdict is a suggestion, never an approval.
import { safeReportText as t } from '../quality.mjs';

export const VERDICT_LABEL = {
  'do-not-release': 'Do not release', 'needs-triage': 'Needs triage',
  'release-with-known-issues': 'Release with known issues', release: 'Release',
};

export function summaryMarkdown(summary) {
  const v = summary.verdict, c = summary.counts ?? {};
  const out = [`**Suggested verdict: ${VERDICT_LABEL[v.value] ?? v.value}**`, ''];
  out.push(`Not tested: ${summary.notTested.length ? t(summary.notTested.join('; ')) : 'none recorded'}`, '');
  for (const r of v.reasons) out.push(`- ${t(r)}`);
  out.push('', `Scope: ${t(summary.scope)}`);
  if (summary.filterNote) out.push(`Filter: ${t(summary.filterNote)}`);
  out.push('', '## Counts', '');
  for (const [k, val] of Object.entries(c)) out.push(`- ${k}: ${val}`);
  out.push(`- Pass rate (executed, non-quarantined): ${summary.passRate == null ? 'n/a' : `${summary.passRate}%`}`);
  out.push('', '## Open bugs by severity', '');
  const sev = Object.entries(summary.openBugsBySeverity);
  out.push(...(sev.length ? sev.map(([k, n]) => `- ${k}: ${n}`) : ['- None']));
  out.push('', '## Risks', '', ...(summary.risks.length ? summary.risks.map(r => `- ${t(r)}`) : ['- None recorded']));
  if (summary.comparison) {
    const p = summary.comparison;
    out.push('', '## Compared with previous run', '', `- Previous pass rate: ${p.passRate == null ? 'n/a' : `${p.passRate}%`}`, `- Newly failing: ${p.newlyFailing}`, `- Fixed: ${p.fixed}`);
  }
  return out.join('\n') + '\n';
}
