/**
 * Selector Health Check — run after every deployment.
 *
 * This test does NOT test business logic. It only verifies that every
 * critical selector in helpers.ts still exists on the live page.
 * If this test fails, update SEL in helpers.ts before running other tests.
 *
 * Typical CI usage:
 *   1. Deploy
 *   2. Run 00-selector-health  → if FAIL, alert dev to update selectors
 *   3. Run full suite          → only after health check passes
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Selector Health', () => {

  test('login page — all critical selectors exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input', { timeout: 15000 });
    await page.waitForTimeout(800);

    const checks = [
      { name: 'email input',    sel: 'input[placeholder="Mobile Number/Email"]' },
      { name: 'password input', sel: 'input[type="password"]' },
      { name: 'continue btn',   sel: 'button:has-text("Continue")' },
    ];

    const results = await Promise.all(
      checks.map(async ({ name, sel }) => ({
        name,
        sel,
        found: await page.locator(sel).count() > 0,
      }))
    );

    console.log('\n── Login page selectors ──');
    results.forEach(r => console.log(`  ${r.found ? '✅' : '❌'} ${r.name}  [${r.sel}]`));

    const broken = results.filter(r => !r.found);
    if (broken.length > 0) {
      console.error('\n[ACTION REQUIRED] Update SEL in helpers.ts:');
      broken.forEach(r => console.error(`  ✗ "${r.name}" → selector no longer matches: ${r.sel}`));
    }
    expect(broken).toHaveLength(0);
  });

  test('payment page — all critical selectors exist', async ({ page }) => {
    await login(page);

    const checks = [
      { name: 'card number iframe', sel: 'iframe[title="Secure card number input frame"]' },
      { name: 'expiry iframe',      sel: 'iframe[title="Secure expiration date input frame"]' },
      { name: 'CVC iframe',         sel: 'iframe[title="Secure CVC input frame"]' },
      { name: 'name on card',       sel: 'input[placeholder="Name on card"]' },
      { name: 'submit button',      sel: 'button.submit-button' },
    ];

    const results = await Promise.all(
      checks.map(async ({ name, sel }) => ({
        name,
        sel,
        found: await page.locator(sel).count() > 0,
      }))
    );

    console.log('\n── Payment page selectors ──');
    results.forEach(r => console.log(`  ${r.found ? '✅' : '❌'} ${r.name}  [${r.sel}]`));

    const broken = results.filter(r => !r.found);
    if (broken.length > 0) {
      console.error('\n[ACTION REQUIRED] Update SEL in helpers.ts:');
      broken.forEach(r => console.error(`  ✗ "${r.name}" → selector no longer matched: ${r.sel}`));
      console.error('\nRun: npx playwright test tests/05-explore-page.spec.ts --headed');
      console.error('Then update the SEL object in tests/helpers.ts\n');
    }
    expect(broken).toHaveLength(0);
  });

  test('app API endpoints respond (not 404/500)', async ({ page }) => {
    const results: { endpoint: string; status: number }[] = [];

    page.on('response', res => {
      if (res.url().includes('/api/')) {
        results.push({ endpoint: res.url().replace('https://lifetech.star-x-tech.com', ''), status: res.status() });
      }
    });

    await login(page);
    await page.waitForTimeout(2000);

    console.log('\n── API endpoint health ──');
    results.forEach(r => {
      const ok = r.status < 400;
      console.log(`  ${ok ? '✅' : '❌'} ${r.status}  ${r.endpoint}`);
    });

    const broken = results.filter(r => r.status >= 400);
    if (broken.length > 0) {
      console.error('[ACTION REQUIRED] Broken endpoints — update 03-api-monitoring.spec.ts');
    }
    expect(broken).toHaveLength(0);
  });

});
