import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Optional accessibility scan (PORTAL_A11Y=1, set when a run is created with "Also check accessibility").
 * It only observes: the findings are attached as `<case>-a11y.json` and shown on the run page. A violation never fails a case,
 * because the expected result of a business case says nothing about accessibility. Automated checks find only part of the
 * problems; they do not prove a screen is accessible.
 */
export async function scanAccessibility(page: Page, info: TestInfo, caseId: string): Promise<void> {
  if (!process.env.PORTAL_A11Y || typeof info?.attach !== 'function') return;
  try {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const violations = result.violations.map(v => ({
      id: v.id, impact: v.impact ?? 'minor', help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length, sample: (v.nodes[0]?.target ?? []).join(' ').slice(0, 160),
    }));
    await info.attach(`${caseId}-a11y.json`, { body: JSON.stringify({ violations, url: page.url() }), contentType: 'application/json' });
  } catch (error: any) {
    info.annotations.push({ type: 'evidence-warning', description: `Accessibility scan unavailable (${String(error?.message ?? error).split('\n')[0]})` });
  }
}
