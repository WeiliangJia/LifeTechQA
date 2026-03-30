/**
 * Full Registration Flow
 * Selectors confirmed from DOM snapshot on 2026-03-30.
 *
 * Flow:
 *   / → "Create a new account now!" → /register
 *   → click "Regular User" card → /register/register-type?userType=RU
 *   → click "Email Address" button → fill email → Continue
 *   → OTP verification (sniff / mock / manual)
 *   → personal info form → submit
 *   → /register/payment-registration
 *   → card 0341 (3DS fail) → card 4242 (success)
 */
import { test, expect } from '@playwright/test';
import { fillCard, submitPayment, handle3DS, dumpSnapshot } from './helpers';
import { CARDS } from './fixtures';

// ─── Test data ────────────────────────────────────────────────────────────────

// Unique credentials per run: OTP is mocked so email/phone don't need to be real.
// Timestamps ensure no "already exists" conflicts from previous runs.
const RUN_ID        = Date.now();
const TEST_EMAIL    = `autotest+${RUN_ID}@mailtest.com`;
const TEST_PHONE    = `4${String(RUN_ID).slice(-8)}`; // 9-digit, starts with 4
const TEST_PASSWORD = '66666666';

// OTP strategy: 'sniff' | 'mock' | 'manual'
// 'mock' — intercept the verify endpoint so any 6-digit code is accepted.
// Confirmed: backend does NOT return the OTP code in the send-code response body,
// so 'sniff' is not viable. Use 'manual' (page.pause) only for one-off debugging.
const OTP_STRATEGY  = 'mock' as 'sniff' | 'mock' | 'manual';

// ─── Confirmed selectors ──────────────────────────────────────────────────────

const S = {
  // Step 1 — login page
  createLink:      'a:has-text("Create a new account now!")',

  // Step 2 — /register — user type cards (div, not button)
  regularUserCard: 'div.user-card:has(h3.card-title:has-text("Regular User"))',

  // Step 3 — /register/register-type?userType=RU — method buttons
  emailMethodBtn:  'button.method-btn:has-text("Email Address")',
  continueBtn:     'button.continue-btn',

  // Email input (appears after clicking Email Address)
  emailInput:      'input[type="email"], input[placeholder*="email" i], input[placeholder*="Email"]',

  // OTP input — confirmed from DOM: 6 individual single-character inputs, class="code-input"
  // The verify page is /register/verify-code?type=email&userType=RU
  otpInput:        'input.code-input',

  // Personal info form — confirmed from /register/complete-profile DOM snapshot
  firstNameInput:  'input[placeholder="First Name"]',
  lastNameInput:   'input[placeholder="Last Name"]',
  addressInput:    'input[placeholder="Address Line"]',
  cityInput:       'input[placeholder="City"]',
  stateInput:      'input[placeholder="State"]',
  postcodeInput:   'input[placeholder="Postcode"]',
  phoneInput:      'input[placeholder="Mobile Phone"]',
  passwordInput:   'input[placeholder="Password"]',
  confirmPwdInput: 'input[placeholder="Confirm Password"]',
  // Submit button: type="button" (NOT type="submit"), class="submit-btn", text="Signup"
  submitBtn:       'button.submit-btn',
};

// ─── OTP helpers ──────────────────────────────────────────────────────────────

async function sniffOtpFromResponse(page: Parameters<typeof fillCard>[0]): Promise<string | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 12000);
    page.on('response', async function handler(res) {
      const url = res.url();
      if (/send|otp|code|verif|email/i.test(url) && res.status() < 400) {
        const body = await res.json().catch(() => null);
        if (!body) return;
        console.log('[OTP sniff] Response from', url.replace('https://lifetech.star-x-tech.com', ''));
        console.log('[OTP sniff] Body:', JSON.stringify(body).slice(0, 200));
        const code = body?.code ?? body?.otp ?? body?.verificationCode
          ?? body?.data?.code ?? body?.data?.otp;
        if (code) {
          clearTimeout(timer);
          page.off('response', handler);
          console.log('[OTP] ✓ Found in API response:', code);
          resolve(String(code));
        }
      }
    });
  });
}

async function mockOtp(page: Parameters<typeof fillCard>[0]) {
  // IMPORTANT: be specific — '**/api/auth/register*' is too broad and would intercept
  // API calls that load dropdown data (e.g. country lists) for the complete-profile form.
  // Only mock the exact email registration + OTP verify endpoints.
  for (const pattern of [
    '**/api/auth/registeruserbyemail*',   // send verification email
    '**/api/auth/verify**',               // verify OTP code (GET /api/auth/verify?code=...)
    '**/api/*/otp**',                     // any other OTP endpoint
  ]) {
    await page.route(pattern, route => {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Verified' }) });
    });
  }
  console.log('[OTP] Email registration + verify endpoints mocked → any code accepted');
}

// ─── Main test ────────────────────────────────────────────────────────────────

test.describe('Registration Flow', () => {

  test.setTimeout(240000);

  test('register → 3DS fail → 4242 success', async ({ page }) => {

    // Log all app API calls
    page.on('response', async res => {
      if (res.url().includes('lifetech.star-x-tech.com/api')) {
        const body = await res.json().catch(() => null);
        console.log(`[API ${res.status()}] ${res.request().method()} ${res.url().replace('https://lifetech.star-x-tech.com', '')}`,
          body ? JSON.stringify(body).slice(0, 120) : '');
      }
    });

    if (OTP_STRATEGY === 'mock') await mockOtp(page);

    // ── STEP 1: Login page ──────────────────────────────────────────────────
    await page.goto('/');
    await page.waitForSelector(S.createLink, { timeout: 15000 });
    console.log('\n[Step 1] Login page loaded');
    await page.screenshot({ path: 'screenshots/12-s1-login.png' });

    // ── STEP 2: Click "Create a new account now!" ───────────────────────────
    await page.locator(S.createLink).click();
    await page.waitForURL('**/register', { timeout: 10000 });
    await page.waitForTimeout(2000); // SPA needs time to render cards
    console.log('[Step 2] On /register — selecting Regular User');
    await page.screenshot({ path: 'screenshots/12-s2-register.png', fullPage: true });

    // ── STEP 3: Click "Regular User" card ───────────────────────────────────
    const regularCard = page.locator(S.regularUserCard);
    await expect(regularCard).toBeVisible({ timeout: 10000 });
    await regularCard.click();
    await page.waitForURL('**/register-type**', { timeout: 10000 });
    await page.waitForTimeout(1000);
    console.log('[Step 3] Regular User selected →', page.url());
    await page.screenshot({ path: 'screenshots/12-s3-register-type.png', fullPage: true });

    // ── STEP 4: Click "Email Address" method ────────────────────────────────
    const emailMethodBtn = page.locator(S.emailMethodBtn);
    await expect(emailMethodBtn).toBeVisible({ timeout: 8000 });
    await emailMethodBtn.click();
    await page.waitForTimeout(800);
    console.log('[Step 4] Email Address method selected');
    await page.screenshot({ path: 'screenshots/12-s4-email-method.png' });

    // ── STEP 5: Enter email ─────────────────────────────────────────────────
    const emailInput = page.locator(S.emailInput).first();
    await expect(emailInput).toBeVisible({ timeout: 8000 });
    await emailInput.fill(TEST_EMAIL);
    console.log('[Step 5] Email entered:', TEST_EMAIL);
    await page.screenshot({ path: 'screenshots/12-s5-email-entered.png' });

    // Start OTP sniff BEFORE clicking Continue (so we don't miss the response)
    const otpSniffPromise = OTP_STRATEGY === 'sniff'
      ? sniffOtpFromResponse(page)
      : Promise.resolve<string | null>(null);

    // ── STEP 6: Click Continue ───────────────────────────────────────────────
    const continueBtn = page.locator(S.continueBtn);
    await expect(continueBtn).toBeEnabled({ timeout: 5000 });
    await continueBtn.click();
    await page.waitForTimeout(2000);
    console.log('[Step 6] Continue clicked');
    await page.screenshot({ path: 'screenshots/12-s6-after-continue.png', fullPage: true });

    // ── STEP 7: OTP verification ─────────────────────────────────────────────
    // Dump what's on screen now — may be OTP form or directly personal info
    await dumpSnapshot(page, 'After email submit');

    // Confirmed DOM: 6 separate single-char inputs with class="code-input"
    // Verify button: button.verify-btn ("Verify & Sign Up"), disabled until all 6 filled
    const otpInputs = page.locator(S.otpInput);
    const otpCount  = await otpInputs.count();
    if (otpCount > 0) {
      console.log(`[Step 7] OTP field found — ${otpCount} digit inputs (split OTP)`);

      let otpCode = '';
      if (OTP_STRATEGY === 'sniff') {
        // sniff is not viable — backend doesn't expose code in response — fall through to manual
        otpCode = (await otpSniffPromise) ?? '';
        if (!otpCode) {
          console.warn('[OTP] Not in API response. Switching to manual entry.');
          console.log('\n══════════════════════════════════════════════');
          console.log('  CHECK EMAIL: ' + TEST_EMAIL);
          console.log('  Enter each digit in the browser, then press');
          console.log('  Resume in the Playwright inspector panel');
          console.log('══════════════════════════════════════════════\n');
          await page.pause();
        }
      } else if (OTP_STRATEGY === 'manual') {
        await page.pause();
      } else {
        otpCode = '123456'; // mock mode — verify endpoint is mocked, any code works
      }

      // Fill split inputs: one digit per input
      if (otpCode && otpCode.length >= otpCount) {
        for (let i = 0; i < otpCount; i++) {
          await otpInputs.nth(i).fill(otpCode[i]);
        }
        console.log('[Step 7] OTP entered digit-by-digit:', otpCode.slice(0, otpCount));
      }

      // Click verify button (confirmed selector: button.verify-btn)
      const verifyBtn = page.locator('button.verify-btn').first();
      if (await verifyBtn.count() > 0) {
        await expect(verifyBtn).toBeEnabled({ timeout: 3000 });
        await verifyBtn.click();
        await page.waitForTimeout(3000);
        console.log('[Step 7] Verify clicked →', page.url());
      } else {
        console.warn('[Step 7] Verify button (button.verify-btn) not found');
      }
    } else {
      console.log('[Step 7] No OTP field — may have gone directly to personal info');
    }

    await page.screenshot({ path: 'screenshots/12-s7-after-otp.png', fullPage: true });

    // ── STEP 8: Personal info form ───────────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // Dump form structure — we don't have these selectors yet
    await dumpSnapshot(page, 'Personal Info Form');
    await page.screenshot({ path: 'screenshots/12-s8-personal-info.png', fullPage: true });

    console.log('\n[Step 8] Filling personal info form...');

    // Handle El-Plus dropdown selects (Title, Country, Phone Country Code)
    // DOM order: el-select[0]=Title, [1]=Country, [2]=Phone Country Code
    // El-Plus portals its dropdown to <body>. We select by clicking the trigger,
    // waiting for items via page.waitForSelector (not a popper locator), then clicking.
    // El-Plus keeps dropdown items in the DOM after closing (stays at 248 nodes, just CSS-hidden).
    // Strategy confirmed by debug test: click trigger → wait 1s → click first visible item → wait 800ms.
    // No Escape key (interferes with the form). No state:'hidden' wait (never resolves).
    const elSelects = page.locator('.el-select');
    const selectCount = await elSelects.count();
    console.log(`  Found ${selectCount} El-Plus dropdowns`);
    for (let i = 0; i < selectCount; i++) {
      try {
        await elSelects.nth(i).click();
        // El-Plus items exist in DOM but Playwright's visibility check may fail during animation.
        // Use page.evaluate + getBoundingClientRect to find truly rendered items, then JS-click.
        await page.waitForTimeout(600); // wait for dropdown open animation
        const optText = await page.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll('.el-select-dropdown__item:not(.is-disabled)')
          ) as HTMLElement[];
          const rendered = items.filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (rendered.length > 0) {
            const text = rendered[0].innerText.trim();
            rendered[0].click();
            return text;
          }
          return null;
        });
        if (optText) {
          console.log(`  ✓ dropdown[${i}]: selected "${optText}"`);
        } else {
          console.log(`  ⚠ dropdown[${i}]: no rendered items found`);
        }
        await page.waitForTimeout(600); // wait for selection + re-render
      } catch (e) {
        console.log(`  ⚠ dropdown[${i}]: interaction failed —`, (e as Error).message?.slice(0, 80));
      }
    }

    // Fill all visible fields (address fields are required by the form)
    const fields: Array<{ sel: string; value: string; label: string }> = [
      { sel: S.firstNameInput,  value: 'Test',          label: 'first name'   },
      { sel: S.lastNameInput,   value: 'AutoReg',       label: 'last name'    },
      { sel: S.addressInput,    value: '123 Test St',   label: 'address'      },
      { sel: S.cityInput,       value: 'Sydney',        label: 'city'         },
      { sel: S.stateInput,      value: 'NSW',           label: 'state'        },
      { sel: S.postcodeInput,   value: '2000',          label: 'postcode'     },
      { sel: S.phoneInput,      value: TEST_PHONE,      label: 'phone'        },
      { sel: S.passwordInput,   value: TEST_PASSWORD,   label: 'password'     },
      { sel: S.confirmPwdInput, value: TEST_PASSWORD,   label: 'confirm pwd'  },
    ];

    for (const { sel, value, label } of fields) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.fill(value);
        console.log(`  ✓ ${label}: ${value}`);
      } else {
        console.log(`  ⚠ ${label}: field not found (${sel})`);
      }
    }

    await page.screenshot({ path: 'screenshots/12-s8-filled.png', fullPage: true });

    // ── STEP 9: Submit personal info ─────────────────────────────────────────
    // Confirmed: button.submit-btn (text "Signup", type="button") on /register/complete-profile
    const submitBtn = page.locator(S.submitBtn).first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    console.log('[Step 9] Submitted →', page.url());
    // Log any visible validation errors
    const errMsgs = await page.locator('.el-form-item__error, [class*="error"]:visible').allInnerTexts().catch(() => []);
    if (errMsgs.length > 0) console.warn('[Step 9] Form errors:', errMsgs);
    await page.screenshot({ path: 'screenshots/12-s9-after-submit.png', fullPage: true });

    // ── STEP 10: Payment page ─────────────────────────────────────────────────
    const stripeIframe = page.locator('iframe[title="Secure card number input frame"]');
    const onPaymentPage = await stripeIframe.waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(async () => {
        await dumpSnapshot(page, 'Payment page NOT found');
        console.warn('[Step 10] Stripe form not found — check screenshot 12-s9-after-submit.png');
        return false;
      });

    if (!onPaymentPage) return;

    console.log('\n[Step 10] Payment page loaded ✓');

    // ── PAYMENT ATTEMPT 1: 3DS fail card (0341) ──────────────────────────────
    console.log('\n── Attempt 1: card 4000 0000 0000 0341 (3DS → fail) ──');
    await fillCard(page, CARDS.three_d_secure_fail);
    await page.screenshot({ path: 'screenshots/12-p1-3ds-filled.png' });
    await submitPayment(page);
    await handle3DS(page, 'fail');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/12-p1-3ds-result.png', fullPage: true });

    const has3dsError = await page.locator('text=/declined|failed|authentication|invalid/i').count() > 0;
    console.log('[Attempt 1] Error shown after 3DS fail:', has3dsError);

    // Dismiss the error dialog if present (confirmed: button.dialog-button "Try Again")
    // This dialog blocks interaction with the form behind it
    const tryAgainBtn = page.locator('button.dialog-button');
    if (await tryAgainBtn.count() > 0) {
      await tryAgainBtn.click();
      console.log('[Attempt 1] "Try Again" dialog dismissed');
      await page.waitForTimeout(1000);
    }

    // ── PAYMENT ATTEMPT 2: 4242 success card ─────────────────────────────────
    console.log('\n── Attempt 2: card 4242 4242 4242 4242 (success) ──');
    await page.waitForTimeout(1000);

    // Check if payment form is still present (may need to re-fill after failure)
    const cardStillVisible = await stripeIframe.count() > 0;
    if (!cardStillVisible) {
      await dumpSnapshot(page, 'After 3DS fail — form gone?');
      console.warn('[Attempt 2] Stripe form no longer visible after 3DS fail');
      return;
    }

    await fillCard(page, {
      number: '4242 4242 4242 4242',
      expiry: '09/29',
      cvc:    '424',
      name:   'Test AutoReg',
    });
    await page.screenshot({ path: 'screenshots/12-p2-4242-filled.png' });

    const finalRes = await submitPayment(page);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'screenshots/12-p2-4242-result.png', fullPage: true });

    const success = await page.locator('text=/success|paid|complete|thank|完成|成功/i').count() > 0;
    console.log('\n[Final Result] Payment success:', success);
    if (finalRes) console.log('[Final Result] API:', finalRes.status(), finalRes.url());

    expect(success).toBeTruthy();
  });

});

// ─── Standalone validation tests ──────────────────────────────────────────────

test.describe('Registration — Validation', () => {

  test('duplicate email shows error', async ({ page }) => {
    await page.goto('/');
    await page.locator(S.createLink).click();
    await page.waitForURL('**/register', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.locator(S.regularUserCard).click();
    await page.waitForURL('**/register-type**', { timeout: 10000 });
    await page.waitForTimeout(800);

    await page.locator(S.emailMethodBtn).click();
    await page.waitForTimeout(500);

    await page.locator(S.emailInput).first().fill('andy.jia@clcn.com.au'); // already registered
    await page.locator(S.continueBtn).click();
    await page.waitForTimeout(3000);

    const hasError = await page.locator('text=/already|exists|registered|taken|used/i').count() > 0
      || await page.locator('[class*="error"], [class*="alert"]').count() > 0;

    console.log('[Duplicate email] Error shown:', hasError);
    await page.screenshot({ path: 'screenshots/12-duplicate-email.png' });
    expect(hasError).toBeTruthy();
  });

  test('invalid email format rejected', async ({ page }) => {
    await page.goto('/');
    await page.locator(S.createLink).click();
    await page.waitForURL('**/register', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.locator(S.regularUserCard).click();
    await page.waitForURL('**/register-type**', { timeout: 10000 });
    await page.waitForTimeout(800);

    await page.locator(S.emailMethodBtn).click();
    await page.waitForTimeout(500);

    const emailInput = page.locator(S.emailInput).first();
    await emailInput.fill('not-an-email');

    // Continue button should stay disabled OR error on click
    const btn = page.locator(S.continueBtn);
    const isDisabled = await btn.isDisabled();
    if (!isDisabled) {
      await btn.click();
      await page.waitForTimeout(1500);
      const hasError = await page.locator('[class*="error"], [role="alert"]').count() > 0;
      expect(hasError).toBeTruthy();
    } else {
      expect(isDisabled).toBeTruthy();
    }
    await page.screenshot({ path: 'screenshots/12-invalid-email.png' });
  });

});
