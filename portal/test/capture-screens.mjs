import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  await page.goto('http://127.0.0.1:4173');
  await page.waitForTimeout(500);
  if (await page.locator('#login-user').count() > 0) {
    await page.fill('#login-user', 'admin');
    await page.fill('#login-pass', 'admin123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForTimeout(1500);
  }

  // If product picker is shown, click Open / Continue Augastam
  const productBtn = page.locator('button[data-action="open-product"]').first();
  if (await productBtn.count() > 0) {
    console.log('Opening Augastam from product picker...');
    await productBtn.click();
    await page.waitForTimeout(1500);
  }
  
  await page.screenshot({ path: 'portal/test-output/screen-modules.png' });
  console.log('1. Modules page:', page.url());
  
  await page.goto('http://127.0.0.1:4173/#/modules/registration');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-registration-cases.png' });
  await page.locator('.list-more').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'portal/test-output/screen-cases-pagination.png' });
  console.log('2. Cases page & pagination captured:', page.url());

  await page.goto('http://127.0.0.1:4173/#/modules/registration/coverage');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-coverage.png' });
  console.log('3. Coverage page:', page.url());

  await page.goto('http://127.0.0.1:4173/#/modules/registration/ai');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-ai.png' });
  console.log('4. AI Studio page:', page.url());

  await page.goto('http://127.0.0.1:4173/#/modules/registration/intake');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-intake.png' });
  console.log('5. Intake page:', page.url());

  await page.goto('http://127.0.0.1:4173/#/runs');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-runs.png' });
  console.log('6. Runs page:', page.url());

  await page.goto('http://127.0.0.1:4173/#/overview');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'portal/test-output/screen-overview.png' });
  console.log('7. Overview page:', page.url());

  await browser.close();
  console.log('All product screens captured!');
})();
