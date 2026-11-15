import { test as base } from '@playwright/test';
import { partForUrl, profileFingerprint, responseKey } from '../shared/profile-hash.mjs';

/**
 * Read-only capture of the configuration the page pulls from configuration-service. It only listens (page.on('response'));
 * it never routes, alters or delays traffic and never fails a test. Only hashes are attached, never response bodies.
 */
export const test = base.extend<{ profileCapture: void }>({
  profileCapture: [async ({ page }, use, info) => {
    const captured: Record<string, Record<string, unknown>> = {};
    let count = 0;
    const pending = new Set<Promise<void>>();
    try {
      page.on('response', response => {
        const task = (async () => {
          try {
            const url = response.url();
            const part = partForUrl(url);
            if (!part || response.request().method() !== 'GET' || !response.ok()) return;
            const body = await response.json();
            (captured[part] ??= {})[responseKey(url)] = body;
            count++;
          } catch { /* not JSON or page closed: ignored */ }
        })();
        pending.add(task);
        void task.finally(() => pending.delete(task));
      });
    } catch { /* capture is optional */ }
    await use();
    try {
      await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => setTimeout(resolve, 2000))]);
      if (!count || typeof info?.attach !== 'function') return;
      const { parts } = profileFingerprint(captured);
      await info.attach('profile.json', { body: JSON.stringify({ parts, count }), contentType: 'application/json' });
    } catch { /* never affects the test */ }
  }, { auto: true }],
});
