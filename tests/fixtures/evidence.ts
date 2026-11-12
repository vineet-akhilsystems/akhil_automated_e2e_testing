import type { Page, TestInfo } from '@playwright/test';

/** Capture business-stage evidence and attach it so every reporter can discover it. */
export async function captureEvidence(page: Page, info: TestInfo, caseId: string, stage: string): Promise<void> {
  // Logic-only executor checks can deliberately use a TestInfo double without artifacts.
  if (typeof info?.outputPath !== 'function' || typeof info?.attach !== 'function') return;
  const safeStage = stage.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
  try {
    const filename = info.outputPath(`${caseId}-${safeStage}.png`);
    await page.screenshot({ path: filename, fullPage: true, animations: 'disabled', timeout: 5000 });
    await info.attach(`${caseId} - ${stage}`, { path: filename, contentType: 'image/png' });
  } catch (error: any) {
    // Evidence failure is visible, but must not turn a passing business assertion into a defect.
    info.annotations.push({ type: 'evidence-warning', description: `${stage}: screenshot unavailable (${String(error?.message ?? error).split('\n')[0]})` });
  }
}
