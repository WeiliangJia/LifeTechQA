/**
 * Mock helpers — intercept API responses to control test state
 * without touching the real database.
 *
 * Usage:
 *   import { mockAsUnregistered, mockPaymentSuccess } from './helpers-mock';
 *
 *   test('...', async ({ page }) => {
 *     await mockAsUnregistered(page);   // must call BEFORE login()
 *     await login(page);
 *     // page now behaves as if payment has never been registered
 *   });
 */
import { Page } from '@playwright/test';

const BASE = 'https://lifetech.star-x-tech.com';

// ─── Registration state mock ──────────────────────────────────────────────────

/**
 * Make the app think the user has NOT registered payment yet.
 * Intercepts GET /api/payments/registration/status → { data: false }
 * The app will show the payment registration form instead of redirecting away.
 */
export async function mockAsUnregistered(page: Page) {
  await page.route(`${BASE}/api/payments/registration/status`, route => {
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Status fetched',
        userId:  0,
        token:   null,
        data:    false,   // ← false = not registered
      }),
    });
  });
  console.log('[Mock] /api/payments/registration/status → data: false');
}

/**
 * Make the app think the user HAS already registered payment.
 * Useful for testing pages/flows that only appear post-registration.
 */
export async function mockAsRegistered(page: Page) {
  await page.route(`${BASE}/api/payments/registration/status`, route => {
    route.fulfill({
      status:      200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Status fetched',
        userId:  0,
        token:   null,
        data:    true,   // ← true = registered
      }),
    });
  });
  console.log('[Mock] /api/payments/registration/status → data: true');
}

// ─── Payment submission mock ──────────────────────────────────────────────────

/**
 * Mock the payment submission to return success WITHOUT hitting Stripe.
 * Use this when you only want to test form validation / UI flow,
 * not the actual Stripe integration.
 */
export async function mockPaymentSuccess(page: Page) {
  await page.route(`${BASE}/api/payments/**`, route => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Payment registered' }),
      });
    } else {
      route.continue(); // let GET requests through normally
    }
  });
  console.log('[Mock] POST /api/payments/** → 200 success');
}

/**
 * Mock the payment submission to return a server error.
 * Use this to test how the frontend handles backend failures.
 */
export async function mockPaymentError(page: Page, status = 500, message = 'Internal Server Error') {
  await page.route(`${BASE}/api/payments/**`, route => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message }),
      });
    } else {
      route.continue();
    }
  });
  console.log(`[Mock] POST /api/payments/** → ${status} ${message}`);
}

// ─── Clear all mocks ──────────────────────────────────────────────────────────

export async function clearMocks(page: Page) {
  await page.unroute(`${BASE}/api/payments/registration/status`);
  await page.unroute(`${BASE}/api/payments/**`);
  console.log('[Mock] All mocks cleared');
}
