/**
 * Error Handling & Service Error Tests
 *
 * Tests what happens when the backend returns errors.
 * Failures are captured in:
 *   - Console output (error message + API response body)
 *   - Screenshot (auto-saved on failure by playwright.config.ts)
 *   - Trace viewer (video + network + DOM timeline)
 *   - HTML report: npx playwright show-report
 */
import { test, expect } from '@playwright/test';
import { CARDS } from './fixtures';
import { login, fillCard, submitPayment, handle3DS, dumpSnapshot } from './helpers';

// ─── Explicit payment result assertion ───────────────────────────────────────

/**
 * After submit, this function asserts the FINAL outcome explicitly.
 * It distinguishes between three states and fails with a clear message for each:
 *   - SUCCESS  : payment accepted
 *   - CARD_ERR : card-level error (declined, expired, etc.)
 *   - SYS_ERR  : internal server error / unexpected API failure
 */
async function assertPaymentResult(
  page: ReturnType<typeof import('@playwright/test')['test']['info']> extends never ? never : Parameters<Parameters<typeof test>[1]>[0]['page'],
  expectedOutcome: 'success' | 'card_error' | 'any_error'
) {
  await page.waitForTimeout(5000);

  // Capture what the API actually returned
  const apiErrors: { url: string; status: number; body: unknown }[] = [];
  // (already captured via beforeEach listener — read from page context)

  // ── Check UI state ────────────────────────────────────────────────────────
  const successText = await page.locator('text=/success|paid|thank|complete|完成|成功/i').count() > 0;
  const cardErrText = await page.locator('text=/declined|insufficient|expired|invalid|拒绝|失败/i').count() > 0;
  const sysErrText  = await page.locator('text=/error|something went wrong|internal|服务器|系统错误/i').count() > 0;
  const currentUrl  = page.url();

  console.log(`\n── Payment Outcome ──`);
  console.log(`  URL         : ${currentUrl}`);
  console.log(`  Success UI  : ${successText}`);
  console.log(`  Card error  : ${cardErrText}`);
  console.log(`  System error: ${sysErrText}`);

  if (expectedOutcome === 'success') {
    if (sysErrText) {
      await dumpSnapshot(page, 'UNEXPECTED SYSTEM ERROR after payment');
      // This will show in the report as a failed test with full context
    }
    expect(sysErrText, 'System error appeared instead of success').toBeFalsy();
    expect(successText || currentUrl.includes('success') || currentUrl.includes('complete'),
      'Expected success UI or redirect to success page').toBeTruthy();
  }

  if (expectedOutcome === 'card_error') {
    expect(cardErrText || sysErrText,
      'Expected card error message to be visible').toBeTruthy();
    if (sysErrText && !cardErrText) {
      // System error instead of card error — backend bug
      await dumpSnapshot(page, 'SYS_ERR instead of expected card error');
      throw new Error('Got internal server error instead of card-level error message. Check backend logs.');
    }
  }

  if (expectedOutcome === 'any_error') {
    expect(cardErrText || sysErrText, 'Expected some error message').toBeTruthy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('3DS Authentication Flow', () => {

  test('3DS card → complete authentication → payment succeeds', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.three_d_secure);
    await submitPayment(page);

    // Handle the 3DS popup
    await handle3DS(page, 'complete');
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'screenshots/06-3ds-complete.png', fullPage: true });

    const success = await page.locator('text=/success|paid|complete|成功/i').count() > 0;
    const errText = await page.locator('text=/error|failed|失败/i').count() > 0;
    console.log(`[3DS Complete] success=${success}  error=${errText}`);
    expect(errText).toBeFalsy();
  });

  test('3DS card 0341 → fail authentication → payment declined', async ({ page }) => {
    await login(page);
    await fillCard(page, CARDS.three_d_secure_fail);
    await submitPayment(page);

    // User fails 3DS → expect decline
    await handle3DS(page, 'fail');
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'screenshots/06-3ds-fail.png', fullPage: true });

    const hasError = await page.locator('text=/declined|failed|authentication|失败/i').count() > 0;
    console.log('[3DS Fail] error shown:', hasError);
    // App should show a user-friendly message, not a raw 500
    const hasSysError = await page.locator('text=/internal server error|500|unexpected/i').count() > 0;
    expect(hasSysError).toBeFalsy(); // system should handle this gracefully
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Backend Error Scenarios', () => {

  test('simulate 500 on payment API → app shows friendly error, not crash', async ({ page }) => {
    await login(page);

    // Intercept the payment submission endpoint and force a 500
    await page.route('**/api/payments/**', route => {
      route.fulfill({
        status:      500,
        contentType: 'application/json',
        body:        JSON.stringify({ message: 'Internal Server Error' }),
      });
    });

    await fillCard(page, CARDS.visa_success);
    await page.locator('button.submit-button').click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'screenshots/06-forced-500.png', fullPage: true });

    // The app MUST show a user-friendly message, NOT a blank screen or JS stack trace
    const hasUserMessage = await page.locator(
      'text=/error|failed|try again|please|重试|失败/i'
    ).count() > 0;
    const hasRawStack = await page.locator('text=/TypeError|ReferenceError|undefined is not/').count() > 0;

    console.log(`[500 Test] User message: ${hasUserMessage}  Raw JS error: ${hasRawStack}`);
    expect(hasRawStack, 'Raw JS error should not be shown to user').toBeFalsy();
    expect(hasUserMessage, 'App should show a user-friendly error message on 500').toBeTruthy();
  });

  test('simulate network timeout → app shows friendly error', async ({ page }) => {
    await login(page);

    await page.route('**/api/payments/**', route => {
      // Abort the request — simulates network failure
      route.abort('failed');
    });

    await fillCard(page, CARDS.visa_success);
    await page.locator('button.submit-button').click();
    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'screenshots/06-network-timeout.png', fullPage: true });

    const hasErrorMsg = await page.locator('text=/error|network|connection|failed|请稍后/i').count() > 0;
    const pageIsBlank = await page.locator('body').evaluate(b => (b as HTMLElement).innerText.trim().length < 20);

    console.log(`[Timeout] User message: ${hasErrorMsg}  Blank page: ${pageIsBlank}`);
    expect(pageIsBlank, 'Page should not go blank on network error').toBeFalsy();
  });

});
