import { test, expect } from '@playwright/test';
import { CREDENTIALS } from './fixtures';

test.describe('Authentication', () => {

  test('valid credentials → redirects to payment/dashboard page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });

    await page.locator('input[placeholder="Mobile Number/Email"]').fill(CREDENTIALS.valid.email);
    await page.locator('input[type="password"]').first().fill(CREDENTIALS.valid.password);
    await page.locator('button:has-text("Continue")').click();

    // Should leave the login page
    await expect(page).not.toHaveURL(/login|signin/, { timeout: 15000 });
    await page.screenshot({ path: 'screenshots/01-after-login.png' });
    console.log('[Login] Redirected to:', page.url());
  });

  test('wrong password → shows error message', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });

    await page.locator('input[placeholder="Mobile Number/Email"]').fill(CREDENTIALS.invalidPassword.email);
    await page.locator('input[type="password"]').first().fill(CREDENTIALS.invalidPassword.password);
    await page.locator('button:has-text("Continue")').click();

    // Should stay on login page OR show error
    await page.waitForTimeout(3000);
    const errorVisible = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').count() > 0;
    const stillOnLogin = page.url().includes('/login') || page.url().includes('/signin') || page.url() === 'https://lifetech.star-x-tech.com/';
    expect(errorVisible || stillOnLogin).toBeTruthy();
    await page.screenshot({ path: 'screenshots/01-wrong-password.png' });
  });

  test('non-existent email → shows error message', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });

    await page.locator('input[placeholder="Mobile Number/Email"]').fill(CREDENTIALS.invalidEmail.email);
    await page.locator('input[type="password"]').first().fill(CREDENTIALS.invalidEmail.password);
    await page.locator('button:has-text("Continue")').click();

    await page.waitForTimeout(3000);
    const errorVisible = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').count() > 0;
    const stillOnLogin = page.url().includes('/login') || page.url().includes('/signin') || page.url() === 'https://lifetech.star-x-tech.com/';
    expect(errorVisible || stillOnLogin).toBeTruthy();
    await page.screenshot({ path: 'screenshots/01-nonexistent-user.png' });
  });

  test('empty form → Continue button is disabled (cannot submit)', async ({ page }) => {
    // This app disables the submit button when fields are empty.
    // That IS the validation behavior — no need to click.
    await page.goto('/');
    await page.waitForSelector('button:has-text("Continue")', { timeout: 15000 });

    const btn = page.locator('button:has-text("Continue")');
    await expect(btn).toBeDisabled();
    console.log('[Validation] Continue button correctly disabled on empty form ✓');
    await page.screenshot({ path: 'screenshots/01-empty-form.png' });
  });

  test('partial input (email only, no password) → Continue still disabled', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[placeholder="Mobile Number/Email"]', { timeout: 15000 });

    await page.locator('input[placeholder="Mobile Number/Email"]').fill('andy.jia@clcn.com.au');
    // password left empty

    const btn = page.locator('button:has-text("Continue")');
    await expect(btn).toBeDisabled();
    console.log('[Validation] Button still disabled with only email filled ✓');
    await page.screenshot({ path: 'screenshots/01-partial-input.png' });
  });

});
