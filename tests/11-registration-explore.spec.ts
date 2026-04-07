/**
 * Registration Flow Explorer — v2
 * Waits longer for SPA rendering and captures div/span "buttons" too.
 *
 *   npx playwright test tests/11-registration-explore.spec.ts --headed
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Extended snapshot: captures inputs, buttons, AND clickable divs/spans/li
async function dumpFull(page: Page, label: string) {
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
  // ── Mock OTP before any navigation ────────────────────────────────────────
  // All registration explore tests use a generated email + mocked OTP.
  // Never use a real email or wait for a real verification code.
  const TEST_EMAIL = `autotest+${Date.now()}@mailtest.com`;
  for (const pattern of [
    '**/api/auth/registeruserbyemail*',
    '**/api/auth/verify**',
    '**/api/*/otp**',
  ]) {
    await page.route(pattern, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Verified' }),
    }));
  }
  console.log(`[Mock] OTP endpoints mocked — using email: ${TEST_EMAIL}`);

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

  // Step 4: enter email — always use generated mock email
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  if (await emailInput.count() > 0) {
    await emailInput.fill(TEST_EMAIL);
    console.log('[Email input] Filled');

    // Click next/send
    await page.locator('button:has-text("Next"), button:has-text("Send"), button:has-text("Continue")').first().click();
    await page.waitForTimeout(3000);

    console.log('\n=== STEP: After email submit ===');
    await dumpFull(page, 'Step: After email submit');
  }
});

// ─────────────────────────────────────────────────────────────────────────────

test('EXPLORE: Professional User registration path', async ({ page }) => {
  // ── Mock OTP before any navigation ────────────────────────────────────────
  const TEST_EMAIL = `autotest+${Date.now()}@mailtest.com`;
  for (const pattern of [
    '**/api/auth/registeruserbyemail*',
    '**/api/auth/verify**',
    '**/api/*/otp**',
  ]) {
    await page.route(pattern, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Verified' }),
    }));
  }
  console.log(`[Mock] OTP endpoints mocked — using email: ${TEST_EMAIL}`);

  await page.goto('/');
  await page.waitForSelector('input', { timeout: 15000 });
  await page.waitForTimeout(500);

  // ── Step 1: navigate to /register ─────────────────────────────────────────
  await page.locator('a:has-text("Create a new account now!")').click();
  await page.waitForURL('**/register**', { timeout: 10000 });
  await page.waitForTimeout(3000);

  console.log('\n=== STEP 1: /register loaded ===');
  await dumpFull(page, 'Step 1: /register');

  // ── Step 2: click "Professional User" card ─────────────────────────────────
  const proSelectors = [
    'text="Professional User"',
    'text="Professional"',
    '[class*="professional"]',
    'div:has-text("Professional User")',
    'li:has-text("Professional")',
    '[class*="pro"]:has-text("Professional")',
    'button:has-text("Professional")',
  ];
  let clicked = false;
  for (const sel of proSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Professional User] Clicking with selector: ${sel}`);
      await el.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log('[Professional User] NOT FOUND — check snapshot above');

  await page.waitForTimeout(2000);
  console.log('\n=== STEP 2: After Professional User click ===');
  await dumpFull(page, 'Step 2: After Professional User click');

  // ── Step 3: select Email Address method ───────────────────────────────────
  const emailMethodSelectors = [
    'text="Email Address"',
    'text="Email"',
    '[class*="email"]',
    'div:has-text("Email Address")',
    'button:has-text("Email")',
  ];
  let emailMethodClicked = false;
  for (const sel of emailMethodSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Email method] Clicking with selector: ${sel}`);
      await el.click();
      emailMethodClicked = true;
      break;
    }
  }
  if (!emailMethodClicked) console.log('[Email method] NOT FOUND');

  await page.waitForTimeout(2000);
  console.log('\n=== STEP 3: After Email method click ===');
  await dumpFull(page, 'Step 3: After Email method click');

  // ── Step 4: fill email and submit ─────────────────────────────────────────
  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
  if (await emailInput.count() > 0) {
    await emailInput.fill(TEST_EMAIL);
    console.log(`[Email] Filled: ${TEST_EMAIL}`);

    await page.locator('button:has-text("Next"), button:has-text("Send"), button:has-text("Continue")').first().click();
    await page.waitForTimeout(3000);

    console.log('\n=== STEP 4: After email submit ===');
    await dumpFull(page, 'Step 4: After email submit');
  } else {
    console.log('[Email input] NOT FOUND — check Step 3 snapshot');
  }

  // ── Step 5: handle OTP step (mocked — just click next if input appears) ───
  const otpInput = page.locator('input[placeholder*="code" i], input[placeholder*="otp" i], input[maxlength="6"], input[maxlength="4"]').first();
  if (await otpInput.count() > 0) {
    await otpInput.fill('123456');
    console.log('[OTP] Filled mock code');

    await page.locator('button:has-text("Verify"), button:has-text("Next"), button:has-text("Confirm")').first().click();
    await page.waitForTimeout(3000);

    console.log('\n=== STEP 5: After OTP submit ===');
    await dumpFull(page, 'Step 5: After OTP submit');
  } else {
    console.log('[OTP input] NOT FOUND — OTP step may have been skipped by mock or different selector');
    console.log('\n=== STEP 5: Current state (no OTP input) ===');
    await dumpFull(page, 'Step 5: No OTP input found');
  }

  // ── Step 6: profile/details form ──────────────────────────────────────────
  await page.waitForTimeout(2000);
  console.log('\n=== STEP 6: Profile/details form ===');
  await dumpFull(page, 'Step 6: Profile/details form');

  // Try to fill visible text inputs one by one — just to see what fields exist
  const allInputs = await page.locator('input:visible').all();
  console.log(`[Profile] Found ${allInputs.length} visible inputs`);
  for (let i = 0; i < allInputs.length; i++) {
    const inp = allInputs[i];
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    const nm = await inp.getAttribute('name').catch(() => '');
    const tp = await inp.getAttribute('type').catch(() => '');
    console.log(`  [input ${i}] type=${tp} name=${nm} placeholder=${ph}`);
  }

  // ── Step 7: OTP — 6x input.code-input ────────────────────────────────────
  const otpInputs = page.locator('input.code-input');
  const otpCount  = await otpInputs.count();
  if (otpCount > 0) {
    console.log(`[OTP] Found ${otpCount} code inputs (input.code-input) — filling 1..6`);
    for (let i = 0; i < otpCount; i++) {
      await otpInputs.nth(i).click();
      await otpInputs.nth(i).fill(String(i + 1));
    }
    const verifyBtn = page.locator('button.verify-btn');
    if (await verifyBtn.count() > 0) {
      console.log(`[OTP] verify-btn found, enabled=${await verifyBtn.isEnabled()}`);
      await verifyBtn.click();
      await page.waitForTimeout(4000);
      console.log('\n=== STEP 7: After OTP verify ===');
      await dumpFull(page, 'Step 7: After OTP verify');
    }
  } else {
    console.log('[OTP] input.code-input NOT found');
  }

  // ── Step 8: Profile/details form (post-OTP) ───────────────────────────────
  await page.waitForTimeout(2000);
  console.log('\n=== STEP 8: Profile form (post-OTP) ===');
  await dumpFull(page, 'Step 8: Profile form');

  // Fill password fields if present
  const pwdInputs = await page.locator('input[type="password"]').all();
  if (pwdInputs.length > 0) {
    for (const inp of pwdInputs) await inp.fill('66666666');
    console.log(`[Password] Filled ${pwdInputs.length} password input(s)`);
  }

  // Fill all visible text inputs
  const textInputs = await page.locator('input[type="text"]:visible, input[type="email"]:visible').all();
  console.log(`[Profile] Found ${textInputs.length} text/email inputs`);
  for (const inp of textInputs) {
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    const nm = await inp.getAttribute('name').catch(() => '');
    const cl = await inp.getAttribute('class').catch(() => '');
    console.log(`  → placeholder="${ph}" name="${nm}" class="${cl}"`);
  }

  // ── Step 9: Submit whatever button is on this form ────────────────────────
  const submitBtns = await page.locator('button[type="submit"]:visible').all();
  console.log(`[Submit] Found ${submitBtns.length} submit buttons`);
  for (const btn of submitBtns) {
    const txt = await btn.textContent().catch(() => '');
    const cls = await btn.getAttribute('class').catch(() => '');
    const dis = await btn.isDisabled().catch(() => true);
    console.log(`  → text="${txt?.trim()}" class="${cls}" disabled=${dis}`);
  }

  // ── Step 9: payment step (if reached) ─────────────────────────────────────
  await page.waitForTimeout(2000);
  console.log('\n=== STEP 9: Final state (payment page?) ===');
  await dumpFull(page, 'Step 9: Final state');
  console.log('[URL]', page.url());
});
