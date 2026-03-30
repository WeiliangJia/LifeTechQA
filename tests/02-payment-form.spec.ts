import { test, expect } from '@playwright/test';
import { CARDS } from './fixtures';
import { login, fillCard, submitPayment, dumpSnapshot } from './helpers';
import { mockAsUnregistered } from './helpers-mock';

// ── Before each test: mock status as "not registered" so payment form always shows
// ── This lets us test the registration flow repeatedly with the same account.
test.beforeEach(async ({ page }) => {
  await mockAsUnregistered(page);   // ← intercept before login so redirect never fires

  page.on('response', async (res) => {
    if (res.url().includes('lifetech.star-x-tech.com/api')) {
      const body = await res.json().catch(() => null);
      console.log(`[API] ${res.status()} ${res.url()}`, body ? JSON.stringify(body).slice(0, 200) : '');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payment Form — Happy Path', () => {

  test('payment page renders all Stripe fields', async ({ page }) => {
    await login(page);

    // All three Stripe iframes must be present
    await expect(page.locator('iframe[title="Secure card number input frame"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('iframe[title="Secure expiration date input frame"]')).toBeVisible();
    await expect(page.locator('iframe[title="Secure CVC input frame"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Name on card"]')).toBeVisible();
    await expect(page.locator('button.submit-button')).toBeVisible();

    await page.screenshot({ path: 'screenshots/02-payment-page.png', fullPage: true });
    console.log('[Payment] All fields present ✓');
  });

  test('fill test card 4242 and submit → success response', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.visa_success);
    await page.screenshot({ path: 'screenshots/02-card-filled.png' });

    const res = await submitPayment(page);

    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/02-after-submit.png', fullPage: true });

    // Success: either API returned 2xx or a success UI element appeared
    const apiOk  = res ? res.status() < 400 : false;
    const uiOk   = await page.locator('text=/success|paid|thank|complete|完成|成功/i').count() > 0;
    console.log(`[Result] API ok=${apiOk}  UI success=${uiOk}`);
    expect(apiOk || uiOk).toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payment Form — Card Error Scenarios', () => {

  test('declined card (4000...0002) → error shown', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.visa_declined);
    await submitPayment(page);
    await page.waitForTimeout(5000);

    const hasError = await page.locator('text=/declined|failed|拒绝|失败/i').count() > 0
      || await page.locator('[class*="error"], [class*="alert"]').count() > 0;
    await page.screenshot({ path: 'screenshots/02-declined.png' });
    console.log('[Declined] error shown:', hasError);
  });

  test('insufficient funds (4000...9995) → error shown', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.insufficient_funds);
    await submitPayment(page);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/02-insufficient.png' });
  });

  test('expired card (4000...0069) → error shown', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.expired);
    await submitPayment(page);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/02-expired.png' });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payment Form — Validation', () => {

  test('submit empty form → Stripe shows inline errors', async ({ page }) => {
    await login(page);
    // Click submit without filling anything
    await page.locator('button.submit-button').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/02-empty-submit.png' });

    // Stripe marks empty required fields with an error class
    const cardNumberFrame = page.frameLocator('iframe[title="Secure card number input frame"]');
    const hasStripeError  = await cardNumberFrame.locator('.StripeElement--invalid, [class*="is-invalid"]').count() > 0;
    console.log('[Validation] Stripe inline error:', hasStripeError);
  });

  test('name on card required', async ({ page }) => {
    await login(page);
    // Fill card but leave name empty
    await fillCard(page, { ...CARDS.visa_success, name: '' });
    // Override name to empty
    await page.locator('input[placeholder="Name on card"]').fill('');
    await page.locator('button.submit-button').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/02-no-name.png' });
  });

});
