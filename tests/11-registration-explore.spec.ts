/**
 * Registration Flow Explorer — v2
 * Waits longer for SPA rendering and captures div/span "buttons" too.
 *
 *   npx playwright test tests/11-registration-explore.spec.ts --headed
 */
import { test } from '@playwright/test';

// Extended snapshot: captures inputs, buttons, AND clickable divs/spans/li
async function dumpFull(page: Parameters<typeof import('@playwright/test').test>[1] extends (args: infer A) => any ? A extends { page: infer P } ? P : never : never, label: string) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`[${label}]  ${page.url()}`);
  console.log('═'.repeat(64));

  const dom = await page.evaluate(() => {
    const toObj = (el: Element) => ({
      tag:        el.tagName.toLowerCase(),
      type:       (el as HTMLInputElement).type     ?? null,
      placeholder:(el as HTMLInputElement).placeholder ?? null,
      name:       (el as HTMLInputElement).name     ?? null,
      id:         el.id || null,
      class:      el.className || null,
      text:       (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) || null,
      ariaLabel:  el.getAttribute('aria-label'),
      role:       el.getAttribute('role'),
      disabled:   (el as HTMLButtonElement).disabled ?? false,
      visible:    (el as HTMLElement).offsetParent !== null,
    });

    // Capture everything that could be interactive
    const inputs   = Array.from(document.querySelectorAll('input')).map(toObj);
    const buttons  = Array.from(document.querySelectorAll('button')).map(toObj);
    const selects  = Array.from(document.querySelectorAll('select')).map(toObj);
    // Custom clickable elements (divs/spans/li with click handlers or role)
    const custom   = Array.from(document.querySelectorAll(
      '[role="button"], [role="option"], [role="radio"], ' +
      '[class*="btn"], [class*="button"], [class*="option"], [class*="card"], ' +
      '[class*="item"], [class*="type"], [class*="method"], [class*="select"]'
    )).map(toObj).filter(el => el.text && el.text.length > 0);

    return { inputs, buttons, selects, custom };
  });

  console.log(`\n── inputs (${dom.inputs.length}) ──`);
  dom.inputs.forEach(i => console.log(' ', JSON.stringify(i)));

  console.log(`\n── buttons (${dom.buttons.length}) ──`);
  dom.buttons.forEach(b => console.log(' ', JSON.stringify(b)));

  if (dom.selects.length) {
    console.log(`\n── selects (${dom.selects.length}) ──`);
    dom.selects.forEach(s => console.log(' ', JSON.stringify(s)));
  }

  console.log(`\n── custom clickable divs/spans (${dom.custom.length}) ──`);
  dom.custom.forEach(c => console.log(' ', JSON.stringify(c)));

  // Also dump full visible text so we don't miss anything
  const visibleText = await page.evaluate(() =>
    (document.body as HTMLElement).innerText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && l.length < 120)
      .slice(0, 40)
  );
  console.log('\n── Visible text (first 40 lines) ──');
  visibleText.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  console.log('\n' + '═'.repeat(64) + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────

test('EXPLORE: register page — wait for SPA render', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(500);

  // Click "Create a new account now!"
  await page.locator('a:has-text("Create a new account now!")').click();

  // Wait for URL to change to /register
  await page.waitForURL('**/register**', { timeout: 10000 });
  console.log('[Register] URL:', page.url());

  // Snapshot at 1s, 2s, 4s — find when content appears
  for (const delay of [1000, 2000, 4000]) {
    await page.waitForTimeout(delay === 1000 ? 1000 : 1000);
    const elapsed = delay;
    console.log(`\n[T+${elapsed}ms snapshot]`);
    await dumpFull(page, `Register T+${elapsed}ms`);
    await page.screenshot({ path: `screenshots/11-register-t${elapsed}.png`, fullPage: true });

    // Stop early if we found content
    const hasContent = await page.locator('button, [role="button"], input').count() > 0;
    if (hasContent) {
      console.log(`[Content appeared at T+${elapsed}ms]`);
      break;
    }
  }
});

test('EXPLORE: click through each step manually', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(500);

  // Step 1: click create account
  await page.locator('a:has-text("Create a new account now!")').click();
  await page.waitForURL('**/register**', { timeout: 10000 });
  await page.waitForTimeout(3000);

  console.log('\n=== STEP: After /register load ===');
  await dumpFull(page, 'Step: /register loaded');
  await page.screenshot({ path: 'screenshots/11-s1-register.png', fullPage: true });

  // Step 2: try clicking "Regular User" (various selector patterns)
  const regularSelectors = [
    'text="Regular User"',
    'text="Regular"',
    '[class*="regular"]',
    'div:has-text("Regular")',
    'li:has-text("Regular")',
  ];
  let clicked = false;
  for (const sel of regularSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Regular User] Found with: ${sel}`);
      await el.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log('[Regular User] NOT FOUND — check screenshot 11-s1-register.png');

  await page.waitForTimeout(2000);
  console.log('\n=== STEP: After Regular User click ===');
  await dumpFull(page, 'Step: After Regular User');
  await page.screenshot({ path: 'screenshots/11-s2-regular.png', fullPage: true });

  // Step 3: try clicking "Email Address"
  const emailSelectors = [
    'text="Email Address"',
    'text="Email"',
    '[class*="email"]',
    'div:has-text("Email Address")',
  ];
  let emailClicked = false;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Email method] Found with: ${sel}`);
      await el.click();
      emailClicked = true;
      break;
    }
  }
  if (!emailClicked) console.log('[Email method] NOT FOUND');

  await page.waitForTimeout(2000);
  console.log('\n=== STEP: After Email method click ===');
  await dumpFull(page, 'Step: After Email click');
  await page.screenshot({ path: 'screenshots/11-s3-email-method.png', fullPage: true });

  // Step 4: enter email
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  if (await emailInput.count() > 0) {
    await emailInput.fill('1144890814@qq.com');
    console.log('[Email input] Filled');
    await page.screenshot({ path: 'screenshots/11-s4-email-entered.png' });

    // Click next/send
    await page.locator('button:has-text("Next"), button:has-text("Send"), button:has-text("Continue")').first().click();
    await page.waitForTimeout(3000);

    console.log('\n=== STEP: After email submit ===');
    await dumpFull(page, 'Step: After email submit');
    await page.screenshot({ path: 'screenshots/11-s5-after-email.png', fullPage: true });
  }
});
