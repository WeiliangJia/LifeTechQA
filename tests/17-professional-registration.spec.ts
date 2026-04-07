/**
 * Professional User Registration Flow
 *
 * Confirmed flow (from DOM exploration 2026-04-07):
 *   / → "Create a new account now!" → /register
 *   → click "Professional User" card (div.user-card → /register/register-type?userType=RP)
 *   → click "Email Address" (button.method-btn) → fill mock email → button.continue-btn
 *   → OTP: /register/verify-code?type=email&userType=RP (6× input.code-input, mocked)
 *   → Complete Profile: /register/complete-profile?type=email&userType=RP
 *     Fields: Sub-Category (El-Plus), Title (El-Plus), First/Last Name, Address, City,
 *             State, Country (El-Plus), Postcode, Mobile Phone (+code El-Plus),
 *             Enter Registration Number, Company Name, Password, Confirm Password
 *     Submit: button.submit-btn "Signup"
 *   → Verification: /register/verification?type=email
 *     Fields: Enter Bar/License Number, file upload (image/JPEG accepted)
 *     Submit: button.submit-btn "Submit for Verification"
 *     API: POST /api/user/createUser → userId assigned
 *   → Navigates to /entities (main dashboard) — NO payment step in registration
 *
 * Rules:
 *   - Mock email: autotest+{timestamp}@mailtest.com
 *   - Mock OTP:   intercept verify/otp endpoints
 *   - Password:   66666666
 *   - No payment in this flow (professional users go straight to dashboard after verification)
 */
import { test, expect } from '@playwright/test';
import { dumpSnapshot } from './helpers';

test.setTimeout(300000);

// ─── Test data ────────────────────────────────────────────────────────────────

const RUN_ID        = Date.now();
const TEST_EMAIL    = `autotest+${RUN_ID}@mailtest.com`;
const TEST_PASSWORD = '66666666';
// Unique phone number per run: 04 + last 8 digits of timestamp (avoids "phone already exists" conflicts)
const TEST_PHONE    = `04${String(RUN_ID).slice(-8)}`;

// ─── OTP mock ─────────────────────────────────────────────────────────────────

async function mockOtp(page: Parameters<typeof fillCard>[0]) {
  for (const pattern of [
    '**/api/auth/registeruserbyemail*',
    '**/api/auth/registerprofessionalbyemail*',
    '**/api/auth/verify**',
    '**/api/*/otp**',
    '**/api/*/verification*',   // professional verification document submission
    '**/api/*/upload*',         // file upload endpoint (if any)
  ]) {
    await page.route(pattern, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Verified' }),
    }));
  }
  console.log(`[Mock] OTP + verification endpoints mocked — email: ${TEST_EMAIL}`);
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

  // Personal / professional info form (confirmed from DOM: /register/complete-profile?userType=RP)
  // El-Plus dropdowns on this page: Sub-Category, Title, Country, Phone code (handled by .el-select loop)
  firstNameInput:       'input[placeholder="First Name"]',
  lastNameInput:        'input[placeholder="Last Name"]',
  addressInput:         'input[placeholder="Address Line"]',
  cityInput:            'input[placeholder="City"]',
  stateInput:           'input[placeholder="State"]',
  postcodeInput:        'input[placeholder="Postcode"]',
  phoneInput:           'input[placeholder="Mobile Phone"]',
  registrationNumber:   'input[placeholder="Enter Registration Number"]',
  companyName:          'input[placeholder="Company Name"]',
  passwordInput:        'input[placeholder="Password"]',
  confirmPwdInput:      'input[placeholder="Confirm Password"]',
  // Submit button text is "Signup" on this page
  submitBtn:            'button:has-text("Signup"), button.submit-btn',

};

// ─── Main test ────────────────────────────────────────────────────────────────

test.describe('Professional User Registration', () => {

  test('register professional user → dashboard', async ({ page }) => {

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
    // After OTP, page navigates to /register/complete-profile?type=email&userType=RP
    await page.waitForURL('**/complete-profile**', { timeout: 15000 });
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
      { sel: S.firstNameInput,     value: 'Test',           label: 'first name'         },
      { sel: S.lastNameInput,      value: 'AutoPro',        label: 'last name'          },
      { sel: S.addressInput,       value: '1 Pro Street',   label: 'address'            },
      { sel: S.cityInput,          value: 'Melbourne',      label: 'city'               },
      { sel: S.stateInput,         value: 'VIC',            label: 'state'              },
      { sel: S.postcodeInput,      value: '3000',           label: 'postcode'           },
      { sel: S.phoneInput,         value: TEST_PHONE,       label: 'phone'              },
      { sel: S.registrationNumber, value: 'ACN123456789',   label: 'registration number'},
      { sel: S.companyName,        value: 'AutoTest Pro Pty',label: 'company name'      },
      { sel: S.passwordInput,      value: TEST_PASSWORD,    label: 'password'           },
      { sel: S.confirmPwdInput,    value: TEST_PASSWORD,    label: 'confirm pwd'        },
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

    // ── STEP 10: Verification page (professional-specific) ────────────────────
    // After profile submit: /register/verification?type=email
    // Fields: Bar/License Number (text) + document file upload + "Submit for Verification"
    const onVerificationPage = page.url().includes('/verification');
    if (onVerificationPage) {
      console.log('\n[Step 10] Verification page detected');
      await dumpSnapshot(page, 'Step 10 — Verification page');

      const barLicenseInput = page.locator('input[placeholder="Enter Bar/License Number"]').first();
      if (await barLicenseInput.count() > 0) {
        await barLicenseInput.fill('LIC-AUTOTEST-001');
        console.log('[Step 10] ✓ Bar/License Number filled');
      }

      // Upload a minimal JPEG file (common accepted format for document uploads)
      // Minimal valid JPEG header bytes
      const jpegHeader = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
      ]);
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles({
          name: 'autotest-doc.jpg',
          mimeType: 'image/jpeg',
          buffer: jpegHeader,
        });
        console.log('[Step 10] ✓ Dummy JPEG file set for document upload');
      }

      // Log ALL requests to discover the verification submission endpoint
      const requestLog: string[] = [];
      const reqListener = (req: import('@playwright/test').Request) => {
        requestLog.push(`${req.method()} ${req.url()}`);
      };
      page.on('request', reqListener);

      const verificationSubmitBtn = page.locator('button.submit-btn:has-text("Submit for Verification")');
      if (await verificationSubmitBtn.count() > 0) {
        // Check for any visible validation errors before clicking
        const preErrors = await page.locator('.el-form-item__error:visible, [class*="error"]:visible').allInnerTexts().catch(() => []);
        if (preErrors.length) console.log('[Step 10] Pre-click errors:', preErrors);

        await verificationSubmitBtn.click();
        console.log('[Step 10] Submit for Verification clicked');
        await page.waitForTimeout(4000);

        // Check for validation errors after clicking
        const postErrors = await page.locator('.el-form-item__error:visible, [class*="error"]:visible, .el-message--error:visible').allInnerTexts().catch(() => []);
        if (postErrors.length) console.log('[Step 10] Post-click errors:', postErrors);

        // Report all requests that fired
        page.off('request', reqListener);
        console.log(`[Step 10] Network requests fired (${requestLog.length}):`);
        requestLog.filter(r => r.includes('lifetech.star-x-tech.com') || r.includes('/api/')).forEach(r => console.log('  ', r));

        console.log('[Step 10] After submit →', page.url());
        await dumpSnapshot(page, 'Step 10 — after verification submit');
      }
    }

    // ── STEP 11: Assert registration success ─────────────────────────────────
    // Professional users are created via POST /api/user/createUser and redirected
    // to /entities (main dashboard) — there is NO payment step in registration.
    const finalUrl = page.url();
    console.log('\n[Final] URL after registration:', finalUrl);

    const onDashboard = finalUrl.includes('/entities') ||
                        finalUrl.includes('/dashboard') ||
                        finalUrl.includes('/wallet') ||
                        (!finalUrl.includes('/register') && !finalUrl.includes('/login'));

    console.log('[Final Result] Registration success:', onDashboard);
    expect(onDashboard, `Expected dashboard URL, got: ${finalUrl}`).toBeTruthy();
  });

});
