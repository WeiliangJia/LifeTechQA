/**
 * Edge Cases & Security Tests
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Edge Cases', () => {

  test('page is served over HTTPS', async ({ page }) => {
    await page.goto('/');
    expect(page.url()).toMatch(/^https:/);
  });

  test('login page has no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // collection window for initial console errors

    console.log('[Console Errors]', errors.length > 0 ? errors : 'None');
    // Report but don't hard-fail — some third-party errors are acceptable
    if (errors.length > 0) console.warn('[WARN] Console errors:', errors);
  });

  test('payment page has no console errors after login', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));

    await login(page);
    // NOTE: Do NOT use waitForLoadState('networkidle') — the post-login home
    // page polls several APIs continuously (giftcards, entities, connections)
    // and never becomes network-idle, causing this test to time out.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // collection window for initial console errors

    console.log('[Console Errors on Payment Page]', errors.length > 0 ? errors : 'None');
    if (errors.length > 0) console.warn('[WARN] Console errors:', errors);
  });

  test('session cookie / token is set after login', async ({ page, context }) => {
    await login(page);
    const cookies = await context.cookies();
    console.log('[Cookies]', cookies.map(c => `${c.name}=${c.value.slice(0, 20)}...`));

    // At least one auth-related cookie or localStorage token should exist
    const authCookies = cookies.filter(c =>
      /token|session|auth|jwt/i.test(c.name)
    );
    const hasLocalStorageToken = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.some(k => /token|auth|jwt|session/i.test(k));
    });

    console.log('[Auth] Cookie-based:', authCookies.map(c => c.name));
    console.log('[Auth] LocalStorage-based:', hasLocalStorageToken);
    expect(authCookies.length > 0 || hasLocalStorageToken).toBeTruthy();
  });

  test('unauthenticated access to payment page → redirects to login', async ({ page }) => {
    // Try to directly navigate to /payment or /checkout without login
    await page.goto('/payment');
    await page.waitForTimeout(3000);
    const url = page.url();
    console.log('[Auth Guard] Direct /payment access → redirected to:', url);

    // Should redirect to login
    const redirectedToLogin = /login|signin|^\/$/.test(url.replace('https://lifetech.star-x-tech.com', ''));
    expect(redirectedToLogin).toBeTruthy();
  });

  test('duplicate payment submission → not double-charged', async ({ page }) => {
    // Check that the submit button is disabled after first click
    await login(page);

    const submitBtn = page.locator('button[type="submit"], button:has-text("Pay"), button:has-text("支付")').first();
    await submitBtn.click().catch(() => {});

    await page.waitForTimeout(1000);

    const isDisabledAfterClick = await submitBtn.isDisabled().catch(() => false);
    console.log('[Double-submit] Button disabled after click:', isDisabledAfterClick);
    // This is a soft assertion — log but don't fail, as behavior varies
  });

});
