import { Page } from '@playwright/test';
import { CREDENTIALS } from './fixtures';

// ─── Exact selectors (confirmed by DOM snapshot 2026-03-29) ──────────────────

const SEL = {
  // Login page
  loginEmail:    'input[placeholder="Mobile Number/Email"]',
  loginPassword: 'input[type="password"]',
  loginButton:   'button:has-text("Continue")',

  // Payment page — Stripe iframe titles (stable across sessions)
  iframeCardNumber: 'iframe[title="Secure card number input frame"]',
  iframeExpiry:     'iframe[title="Secure expiration date input frame"]',
  iframeCvc:        'iframe[title="Secure CVC input frame"]',

  // Inside each iframe — input name attributes
  inputCardNumber: 'input[name="cardnumber"]',
  inputExpiry:     'input[name="exp-date"]',
  inputCvc:        'input[name="cvc"]',

  // Main frame — name on card + submit
  inputCardName:   'input[placeholder="Name on card"]',
  submitButton:    'button.submit-button',
};

// ─── DOM Snapshot ─────────────────────────────────────────────────────────────

export async function dumpSnapshot(page: Page, label = 'Snapshot') {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`[${label}]  ${page.url()}`);
  console.log('═'.repeat(64));

  const dom = await page.evaluate(() => {
    const toObj = (el: Element) => {
      const n = el as HTMLInputElement | HTMLButtonElement;
      return {
        tag:         el.tagName.toLowerCase(),
        type:        n.type          ?? null,
        name:        n.name          ?? null,
        id:          n.id            ?? null,
        placeholder: (n as HTMLInputElement).placeholder ?? null,
        ariaLabel:   el.getAttribute('aria-label'),
        class:       el.className    || null,
        text:        (el as HTMLElement).innerText?.trim().slice(0, 60) || null,
        disabled:    (n as HTMLButtonElement).disabled ?? false,
      };
    };
    return {
      inputs:  Array.from(document.querySelectorAll('input')).map(toObj),
      buttons: Array.from(document.querySelectorAll('button')).map(toObj),
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({
        name:  f.getAttribute('name'),
        title: f.getAttribute('title'),
        src:   (f.getAttribute('src') ?? '').slice(0, 100),
      })),
    };
  });

  console.log('\n── inputs ──');
  dom.inputs.forEach(i => console.log(' ', JSON.stringify(i)));
  console.log('\n── buttons ──');
  dom.buttons.forEach(b => console.log(' ', JSON.stringify(b)));
  console.log(`\n── iframes (${dom.iframes.length}) ──`);
  dom.iframes.forEach(f => console.log(' ', JSON.stringify(f)));

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const inputs = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(el => ({
          name:        el.name        || null,
          placeholder: el.placeholder || null,
          ariaLabel:   el.getAttribute('aria-label'),
          class:       el.className   || null,
        }))
      );
      if (inputs.length === 0) continue;
      console.log(`\n── frame [${frame.url().slice(0, 70)}] ──`);
      inputs.forEach(i => console.log(' ', JSON.stringify(i)));
    } catch { /* cross-origin restricted */ }
  }

  console.log('\n' + '═'.repeat(64) + '\n');
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(
  page: Page,
  email    = CREDENTIALS.valid.email,
  password = CREDENTIALS.valid.password
) {
  await page.goto('/');
  await page.waitForSelector(SEL.loginEmail, { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.locator(SEL.loginEmail).fill(email);
  await page.locator(SEL.loginPassword).fill(password);

  const loginResponsePromise = page.waitForResponse(
    res => res.url().includes('/api/auth/loginbyemail'),
    { timeout: 15000 }
  ).catch(() => null);

  await page.locator(SEL.loginButton).click();

  const loginRes = await loginResponsePromise;
  if (loginRes) {
    const body = await loginRes.json().catch(() => null);
    console.log(`[Auth API] ${loginRes.status()} — ${JSON.stringify(body).slice(0, 120)}`);
  }

  await page.waitForURL(
    url => !url.href.includes('/login') && !url.href.includes('/signin'),
    { timeout: 15000 }
  );
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500); // let SPA render payment route

  console.log('[Login] →', page.url());
  return page;
}

// ─── Card filling ─────────────────────────────────────────────────────────────

/**
 * Fill the Stripe payment form.
 * Uses exact iframe titles and input names confirmed from DOM snapshot.
 *
 * Stripe iframes load asynchronously — we wait for each input before filling.
 * Uses pressSequentially() instead of fill() because Stripe intercepts keystrokes.
 */
export async function fillCard(
  page: Page,
  card: { number: string; expiry: string; cvc: string; name: string }
) {
  // ── Card number ────────────────────────────────────────────────────────────
  const numberFrame = page.frameLocator(SEL.iframeCardNumber);
  const numberInput = numberFrame.locator(SEL.inputCardNumber);
  await numberInput.waitFor({ timeout: 15000 });
  await numberInput.click();
  await numberInput.pressSequentially(card.number.replace(/\s/g, ''), { delay: 30 });
  console.log('[Card] ✓ card number');

  // ── Expiry ────────────────────────────────────────────────────────────────
  const expiryFrame = page.frameLocator(SEL.iframeExpiry);
  const expiryInput = expiryFrame.locator(SEL.inputExpiry);
  await expiryInput.waitFor({ timeout: 10000 });
  await expiryInput.click();
  await expiryInput.pressSequentially(card.expiry.replace('/', ''), { delay: 30 });
  console.log('[Card] ✓ expiry');

  // ── CVC ───────────────────────────────────────────────────────────────────
  const cvcFrame = page.frameLocator(SEL.iframeCvc);
  const cvcInput = cvcFrame.locator(SEL.inputCvc);
  await cvcInput.waitFor({ timeout: 10000 });
  await cvcInput.click();
  await cvcInput.pressSequentially(card.cvc, { delay: 30 });
  console.log('[Card] ✓ CVC');

  // ── Name on card (main frame) ─────────────────────────────────────────────
  const nameInput = page.locator(SEL.inputCardName);
  if (await nameInput.count() > 0) {
    await nameInput.fill(card.name);
    console.log('[Card] ✓ name on card');
  }
}

// ─── Submit payment ───────────────────────────────────────────────────────────

export async function submitPayment(page: Page) {
  const paymentResponsePromise = page.waitForResponse(
    res => res.url().includes('/api/payments') || res.url().includes('stripe.com/v1'),
    { timeout: 30000 }
  ).catch(() => null);

  await page.locator(SEL.submitButton).click();
  console.log('[Payment] submit clicked');

  const res = await paymentResponsePromise;
  if (res) {
    const body = await res.json().catch(() => null);
    console.log(`[Payment API] ${res.status()} ${res.url()}`);
    if (body) console.log('[Payment API body]', JSON.stringify(body).slice(0, 300));
  }

  return res;
}

// ─── 3DS Modal handler ────────────────────────────────────────────────────────

/**
 * After submitting a 3DS card, Stripe opens a modal with an inner iframe.
 * This function waits for that modal and clicks Complete or Fail.
 *
 * The modal only appears for specific test cards:
 *   4000 0025 0000 3155  — authenticate → payment succeeds
 *   4000 0000 0000 0341  — authenticate or fail → use action='fail' to decline
 *
 * DOM structure (Stripe-hosted, does not need re-exploration):
 *   iframe[name="__privateStripeFrame..."] (the modal overlay)
 *     └─ iframe  (the challenge frame inside)
 *          └─ button#test-source-authorize-3ds  "Complete"
 *          └─ button#test-source-fail-3ds       "Fail"
 */
export async function handle3DS(page: Page, action: 'complete' | 'fail' = 'complete') {
  // The 3DS modal is a Stripe-controlled iframe injected after submit
  // Wait up to 15s for it to appear
  const modalIframeSel = 'iframe[src*="stripe.com/v3/3ds"],'
    + 'iframe[src*="js.stripe.com/v3/authenticate"],'
    + 'iframe[name*="__privateStripeFrame"][title*="3"],'
    + '__stripe_modal, iframe[title*="three"]';

  console.log('[3DS] Waiting for authentication modal...');

  // Strategy: wait for any new iframe to appear that looks like a 3DS modal
  let found = false;
  const deadline = Date.now() + 15000;

  while (!found && Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const url = frame.url();
      if (!url.includes('stripe')) continue;

      try {
        // Look for the challenge buttons inside this frame
        const completeBtn = frame.locator('#test-source-authorize-3ds, button:has-text("Complete")');
        const failBtn     = frame.locator('#test-source-fail-3ds, button:has-text("Fail")');

        const hasComplete = await completeBtn.count() > 0;
        const hasFail     = await failBtn.count() > 0;

        if (hasComplete || hasFail) {
          console.log(`[3DS] Modal found in frame: ${url.slice(0, 70)}`);
          if (action === 'complete' && hasComplete) {
            await completeBtn.first().click();
            console.log('[3DS] ✓ Clicked "Complete authentication"');
          } else if (action === 'fail' && hasFail) {
            await failBtn.first().click();
            console.log('[3DS] ✓ Clicked "Fail authentication"');
          }
          found = true;
          break;
        }
      } catch { /* frame not ready */ }
    }
    if (!found) await page.waitForTimeout(500);
  }

  if (!found) {
    await dumpSnapshot(page, '3DS modal NOT found');
    console.warn('[3DS] Modal did not appear — card may not require 3DS or modal selector changed');
  }
}
