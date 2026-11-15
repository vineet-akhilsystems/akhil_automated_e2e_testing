import { expect } from '@playwright/test';
import { test } from '../../tests/fixtures/profile';

const SECRET = 'SECRET-BODY-TEXT';
const origin = 'http://profile-check.invalid';

test.describe.configure({ mode: 'serial' });

// The fixture attaches in its teardown, after the test body. Each test records what the fixture attached through info.attach,
// and the following test asserts on it.
const attached: Record<string, { name: string; body: string }[]> = {};
function record(info: any, key: string) {
  attached[key] = [];
  const original = info.attach.bind(info);
  info.attach = async (name: string, options: any) => {
    attached[key].push({ name, body: String(options?.body ?? '') });
    return original(name, options);
  };
}

test('step 1: configuration responses are fetched (fixture listens only)', async ({ page }, info) => {
  record(info, 'with');
  await page.route('**/*', route => {
    const url = route.request().url();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.endsWith('/page')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>x</body></html>' });
    if (url.includes('form-schema/latest-version')) return json(200, { fields: [{ name: SECRET, required: true }], updatedAt: Date.now() });
    if (url.includes('reference-lookup/latest-version')) return json(200, { options: [SECRET] });
    if (url.includes('webpart/latest-version')) return json(500, { error: SECRET });
    return json(200, { ignored: SECRET });
  });
  await page.goto(`${origin}/page`);
  await page.evaluate(async base => {
    await fetch(`${base}/configuration-service/form-schema/latest-version?type=a`);
    await fetch(`${base}/configuration-service/reference-lookup/latest-version?lookup_id=1`);
    await fetch(`${base}/configuration-service/webpart/latest-version`);
    await fetch(`${base}/somewhere-else`);
  }, origin);
  await page.waitForTimeout(300);
});

test('step 2: the fixture attached hashes only, none of the body text, and skipped failed or unrelated responses', async () => {
  const files = attached.with.filter(a => a.name === 'profile.json');
  expect(files).toHaveLength(1);
  const doc = JSON.parse(files[0].body);
  expect(Object.keys(doc.parts).sort()).toEqual(['formSchema', 'lookups']);
  expect(doc.count).toBe(2);
  for (const hash of Object.values(doc.parts)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(files[0].body).not.toContain(SECRET);
});

test('step 3: a test that loaded no configuration attaches nothing', async ({ page }, info) => {
  record(info, 'without');
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.goto(`${origin}/page`);
});

test('step 4: nothing was attached for the empty test', async () => {
  expect(attached.without.filter(a => a.name === 'profile.json')).toHaveLength(0);
});
