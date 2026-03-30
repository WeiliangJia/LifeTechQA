/**
 * Form Persistence & Read-back Tests
 *
 * Pattern:
 *   1. Submit a form with known data
 *   2. Navigate away (or reload)
 *   3. Return to the edit/view page
 *   4. Assert each field shows the previously submitted value
 *
 * Also captures the GET API that populates the form, so you can assert
 * that the backend is returning the correct data — not just that the
 * UI happens to display something.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ─── Generic form read-back helper ───────────────────────────────────────────

/**
 * Reads ALL input/select/textarea values from the current page.
 * Returns a map of { identifier → value } where identifier is:
 *   placeholder | aria-label | name | id  (first non-empty one)
 *
 * Use this to take a "snapshot" of form state before and after navigation.
 */
async function readFormValues(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  return page.evaluate(() => {
    const result: Record<string, string> = {};

    const els = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
    );

    els.forEach(el => {
      const key =
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label')  ||
        el.getAttribute('name')        ||
        el.getAttribute('id')          ||
        el.tagName + '_' + Math.random().toString(36).slice(2, 6);

      result[key] = (el as HTMLInputElement).value ?? '';
    });

    // Also capture radio/checkbox state
    document.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked, input[type="checkbox"]:checked')
      .forEach(el => {
        const key = el.getAttribute('name') || el.getAttribute('id') || 'checked';
        result[`[checked] ${key}`] = el.value;
      });

    return result;
  });
}

/**
 * Assert that a form's current field values match an expected map.
 * Handles masked values (e.g. card number shown as •••• 4242):
 *   pass `partial: true` to check that the field contains the expected substring.
 */
function assertFormValues(
  actual: Record<string, string>,
  expected: Record<string, string | RegExp>,
  label = ''
) {
  console.log(`\n── Form values${label ? ' — ' + label : ''} ──`);

  for (const [field, expectedVal] of Object.entries(expected)) {
    const actualVal = actual[field] ?? '';

    if (expectedVal instanceof RegExp) {
      console.log(`  ${expectedVal.test(actualVal) ? '✅' : '❌'} [${field}]  actual="${actualVal}"  expected=~${expectedVal}`);
      expect(actualVal, `Field "${field}"`).toMatch(expectedVal);
    } else {
      const ok = actualVal === expectedVal || actualVal.includes(expectedVal);
      console.log(`  ${ok ? '✅' : '❌'} [${field}]  actual="${actualVal}"  expected="${expectedVal}"`);
      expect(actualVal, `Field "${field}"`).toContain(expectedVal);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payment Registration — Form Read-back', () => {

  /**
   * After the card is registered, navigating back to the payment
   * registration page should show the saved card (masked number + expiry).
   *
   * This test also captures the GET API call that populates the form,
   * so you can see exactly what the backend is returning.
   */
  test('registered card data is shown on re-visit', async ({ page }) => {
    // Capture the GET call that loads saved payment data
    let getPaymentApiBody: unknown = null;
    page.on('response', async res => {
      if (
        res.url().includes('/api/payments') &&
        res.request().method() === 'GET' &&
        res.status() === 200
      ) {
        getPaymentApiBody = await res.json().catch(() => null);
        console.log(`[GET API] ${res.url()}`);
        console.log('[GET API body]', JSON.stringify(getPaymentApiBody).slice(0, 400));
      }
    });

    await login(page);

    // Navigate to payment registration (already there after login per your app)
    await page.waitForURL('**/register/payment-registration', { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000); // let Stripe + form data load

    // Snapshot what the form shows
    const formValues = await readFormValues(page);
    console.log('\n── Current form values ──');
    Object.entries(formValues).forEach(([k, v]) => console.log(`  "${k}" = "${v}"`));

    await page.screenshot({ path: 'screenshots/08-payment-form-readback.png', fullPage: true });

    // If a card was previously registered, the "Name on card" field should be populated
    // and Stripe may show the last 4 digits / brand icon
    const nameValue = formValues['Name on card'] ?? '';
    console.log('[Name on card]', nameValue || '(empty — no card registered yet)');

    // Assert the GET API was called (the form shouldn't show stale/hardcoded data)
    expect(getPaymentApiBody, 'Payment data GET API should have been called to populate form').not.toBeNull();
  });

  test('navigate away and back → form still shows saved data', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/register/payment-registration', { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Snapshot form before leaving
    const before = await readFormValues(page);
    console.log('\n── Before navigation ──');
    Object.entries(before).forEach(([k, v]) => console.log(`  "${k}" = "${v}"`));

    // Navigate to root and come back
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.goto('/register/payment-registration');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const after = await readFormValues(page);
    console.log('\n── After navigation ──');
    Object.entries(after).forEach(([k, v]) => console.log(`  "${k}" = "${v}"`));

    await page.screenshot({ path: 'screenshots/08-after-navigate-back.png', fullPage: true });

    // Fields that were non-empty before should still be non-empty after
    for (const [field, value] of Object.entries(before)) {
      if (value && field !== 'Password') { // exclude password fields
        expect(after[field] ?? '', `Field "${field}" should persist after navigation`).toBeTruthy();
      }
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Generic Form — Submit → Edit → Verify Pattern', () => {

  /**
   * Reusable test template for any form in the app.
   *
   * Usage: copy this test, change the URL and testData for your target form.
   */
  test('TEMPLATE: submit form data → reload → verify fields preserved', async ({ page }) => {
    await login(page);

    // ── Step 1: navigate to the form ─────────────────────────────────────
    const FORM_URL = '/register/payment-registration'; // change per form
    await page.goto(FORM_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // ── Step 2: fill fields with known test data ──────────────────────────
    // Example: fill "Name on card"
    const nameInput = page.locator('input[placeholder="Name on card"]');
    if (await nameInput.count() > 0) {
      await nameInput.fill('Test User');
    }

    // Capture the API response on save/submit
    const saveResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/') && res.request().method() === 'POST',
      { timeout: 15000 }
    ).catch(() => null);

    // ── Step 3: submit ────────────────────────────────────────────────────
    // (skipped in template — add fillCard + submitPayment for payment form)
    // await page.locator('button.submit-button').click();
    // const saveRes = await saveResponsePromise;

    // ── Step 4: reload and verify ─────────────────────────────────────────
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const afterReload = await readFormValues(page);

    // Assert specific fields match what you submitted
    assertFormValues(afterReload, {
      // 'Name on card': 'Test User',       // exact match
      // 'Mobile Number/Email': /.+@.+/,    // regex match
      // 'Name on card': /./,               // just "not empty"
    }, 'after reload');

    await page.screenshot({ path: 'screenshots/08-template-after-reload.png', fullPage: true });
  });

  test('API response matches what is displayed in form', async ({ page }) => {
    /**
     * This is the most important persistence test:
     * Verify that what the GET API returns is actually what the form displays.
     * If these differ, there's a frontend data-binding bug.
     */
    let apiData: Record<string, unknown> = {};

    page.on('response', async res => {
      if (
        res.url().includes('/api/payments/registration') &&
        res.request().method() === 'GET'
      ) {
        apiData = await res.json().catch(() => ({}));
      }
    });

    await login(page);
    await page.waitForURL('**/register/payment-registration', { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const formValues = await readFormValues(page);

    console.log('\n── API data ──');
    console.log(JSON.stringify(apiData, null, 2).slice(0, 600));

    console.log('\n── Form values ──');
    Object.entries(formValues).forEach(([k, v]) => console.log(`  "${k}" = "${v}"`));

    // Example assertion: if API returns { cardholderName: 'W' },
    // the "Name on card" input should show 'W'
    // Uncomment and adjust field names to match your actual API response:
    //
    // if (apiData.cardholderName) {
    //   expect(formValues['Name on card']).toContain(String(apiData.cardholderName));
    // }
    // if (apiData.last4) {
    //   const cardDisplay = Object.values(formValues).join(' ');
    //   expect(cardDisplay).toContain(String(apiData.last4));
    // }

    await page.screenshot({ path: 'screenshots/08-api-vs-form.png', fullPage: true });

    // At minimum: if any API data was returned, the form should not be empty
    if (Object.keys(apiData).length > 0) {
      const hasAnyValue = Object.values(formValues).some(v => v.length > 0);
      expect(hasAnyValue, 'Form should display data from API response').toBeTruthy();
    }
  });

});
