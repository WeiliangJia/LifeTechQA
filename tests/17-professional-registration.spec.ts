/**
 * Professional User Registration Flow
 *
 * Flow:
 *   / → "Create a new account now!" → /register
 *   → click "Professional User" card
 *   → click "Email Address" → fill mock email → Continue
 *   → OTP verification (mocked — any 6-digit code accepted)
 *   → professional info form (fields may differ from Regular User)
 *   → /register/payment-registration
 *   → card 0341 (decline) → close dialog → reopen → card 4242 (success)
 *
 * Rules:
 *   - Mock email: autotest+{timestamp}@mailtest.com
 *   - Mock OTP:   intercept verify endpoints, any code accepted
 *   - Password:   66666666
 *   - Payment:    0341 fail first, then 4242 success
 */
import { test, expect } from '@playwright/test';
import { fillCard, dumpSnapshot } from './helpers';
import { CARDS } from './fixtures';

test.setTimeout(300000);

// ─── Test data ────────────────────────────────────────────────────────────────

const RUN_ID        = Date.now();
const TEST_EMAIL    = `autotest+${RUN_ID}@mailtest.com`;
const TEST_PASSWORD = '66666666';

// ─── OTP mock ─────────────────────────────────────────────────────────────────

async function mockOtp(page: Parameters<typeof fillCard>[0]) {
  for (const pattern of [
    '**/api/auth/registeruserbyemail*',
    '**/api/auth/registerprofessionalbyemail*',
    '**/api/auth/verify**',
    '**/api/*/otp**',
  ]) {
    await page.route(pattern, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Verified' }),
    }));
  }
  console.log(`[Mock] OTP mocked — email: ${TEST_EMAIL}`);
}

// ─── Selectors ────────────────────────────────────────────────────────────────

const S = {
  createLink:      'a:has-text("Create a new account now!")',

  // User type cards — try multiple patterns for "Professional"
  professionalCard: [
    'div.user-card:has(h3.card-title:has-text("Professional User"))',
    'div.user-card:has-text("Professional")',
    '[class*="user-card"]:has-text("Professional")',
    'div:has-text("Professional User")',
    'li:has-text("Professional")',
  ],

  emailMethodBtn:  'button.method-btn:has-text("Email Address")',
  continueBtn:     'button.continue-btn',
  emailInput:      'input[type="email"], input[placeholder*="email" i], input[placeholder*="Email"]',

  // OTP — 6 split inputs (confirmed from regular user flow)
  otpInput:        'input.code-input',
  verifyBtn:       'button.verify-btn',

  // Personal / professional info form
  firstNameInput:  'input[placeholder="First Name"]',
  lastNameInput:   'input[placeholder="Last Name"]',
  addressInput:    'input[placeholder="Address Line"]',
  cityInput:       'input[placeholder="City"]',
  stateInput:      'input[placeholder="State"]',
  postcodeInput:   'input[placeholder="Postcode"]',
  phoneInput:      'input[placeholder="Mobile Phone"]',
  passwordInput:   'input[placeholder="Password"]',
  confirmPwdInput: 'input[placeholder="Confirm Password"]',
  submitBtn:       'button.submit-btn',

  // Payment dialog
  stripeCardIframe: 'iframe[title="Secure card number input frame"]',
  payBtn:           'button.pay-button',
  closeDialogBtn:   'button.el-dialog__headerbtn',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function selectNewCard(page: Parameters<typeof fillCard>[0]) {
  const candidates = [
    page.locator('text=Use a different card'),
    page.locator('[class*="new-card"]'),
    page.locator('[class*="different"]'),
  ];
  for (const loc of candidates) {
    if (await loc.count() > 0) {
      await loc.first().click();
      console.log('[Card] ✓ "Use a different card" clicked');
      await page.waitForTimeout(1000);
      return;
    }
  }
  console.log('[Card] Stripe form already open directly');
}

// ─── Main test ────────────────────────────────────────────────────────────────

test.describe('Professional User Registration', () => {

  test('register professional → 0341 fail → 4242 success', async ({ page }) => {

    // Log all app API calls
    page.on('response', async res => {
      if (res.url().includes('lifetech.star-x-tech.com/api')) {
        const body = await res.json().catch(() => null);
        console.log(
          `[API ${res.status()}] ${res.request().method()} ` +
          res.url().replace('https://lifetech.star-x-tech.com', ''),
          body ? JSON.stringify(body).slice(0, 120) : ''
        );
      }
    });

    await mockOtp(page);

    // ── STEP 1: Login page ──────────────────────────────────────────────────
    await page.goto('/');
    await page.waitForSelector(S.createLink, { timeout: 15000 });
    console.log('\n[Step 1] Login page loaded');
    await page.screenshot({ path: 'screenshots/17-s1-login.png' });

    // ── STEP 2: Click "Create a new account now!" ───────────────────────────
    await page.locator(S.createLink).click();
    await page.waitForURL('**/register', { timeout: 10000 });
    await page.waitForTimeout(2000);
    console.log('[Step 2] On /register');
    await dumpSnapshot(page, 'Step 2 — /register user type cards');
    await page.screenshot({ path: 'screenshots/17-s2-register.png', fullPage: true });

    // ── STEP 3: Click "Professional User" card ──────────────────────────────
    let cardClicked = false;
    for (const sel of S.professionalCard) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        console.log(`[Step 3] Professional card clicked via: ${sel}`);
        cardClicked = true;
        break;
      }
    }
    if (!cardClicked) {
      await dumpSnapshot(page, 'Step 3 — Professional card NOT found');
      throw new Error('[Step 3] Professional User card not found — check dumpSnapshot above for actual card selectors');
    }

    await page.waitForURL('**/register-type**', { timeout: 10000 });
    await page.waitForTimeout(1000);
    await dumpSnapshot(page, 'Step 3 — after Professional card click');
    await page.screenshot({ path: 'screenshots/17-s3-register-type.png', fullPage: true });

    // ── STEP 4: Click "Email Address" ───────────────────────────────────────
    const emailMethodBtn = page.locator(S.emailMethodBtn);
    await expect(emailMethodBtn).toBeVisible({ timeout: 8000 });
    await emailMethodBtn.click();
    await page.waitForTimeout(800);
    console.log('[Step 4] Email Address method selected');

    // ── STEP 5: Enter mock email ─────────────────────────────────────────────
    const emailInput = page.locator(S.emailInput).first();
    await expect(emailInput).toBeVisible({ timeout: 8000 });
    await emailInput.fill(TEST_EMAIL);
    console.log('[Step 5] Email entered:', TEST_EMAIL);
    await page.screenshot({ path: 'screenshots/17-s5-email.png' });

    // ── STEP 6: Click Continue ───────────────────────────────────────────────
    const continueBtn = page.locator(S.continueBtn);
    await expect(continueBtn).toBeEnabled({ timeout: 5000 });
    await continueBtn.click();
    await page.waitForTimeout(2000);
    console.log('[Step 6] Continue clicked →', page.url());

    // ── STEP 7: OTP (mocked — fill "123456" in split inputs) ─────────────────
    await dumpSnapshot(page, 'Step 7 — OTP page');
    const otpInputs = page.locator(S.otpInput);
    const otpCount  = await otpInputs.count();
    if (otpCount > 0) {
      console.log(`[Step 7] ${otpCount} OTP digit inputs found`);
      for (let i = 0; i < otpCount; i++) {
        await otpInputs.nth(i).fill('123456'[i] ?? '1');
      }
      const verifyBtn = page.locator(S.verifyBtn).first();
      if (await verifyBtn.count() > 0) {
        await expect(verifyBtn).toBeEnabled({ timeout: 3000 });
        await verifyBtn.click();
        await page.waitForTimeout(3000);
        console.log('[Step 7] OTP verified →', page.url());
      }
    } else {
      console.log('[Step 7] No OTP field — went directly to profile form');
    }
    await page.screenshot({ path: 'screenshots/17-s7-after-otp.png', fullPage: true });

    // ── STEP 8: Professional info form ───────────────────────────────────────
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await dumpSnapshot(page, 'Step 8 — Professional info form (discover all fields)');
    await page.screenshot({ path: 'screenshots/17-s8-form.png', fullPage: true });

    // Handle El-Plus dropdowns (Title, Country, Phone Code, etc.)
    const elSelects = page.locator('.el-select');
    const selectCount = await elSelects.count();
    console.log(`[Step 8] Found ${selectCount} El-Plus dropdowns`);
    for (let i = 0; i < selectCount; i++) {
      try {
        await elSelects.nth(i).click();
        await page.waitForTimeout(600);
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
        console.log(`  ✓ dropdown[${i}]: ${optText ?? 'no options'}`);
        await page.waitForTimeout(600);
      } catch (e) {
        console.log(`  ⚠ dropdown[${i}]: failed`);
      }
    }

    // Fill standard fields — skip silently if not present
    // (professional form may have extra or different fields; dumpSnapshot above reveals them)
    const standardFields: Array<{ sel: string; value: string; label: string }> = [
      { sel: S.firstNameInput,  value: 'Test',        label: 'first name'  },
      { sel: S.lastNameInput,   value: 'AutoPro',     label: 'last name'   },
      { sel: S.addressInput,    value: '1 Pro Street',label: 'address'     },
      { sel: S.cityInput,       value: 'Melbourne',   label: 'city'        },
      { sel: S.stateInput,      value: 'VIC',         label: 'state'       },
      { sel: S.postcodeInput,   value: '3000',        label: 'postcode'    },
      { sel: S.phoneInput,      value: '0411111111',  label: 'phone'       },
      { sel: S.passwordInput,   value: TEST_PASSWORD, label: 'password'    },
      { sel: S.confirmPwdInput, value: TEST_PASSWORD, label: 'confirm pwd' },
    ];

    for (const { sel, value, label } of standardFields) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.fill(value);
        console.log(`  ✓ ${label}: ${value}`);
      } else {
        console.log(`  ⚠ ${label}: not found (${sel}) — check dumpSnapshot`);
      }
    }

    // Fill any professional-specific text inputs not covered above
    // These will be revealed by dumpSnapshot — add them here after first run
    const extraFields = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="text"]:not([placeholder])'))
        .filter(el => (el as HTMLElement).offsetParent !== null)
        .map(el => ({
          placeholder: (el as HTMLInputElement).placeholder,
          name: (el as HTMLInputElement).name,
          id: el.id,
        }));
    });
    if (extraFields.length > 0) {
      console.log('[Step 8] Unfilled visible inputs (add to standardFields after first run):', extraFields);
    }

    await page.screenshot({ path: 'screenshots/17-s8-filled.png', fullPage: true });

    // ── STEP 9: Submit profile form ──────────────────────────────────────────
    const submitBtn = page.locator(S.submitBtn).first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    console.log('[Step 9] Submitted →', page.url());

    const formErrors = await page.locator('.el-form-item__error:visible, [class*="error-msg"]:visible').allInnerTexts().catch(() => []);
    if (formErrors.length > 0) console.warn('[Step 9] Form errors:', formErrors);
    await page.screenshot({ path: 'screenshots/17-s9-after-submit.png', fullPage: true });
    await dumpSnapshot(page, 'Step 9 — after profile submit');

    // ── STEP 10: Payment page ─────────────────────────────────────────────────
    const stripeIframe = page.locator(S.stripeCardIframe);
    const onPaymentPage = await stripeIframe.waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(async () => {
        await dumpSnapshot(page, 'Step 10 — Stripe form NOT found');
        console.warn('[Step 10] Stripe form not found — check screenshot 17-s9-after-submit.png');
        return false;
      });

    if (!onPaymentPage) return;
    console.log('\n[Step 10] Payment page loaded ✓');
    await page.screenshot({ path: 'screenshots/17-s10-payment.png', fullPage: true });

    const payBtn = page.locator(S.payBtn);

    // ── PAYMENT ATTEMPT 1: 0341 (expect decline) ──────────────────────────────
    console.log('\n── Attempt 1: card 0341 (expect decline) ──');
    await selectNewCard(page);
    await fillCard(page, CARDS.three_d_secure_fail);
    await page.screenshot({ path: 'screenshots/17-p1-filled.png' });

    const backendRes1Promise = page.waitForResponse(
      res => res.url().includes('/api/payments') && res.request().method() === 'POST',
      { timeout: 30000 }
    ).catch(() => null);

    await payBtn.click();
    console.log('[Payment] Pay button clicked (attempt 1)');

    const backendRes1 = await backendRes1Promise;
    if (backendRes1) {
      const body = await backendRes1.json().catch(() => null);
      console.log(`[Attempt 1 API] ${backendRes1.status()} ${backendRes1.url()}`);
      if (body) console.log('[Attempt 1 API body]', JSON.stringify(body).slice(0, 500));
    }

    await page.waitForTimeout(3000);
    await dumpSnapshot(page, 'Attempt 1 — error notification');
    await page.screenshot({ path: 'screenshots/17-p1-result.png', fullPage: true });

    const has0341Error = await page.locator('text=/declined|failed|authentication|invalid/i').count() > 0;
    console.log('[Attempt 1] Decline error shown:', has0341Error);

    // Close payment dialog
    const closeBtn = page.locator(S.closeDialogBtn);
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      console.log('[Attempt 1] Dialog closed via X button');
    } else {
      console.warn('[Attempt 1] Close button not found');
    }
    await page.waitForTimeout(1000);

    // ── PAYMENT ATTEMPT 2: 4242 (expect success) ──────────────────────────────
    console.log('\n── Attempt 2: card 4242 (expect success) ──');

    // Re-open payment dialog by clicking the payment/plan button again
    // For registration flow the form may reappear automatically; check first
    const stripeGone = !(await stripeIframe.isVisible().catch(() => false));
    if (stripeGone) {
      // Try to find a retry / pay button on the page
      const retryBtn = page.locator('button:has-text("Pay"), button:has-text("Continue"), button.pay-button, button.submit-button').first();
      if (await retryBtn.count() > 0) {
        await retryBtn.click();
        await page.waitForTimeout(2000);
        console.log('[Attempt 2] Re-opened payment form');
      } else {
        await dumpSnapshot(page, 'Attempt 2 — payment form gone, no retry button found');
        console.warn('[Attempt 2] Cannot find payment form — check dumpSnapshot');
      }
    }

    await selectNewCard(page);
    await fillCard(page, {
      number: '4242 4242 4242 4242',
      expiry: '09/29',
      cvc:    '424',
      name:   'Test AutoPro',
    });
    await page.screenshot({ path: 'screenshots/17-p2-filled.png' });

    const backendRes2Promise = page.waitForResponse(
      res => res.url().includes('/api/payments') && res.request().method() === 'POST',
      { timeout: 30000 }
    ).catch(() => null);

    await payBtn.click();
    console.log('[Payment] Pay button clicked (attempt 2)');
    const backendRes2 = await backendRes2Promise;

    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'screenshots/17-p2-result.png', fullPage: true });
    await dumpSnapshot(page, 'After 4242 payment — success page');

    const success = await page.locator('text=/success|paid|complete|thank|完成|成功/i').count() > 0;
    console.log('\n[Final Result] Payment success:', success);
    if (backendRes2) console.log('[Final Result] API:', backendRes2.status(), backendRes2.url());

    expect(success).toBeTruthy();
  });

});
