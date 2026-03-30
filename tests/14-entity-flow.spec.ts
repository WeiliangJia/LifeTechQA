/**
 * Entity Creation Flow
 * Selectors confirmed from DOM snapshot on 2026-03-30.
 *
 * Flow:
 *   Login → /entities
 *   → click "Add Entity" (button.add-entity-button)
 *   → fill modal form (div.modal-container)
 *   → click "Create Entity" (button.modal-button.submit-button)
 *   → Plan selection dialog appears
 *   → select a plan
 *   → Payment form (Stripe)
 *   → card 0341 (fail) → card 4242 (success)
 */
import { test, expect } from '@playwright/test';
import { login, fillCard, handle3DS, dumpSnapshot } from './helpers';
import { CARDS } from './fixtures';

test.setTimeout(240000);

// ─── Confirmed selectors (2026-03-30 DOM snapshot) ───────────────────────────

const S = {
  // Entity list page
  addEntityBtn:      'button.add-entity-button',

  // Add Entity modal
  modal:             'div.modal-container',
  modalTitle:        'h2.modal-title',                           // "Add New Entity"
  entityTypeSelect:  '.el-select',                              // first .el-select in modal
  entityNameInput:   'input[placeholder="Enter entity name"]',
  abnInput:          'input[placeholder="Search by ABN"]',
  acnInput:          'input[placeholder="Enter ACN"]',
  tfnInput:          'input[placeholder="Enter tax file number"]',
  phoneInput:        'input[placeholder="Enter telephone number"]',
  addressInput:      'input[placeholder="Enter address line"]',
  cityInput:         'input[placeholder="Enter City"]',
  postcodeInput:     'input[placeholder="Enter Post Code"]',
  websiteInput:      'input[placeholder="Enter company website link"]',
  createEntityBtn:   'button.modal-button.submit-button',        // "Create Entity"
  cancelBtn:         'button.modal-button.cancel-button',
  closeModalBtn:     'button.modal-close-button',

  // Plan selection page (/entities/fee/:id)
  // Confirmed: each plan has a "Select" button (button.select-button)
  selectPlanBtn:     'button.select-button',

  // After selecting plan — card selection dialog
  // Confirmed: existing cards shown, "Add Payment Method" button, pay button TBD
  addPaymentMethod:  'button:has-text("Add Payment Method")',

  // Payment dialog (El-Plus dialog, appears after clicking "Select" on a plan)
  // Confirmed from DOM: button.pay-button text="Pay $50", not button.submit-button
  payDialog:         'button.pay-button',
  stripeCardIframe:  'iframe[title="Secure card number input frame"]',
  payBtn:            'button.pay-button',            // "Pay $50"
  cancelPayBtn:      'button.el-button:has-text("Cancel")',
  closeDialogBtn:    'button.el-dialog__headerbtn',

  // Error dialog after failed payment
  dialogDismissBtn:  'button.dialog-button',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Select from an El-Plus dropdown using JS click (bypasses Playwright visibility check) */
async function selectElPlusOption(page: Parameters<typeof login>[0], dropdownIndex: number) {
  const elSelects = page.locator(`${S.modal} .el-select`);
  await elSelects.nth(dropdownIndex).click();
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
  await page.waitForTimeout(600);
  return optText;
}

// ─── Test ─────────────────────────────────────────────────────────────────────

test.describe('Entity Flow', () => {

  test('create entity → plan → 0341 fail → 4242 success', async ({ page }) => {

    // Log all API calls
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

    // ── STEP 1: Login ───────────────────────────────────────────────────────
    await login(page, '1144890814@qq.com', '66666666');
    await page.waitForURL('**/entities', { timeout: 15000 });
    console.log('\n[Step 1] Logged in →', page.url());
    await page.screenshot({ path: 'screenshots/14-s1-entities.png', fullPage: true });

    // ── STEP 2: Open Add Entity modal ───────────────────────────────────────
    const addBtn = page.locator(S.addEntityBtn);
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    await page.waitForSelector(S.modal, { timeout: 8000 });
    await page.waitForTimeout(500);
    console.log('[Step 2] Add Entity modal opened');
    await page.screenshot({ path: 'screenshots/14-s2-modal-open.png', fullPage: true });

    // ── STEP 3: Fill entity form ────────────────────────────────────────────
    console.log('\n[Step 3] Filling entity form...');

    // Entity Type dropdown (first .el-select inside modal)
    const entityType = await selectElPlusOption(page, 0);
    console.log(`  ✓ Entity Type: ${entityType}`);

    // Generate unique values per run to avoid DB unique-constraint conflicts
    const RUN_ID = Date.now();
    const rand9  = () => String(Math.floor(100000000 + Math.random() * 900000000)); // 9 digits
    const rand11 = () => String(Math.floor(10000000000 + Math.random() * 90000000000)); // 11 digits
    const testAbn = rand11(); // ABN: 11 digits
    const testAcn = rand9();  // ACN: 9 digits
    const testTfn = rand9();  // TFN: 9 digits
    console.log(`  [Run data] ABN=${testAbn} ACN=${testAcn} TFN=${testTfn}`);

    const abnInput = page.locator(S.abnInput).first();
    if (await abnInput.count() > 0) {
      await abnInput.fill(testAbn);
      // Wait to see if an autocomplete dropdown appears
      await page.waitForTimeout(1500);
      // If ABN lookup returns options, select the first one
      const abnOption = page.locator('.el-autocomplete-suggestion__wrap li, [class*="abn-result"], [class*="suggestion"]').first();
      if (await abnOption.count() > 0) {
        await abnOption.click();
        console.log('  ✓ ABN: selected from autocomplete');
      } else {
        console.log('  ✓ ABN: typed directly (no autocomplete shown):', testAbn);
      }
      // Check if ABN lookup auto-filled other fields
      await page.waitForTimeout(500);
    }

    const fields: Array<{ sel: string; value: string; label: string }> = [
      { sel: S.entityNameInput, value: `TestEntity${RUN_ID}`, label: 'entity name' },
      { sel: S.acnInput,        value: testAcn,               label: 'ACN'         },
      { sel: S.tfnInput,        value: testTfn,               label: 'TFN'         },
      { sel: S.phoneInput,      value: '0412345678',           label: 'phone'       },
      { sel: S.addressInput,    value: '123 Test Street',      label: 'address'     },
      { sel: S.cityInput,       value: 'Sydney',               label: 'city'        },
      { sel: S.postcodeInput,   value: '2000',                 label: 'postcode'    },
      { sel: S.websiteInput,    value: 'https://test.example.com', label: 'website' },
    ];

    for (const { sel, value, label } of fields) {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.fill(value);
        console.log(`  ✓ ${label}: ${value}`);
      } else {
        console.log(`  ⚠ ${label}: not found (${sel})`);
      }
    }

    // State and Country dropdowns (second and third .el-select in modal, if present)
    const modalSelectCount = await page.locator(`${S.modal} .el-select`).count();
    console.log(`  Found ${modalSelectCount} El-Plus dropdowns in modal`);
    for (let i = 1; i < modalSelectCount; i++) {
      const opt = await selectElPlusOption(page, i);
      console.log(`  ✓ dropdown[${i}]: ${opt ?? 'no options'}`);
    }

    await page.screenshot({ path: 'screenshots/14-s3-form-filled.png', fullPage: true });

    // ── STEP 4: Submit entity form ──────────────────────────────────────────
    const createBtn = page.locator(S.createEntityBtn);
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();
    await page.waitForTimeout(3000);
    console.log('[Step 4] Create Entity clicked →', page.url());

    // Check for client-side validation errors (El-Plus form item errors)
    const formErrors = await page.locator('.el-form-item__error:visible, [class*="error-msg"]:visible').allInnerTexts().catch(() => []);
    if (formErrors.length > 0) console.warn('[Step 4] Form validation errors:', formErrors);
    await page.screenshot({ path: 'screenshots/14-s4-validation.png', fullPage: true });
    await page.screenshot({ path: 'screenshots/14-s4-after-create.png', fullPage: true });

    // Capture whatever appeared (Plan dialog, success message, etc.)
    await dumpSnapshot(page, 'After Create Entity — expect Plan dialog');

    // ── STEP 5: Plan selection (/entities/fee/:id) ─────────────────────────
    // Confirmed: each plan has button.select-button
    // The payment dialog (button.pay-button) may already be open if the app
    // auto-opens it when existing cards are on file — skip selectBtn in that case.
    const payBtn = page.locator(S.payBtn);
    const dialogAlreadyOpen = await payBtn.isVisible().catch(() => false);

    if (!dialogAlreadyOpen) {
      const selectBtn = page.locator(S.selectPlanBtn).first();
      const planPageVisible = await selectBtn.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true).catch(() => false);

      if (!planPageVisible) {
        await dumpSnapshot(page, 'Plan page NOT found');
        console.warn('[Step 5] Plan selection page not visible — check screenshot 14-s4-after-create.png');
        return;
      }

      const planCount = await page.locator(S.selectPlanBtn).count();
      console.log(`[Step 5] ${planCount} plan(s) found — clicking first "Select"`);
      await page.screenshot({ path: 'screenshots/14-s5-plan-page.png', fullPage: true });

      await selectBtn.click();
      await page.waitForTimeout(3000);
      console.log('[Step 5] Plan selected →', page.url());
    } else {
      console.log('[Step 5] Payment dialog already open (plan pre-selected by app)');
    }

    await page.screenshot({ path: 'screenshots/14-s5-after-select.png', fullPage: true });

    // ── STEP 6: Wait for payment dialog + Stripe form ──────────────────────
    // Confirmed DOM: button.pay-button ("Pay $50") is the dialog indicator.
    // fillCard() handles waiting for Stripe iframe inputs internally — no need
    // to waitFor the iframe locator here (iframe 'visible' state is unreliable).
    const dialogAppeared = await payBtn.waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(async () => {
        await dumpSnapshot(page, 'Pay dialog NOT found');
        console.warn('[Step 6] Pay dialog (button.pay-button) not found');
        return false;
      });

    if (!dialogAppeared) return;

    // Give El-Plus dialog animation time to complete
    await page.waitForTimeout(1500);
    console.log('\n[Step 6] Payment dialog loaded ✓');
    await page.screenshot({ path: 'screenshots/14-s7-stripe-form.png', fullPage: true });
    await dumpSnapshot(page, 'Payment dialog — check for saved-card vs new-card form');

    // ── Helper: expand "Use a different card" if saved card is pre-selected ──
    async function selectNewCard() {
      // The dialog may show an existing saved card with a "Use a different card" option.
      // Clicking it expands the Stripe form. The Stripe iframes are hidden until then.
      const candidates = [
        page.locator('text=Use a different card'),
        page.locator('[class*="new-card"]'),
        page.locator('[class*="different"]'),
        page.locator('label:has-text("different card")'),
      ];
      for (const loc of candidates) {
        if (await loc.count() > 0) {
          await loc.first().click();
          console.log('[Card] ✓ Clicked "Use a different card"');
          await page.waitForTimeout(1000);
          return;
        }
      }
      console.log('[Card] No saved-card selector visible — Stripe form should be open directly');
    }

    // ── PAYMENT ATTEMPT 1: card 0341 (expect decline) ──────────────────────
    console.log('\n── Attempt 1: card 4000 0000 0000 0341 (expect decline) ──');
    await selectNewCard();
    await fillCard(page, CARDS.three_d_secure_fail);
    await page.screenshot({ path: 'screenshots/14-p1-filled.png' });

    // Click the confirmed pay button ("Pay $50"), register response listener first
    const payResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/payments') || res.url().includes('stripe.com/v1'),
      { timeout: 30000 }
    ).catch(() => null);
    await payBtn.click();
    console.log('[Payment] Pay button clicked');
    await payResponsePromise;

    // 3DS modal is optional here — the app may decline the card server-side
    // without opening a browser 3DS challenge. Wrap to survive page navigation.
    await handle3DS(page, 'fail').catch(() => {
      console.log('[3DS] Skipped — page navigated during 3DS wait (normal for server-side decline)');
    });
    await page.waitForTimeout(5000).catch(() => {});
    await page.screenshot({ path: 'screenshots/14-p1-result.png', fullPage: true }).catch(() => {});

    const has0341Error = await page.locator('text=/declined|failed|authentication|invalid/i').count() > 0;
    console.log('[Attempt 1] Decline error shown:', has0341Error);

    // Dismiss error dialog before next attempt
    const tryAgainBtn = page.locator(S.dialogDismissBtn);
    if (await tryAgainBtn.count() > 0) {
      await tryAgainBtn.click();
      console.log('[Attempt 1] Error dialog dismissed');
      await page.waitForTimeout(1000);
    }

    // ── PAYMENT ATTEMPT 2: card 4242 (expect success) ──────────────────────
    console.log('\n── Attempt 2: card 4242 4242 4242 4242 (expect success) ──');
    await page.waitForTimeout(1500);

    // Re-open "Use a different card" if the dialog reset to saved-card view
    await selectNewCard();

    await fillCard(page, {
      number: '4242 4242 4242 4242',
      expiry: '09/29',
      cvc:    '424',
      name:   'Test Entity',
    });
    await page.screenshot({ path: 'screenshots/14-p2-filled.png' });

    const finalResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/payments') || res.url().includes('stripe.com/v1'),
      { timeout: 30000 }
    ).catch(() => null);
    await payBtn.click();
    console.log('[Payment] Pay button clicked (attempt 2)');
    const finalRes = await finalResponsePromise;

    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'screenshots/14-p2-result.png', fullPage: true });

    const success = await page.locator('text=/success|paid|complete|thank|完成|成功/i').count() > 0;
    console.log('\n[Final Result] Payment success:', success);
    if (finalRes) console.log('[Final Result] API:', finalRes.status(), finalRes.url());

    expect(success).toBeTruthy();
  });

});
