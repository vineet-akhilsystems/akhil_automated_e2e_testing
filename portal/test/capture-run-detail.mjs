import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  await page.goto('http://127.0.0.1:4173');
  await page.fill('#login-user', 'admin');
  await page.fill('#login-pass', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  await page.click('button[data-action="open-product"][data-id="augastam"]');
  await page.waitForTimeout(800);

  await page.goto('http://127.0.0.1:4173/#/runs/4e1b48ea-3ed7-47bf-9a63-cadf58623de5');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'portal/test-output/screen-run-detail.png' });
  console.log('Run detail captured!');

  await browser.close();
})();
