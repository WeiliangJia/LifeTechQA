/**
 * Visual Regression Tests
 *
 * Takes full-page screenshots and compares against approved baselines.
 * Run once to create baselines:   npx playwright test 10-visual --update-snapshots
 * Run normally to detect changes: npx playwright test 10-visual
 *
 * If a snapshot diff appears, it means the UI changed. Review the diff in
 * the HTML report and decide: intentional change (update baseline) or bug (fix it).
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Visual Regression', () => {

  test('login page matches baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input', { timeout: 15000 });
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage:  true,
      maxDiffPixelRatio: 0.02, // allow 2% pixel diff (e.g. animations, timestamps)
    });
  });

  test('payment registration page matches baseline', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/register/payment-registration', { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // wait for Stripe iframes

    // Mask dynamic content that changes every run
    await expect(page).toHaveScreenshot('payment-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
      mask: [
        // Mask elements that contain timestamps, user IDs, etc.
        page.locator('[class*="timestamp"], [class*="date"], [class*="user-id"]'),
      ],
    });
  });

  test('payment page — Stripe card fields rendered', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/register/payment-registration', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Only snapshot the card form area, not the whole page
    const cardForm = page.locator('[class*="card"], [class*="payment"], [class*="stripe"]').first();
    if (await cardForm.count() > 0) {
      await expect(cardForm).toHaveScreenshot('card-form.png', {
        maxDiffPixelRatio: 0.02,
      });
    } else {
      await expect(page).toHaveScreenshot('payment-full.png', { fullPage: true });
    }
  });

});
