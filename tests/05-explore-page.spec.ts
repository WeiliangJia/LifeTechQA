/**
 * Page Explorer — run this first to map the actual DOM structure.
 * Output tells you exactly what selectors to use in helpers.ts.
 */
import { test } from '@playwright/test';
import { CREDENTIALS } from './fixtures';
import { dumpSnapshot } from './helpers';

test('EXPLORE: dump login page structure', async ({ page }) => {
  await page.goto('/');
  // Wait for the first input to appear — do NOT use networkidle
  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(800); // let JS-driven enhancements settle

  await dumpSnapshot(page, 'Login Page');
  await page.screenshot({ path: 'screenshots/05-login-page.png', fullPage: true });
});

test('EXPLORE: dump payment page structure after login', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', req => {
    if (req.resourceType() === 'fetch' || req.resourceType() === 'xhr') {
      apiCalls.push(`${req.method()} ${req.url()}`);
    }
  });

  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto('/');
  await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.getByPlaceholder('Mobile Number/Email').fill(CREDENTIALS.valid.email);
  await page.getByPlaceholder('Password').fill(CREDENTIALS.valid.password);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Wait for URL to leave /login — no networkidle
  await page.waitForURL(
    url => !url.href.includes('/login') && !url.href.includes('/signin'),
    { timeout: 15000 }
  );
  await page.waitForLoadState('domcontentloaded');
  // Give the SPA and Stripe JS time to inject iframes/inputs
  await page.waitForTimeout(3000);

  console.log('[Post-login URL]', page.url());

  // ── First snapshot (may not have Stripe inputs yet) ────────────────────
  await dumpSnapshot(page, 'Payment Page — T+3s');
  await page.screenshot({ path: 'screenshots/05-payment-t3s.png', fullPage: true });

  // ── Wait another 3 s and snapshot again (Stripe iframes load async) ───
  await page.waitForTimeout(3000);
  await dumpSnapshot(page, 'Payment Page — T+6s');
  await page.screenshot({ path: 'screenshots/05-payment-t6s.png', fullPage: true });

  // ── API calls log ──────────────────────────────────────────────────────
  console.log('\n[API calls captured]:');
  apiCalls.forEach(c => console.log(' ', c));
});
