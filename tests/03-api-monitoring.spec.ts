/**
 * Microservice API Contract Tests
 * Endpoint map confirmed from DOM snapshot (2026-03-29):
 *
 *   POST /api/auth/loginbyemail          — login
 *   GET  /api/auth/me                    — current user
 *   GET  /api/user/user/:id              — user profile
 *   GET  /api/payments/registration/status  — payment registration status
 *   GET  /api/payments/cards/pre-auth    — pre-auth card config
 */
import { test, expect } from '@playwright/test';
import { CARDS } from './fixtures';
import { login, fillCard, submitPayment } from './helpers';
import { mockAsUnregistered } from './helpers-mock';

const BASE = 'https://lifetech.star-x-tech.com';

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Auth API', () => {

  test('POST /api/auth/loginbyemail → 200 with token/user', async ({ page }) => {
    // CORRECT pattern: start listening BEFORE triggering the action
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/auth/loginbyemail'),
      { timeout: 15000 }
    );

    await page.locator('input[placeholder="Mobile Number/Email"]').fill('andy.jia@clcn.com.au');
    await page.locator('input[type="password"]').fill('66666666');
    await page.locator('button:has-text("Continue")').click();

    const res  = await responsePromise;
    const body = await res.json();

    console.log('[loginbyemail]', res.status(), JSON.stringify(body).slice(0, 200));

    expect(res.status()).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.userId).toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payment Registration APIs', () => {

  test('GET /api/payments/registration/status → 200', async ({ page }) => {
    const resPromise = page.waitForResponse(
      r => r.url().includes('/api/payments/registration/status'),
      { timeout: 15000 }
    );
    await login(page);
    const res = await resPromise;
    const body = await res.json().catch(() => null);
    console.log('[registration/status]', res.status(), JSON.stringify(body).slice(0, 200));
    expect(res.status()).toBe(200);
  });

  test('GET /api/payments/cards/pre-auth → 200', async ({ page }) => {
    const resPromise = page.waitForResponse(
      r => r.url().includes('/api/payments/cards/pre-auth'),
      { timeout: 15000 }
    );
    await login(page);
    const res = await resPromise;
    const body = await res.json().catch(() => null);
    console.log('[cards/pre-auth]', res.status(), JSON.stringify(body).slice(0, 200));
    expect(res.status()).toBe(200);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Full Payment Flow — API Monitoring', () => {

  test('capture all app API calls during payment submission', async ({ page }) => {
    await mockAsUnregistered(page); // ensure payment form is shown
    const calls: { method: string; url: string; status: number; body: unknown; ms: number }[] = [];

    page.on('request', req => {
      if (req.url().includes(BASE)) {
        (req as any)._t = Date.now();
      }
    });
    page.on('response', async res => {
      if (res.url().includes(BASE) && res.url().includes('/api/')) {
        const body = await res.json().catch(() => null);
        calls.push({
          method: res.request().method(),
          url:    res.url().replace(BASE, ''),
          status: res.status(),
          body,
          ms:     Date.now() - ((res.request() as any)._t ?? Date.now()),
        });
      }
    });

    await login(page);
    await fillCard(page, CARDS.visa_success);
    await submitPayment(page);
    await page.waitForTimeout(6000);

    console.log('\n══ App API Call Report ══════════════════════════════');
    for (const c of calls) {
      const icon = c.status >= 400 ? '❌' : '✅';
      console.log(`${icon} [${c.method}] ${c.url}  →  ${c.status}  (${c.ms}ms)`);
      if (c.body) console.log('   ', JSON.stringify(c.body).slice(0, 150));
    }
    console.log('═════════════════════════════════════════════════════\n');

    expect(calls.length).toBeGreaterThan(0);
    const failed = calls.filter(c => c.status >= 400);
    if (failed.length > 0) console.warn('[WARN] Failed calls:', failed.map(c => `${c.status} ${c.url}`));
  });

  test('no card data leaked in API responses', async ({ page }) => {
    await mockAsUnregistered(page);
    const responseBodies: { url: string; text: string }[] = [];

    page.on('response', async res => {
      if (res.url().includes(BASE)) {
        const text = await res.text().catch(() => '');
        responseBodies.push({ url: res.url(), text });
      }
    });

    await login(page);
    await fillCard(page, CARDS.visa_success);
    await submitPayment(page);
    await page.waitForTimeout(6000);

    const rawNumber = CARDS.visa_success.number.replace(/\s/g, '');
    const leakedCard = responseBodies.find(r => r.text.includes(rawNumber));
    if (leakedCard) console.error('[SECURITY ❌] Card number in response:', leakedCard.url);
    expect(leakedCard).toBeUndefined();

    const leakedCvc = responseBodies.find(r =>
      r.text.includes(`"cvc":"${CARDS.visa_success.cvc}"`) ||
      r.text.includes(`"cvv":"${CARDS.visa_success.cvc}"`)
    );
    if (leakedCvc) console.error('[SECURITY ❌] CVC in response:', leakedCvc.url);
    expect(leakedCvc).toBeUndefined();

    console.log('[Security] No card data leaked in responses ✓');
  });

  test('all app API responses within 5s', async ({ page }) => {
    // Performance test only covers login + page-load APIs.
    // Does NOT submit payment (avoids state mutation and iframe dependency).
    const calls: { url: string; ms: number; status: number }[] = [];

    page.on('request', req => {
      if (req.url().includes(BASE) && req.url().includes('/api/')) {
        (req as any)._t = Date.now();
      }
    });
    page.on('response', res => {
      if (res.url().includes(BASE) && res.url().includes('/api/')) {
        const ms = Date.now() - ((res.request() as any)._t ?? Date.now());
        calls.push({ url: res.url().replace(BASE, ''), ms, status: res.status() });
      }
    });

    await login(page);
    await page.waitForTimeout(3000); // let all page-load calls complete

    console.log('\n── API Response Times ──');
    calls.forEach(c => {
      const tag = c.ms > 5000 ? '❌ SLOW' : c.ms > 2000 ? '⚠️ ' : '✅';
      console.log(`  ${tag} ${c.ms}ms  ${c.status}  ${c.url}`);
    });

    const slow = calls.filter(c => c.ms > 5000);
    if (slow.length > 0) {
      console.warn('[PERF] Slow responses (>5s):');
      slow.forEach(s => console.warn(`  ${s.ms}ms — ${s.url}`));
    }
    expect(slow, `${slow.length} API(s) exceeded 5s threshold`).toHaveLength(0);
  });

});
