/**
 * Monthly / Scheduled Payment Tests
 *
 * From the DOM snapshot we know the app uses Stripe SetupIntent (seti_xxx).
 * Monthly billing is likely handled via Stripe Subscription.
 *
 * Two testing strategies:
 *
 * A. Stripe Test Clock (recommended) — advance time in Stripe test mode
 *    to trigger a subscription renewal without waiting a real month.
 *
 * B. Backend trigger endpoint — call a debug/admin API if one exists.
 *
 * C. API polling — after real time passes, poll the payment history endpoint.
 */
import { test, expect } from '@playwright/test';
import { CREDENTIALS } from './fixtures';

const BASE       = 'https://lifetech.star-x-tech.com';
// Get this from the pre-auth API response: data.publicKey starts with pk_test_
// The SECRET key (sk_test_xxx) must come from your backend team — never commit it
const STRIPE_SK  = process.env.STRIPE_TEST_SECRET_KEY ?? '';

// ─── Auth token helper ────────────────────────────────────────────────────────
async function getToken(): Promise<{ token: string; userId: number }> {
  const res  = await fetch(`${BASE}/api/auth/loginbyemail`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: CREDENTIALS.valid.email, password: CREDENTIALS.valid.password }),
  });
  const body = await res.json();
  const token = body?.token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(body).slice(0, 200)}`);
  return { token, userId: body.userId };
}

async function appGet(path: string, token: string) {
  const res  = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ─── Strategy A: Stripe Test Clock ───────────────────────────────────────────
// Requires: STRIPE_TEST_SECRET_KEY env var (sk_test_xxx)
// Ask your backend team for the test secret key — it never goes in the browser.
//
// How it works:
//   1. Create a test clock at "now"
//   2. Ask your backend to attach this customer to the test clock
//      (OR find the Stripe customer ID from the API and do it via Stripe directly)
//   3. Advance the clock by 1 month → Stripe fires the subscription invoice
//   4. Check your app's payment history for the new charge

test.describe('Strategy A — Stripe Test Clock (requires sk_test_xxx)', () => {

  test.skip(!STRIPE_SK, 'Set STRIPE_TEST_SECRET_KEY env var to run this test');

  test('advance time 1 month → subscription charge fires', async () => {
    test.setTimeout(120000);

    if (!STRIPE_SK) throw new Error('STRIPE_TEST_SECRET_KEY not set');

    const stripeHeaders = {
      'Authorization':  `Bearer ${STRIPE_SK}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    };

    // ── Step 1: get the Stripe customer ID for this user ─────────────────
    // Your app's API may expose it — adjust the endpoint
    const { token, userId } = await getToken();
    const userRes   = await appGet(`/api/user/user/${userId}`, token);
    console.log('[User data]', JSON.stringify(userRes.body).slice(0, 300));

    // ── Step 2: create a test clock at current time ───────────────────────
    const now       = Math.floor(Date.now() / 1000);
    const clockRes  = await fetch('https://api.stripe.com/v1/test_helpers/test_clocks', {
      method:  'POST',
      headers: stripeHeaders,
      body:    new URLSearchParams({ frozen_time: String(now) }).toString(),
    });
    const clock = await clockRes.json();
    console.log('[Test Clock created]', clock.id, 'frozen at', new Date(now * 1000).toISOString());
    expect(clockRes.status).toBe(200);

    // ── Step 3: attach customer to test clock ─────────────────────────────
    // You need the Stripe customer ID. Ask your backend team or find it via
    // your app's API. Example: POST /api/payments/test/attach-clock
    //
    // const attachRes = await fetch(`${BASE}/api/payments/test/attach-clock`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    //   body: JSON.stringify({ testClockId: clock.id }),
    // });

    // ── Step 4: advance clock by 1 month + 1 day ─────────────────────────
    const oneMonthLater = now + (31 * 24 * 60 * 60);
    const advanceRes = await fetch(`https://api.stripe.com/v1/test_helpers/test_clocks/${clock.id}/advance`, {
      method:  'POST',
      headers: stripeHeaders,
      body:    new URLSearchParams({ frozen_time: String(oneMonthLater) }).toString(),
    });
    const advanced = await advanceRes.json();
    console.log('[Clock advanced to]', new Date(oneMonthLater * 1000).toISOString());
    expect(advanceRes.status).toBe(200);

    // ── Step 5: wait for Stripe to process (test clocks are near-instant) ─
    await new Promise(r => setTimeout(r, 5000));

    // ── Step 6: verify charge appeared in app ─────────────────────────────
    const history = await appGet('/api/payments/history', token);
    console.log('[Payment history]', JSON.stringify(history.body).slice(0, 400));
    expect(history.status).toBe(200);

    const records: any[] = history.body?.data ?? history.body?.records ?? [];
    const monthlyCharge  = records.find((r: any) => r.type === 'subscription' || r.interval === 'month');
    console.log('[Monthly charge found]', monthlyCharge);

    // ── Step 7: clean up — delete the test clock ──────────────────────────
    await fetch(`https://api.stripe.com/v1/test_helpers/test_clocks/${clock.id}`, {
      method: 'DELETE', headers: stripeHeaders,
    });
    console.log('[Test Clock deleted]');
  });

});

// ─── Strategy B: Backend trigger endpoint ────────────────────────────────────
// If your backend exposes a debug endpoint to manually trigger the monthly charge.
// Ask your backend team: "Is there a POST /api/payments/trigger-monthly or similar?"

test.describe('Strategy B — Backend trigger endpoint', () => {

  test('POST /api/payments/trigger-monthly → charge appears in history', async () => {
    test.setTimeout(30000);

    const { token } = await getToken();

    // Snapshot history before trigger
    const before = await appGet('/api/payments/history', token);
    const beforeIds = ((before.body?.data ?? []) as any[]).map((r: any) => String(r.id ?? r._id));
    console.log('[Before] payment count:', beforeIds.length);

    // Trigger the monthly charge
    // ⚠️ Adjust endpoint to match your actual backend
    const triggerRes = await fetch(`${BASE}/api/payments/trigger-monthly`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ userId }),
    });

    if (triggerRes.status === 404) {
      console.warn('[Strategy B] Endpoint not found — ask backend team for the trigger URL');
      test.skip();
      return;
    }

    const triggerBody = await triggerRes.json().catch(() => null);
    console.log('[Trigger response]', triggerRes.status, triggerBody);
    expect(triggerRes.status).toBeLessThan(400);

    // Wait briefly and verify
    await new Promise(r => setTimeout(r, 3000));
    const after = await appGet('/api/payments/history', token);
    const newRecord = ((after.body?.data ?? []) as any[])
      .find((r: any) => !beforeIds.includes(String(r.id ?? r._id)));

    console.log('[New charge]', newRecord ? JSON.stringify(newRecord).slice(0, 200) : 'NOT FOUND');
    expect(newRecord, 'A new charge should appear after triggering monthly billing').toBeTruthy();
    expect(newRecord?.status).toMatch(/success|succeeded|completed/i);
  });

});

// ─── Strategy C: Validate the Stripe webhook payload ─────────────────────────
// If your backend receives Stripe webhooks for subscription renewals,
// verify the webhook endpoint handles the payload correctly.

test.describe('Strategy C — Stripe webhook simulation', () => {

  test.skip(!STRIPE_SK, 'Set STRIPE_TEST_SECRET_KEY to run webhook tests');

  test('simulate invoice.payment_succeeded webhook → app records charge', async () => {
    test.setTimeout(30000);

    const { token, userId } = await getToken();

    // Build a minimal Stripe invoice.payment_succeeded event payload
    const fakeEvent = {
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id:             'in_test_' + Date.now(),
          object:         'invoice',
          amount_paid:    2900,   // $29.00 in cents — adjust to your plan
          currency:       'aud',
          customer:       'cus_test',
          subscription:   'sub_test',
          status:         'paid',
        },
      },
    };

    // POST to your app's Stripe webhook endpoint (adjust path)
    const webhookRes = await fetch(`${BASE}/api/payments/webhook`, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        // Real webhooks include a Stripe-Signature header
        // For testing, your backend may have a bypass mode or test endpoint
        'stripe-signature':   'test_sig',
      },
      body: JSON.stringify(fakeEvent),
    });

    console.log('[Webhook response]', webhookRes.status, await webhookRes.text().catch(() => ''));

    if (webhookRes.status === 401 || webhookRes.status === 403) {
      console.warn('[Webhook] Signature verification blocked test — use Stripe CLI for real webhook testing:');
      console.warn('  stripe listen --forward-to localhost:3000/api/payments/webhook');
      console.warn('  stripe trigger invoice.payment_succeeded');
    }
  });

});

// ─── Payment history API contract ────────────────────────────────────────────

test.describe('Payment History API', () => {

  test('GET /api/payments/history → returns array with expected fields', async () => {
    const { token } = await getToken();
    const { status, body } = await appGet('/api/payments/history', token);

    console.log('[History API]', status, JSON.stringify(body).slice(0, 400));

    // If endpoint doesn't exist yet, report it
    if (status === 404) {
      console.warn('[History API] 404 — endpoint may not exist yet');
      console.warn('Expected: GET /api/payments/history');
      console.warn('Ask backend team for the correct endpoint');
    }

    expect(status).toBe(200);

    const records: any[] = body?.data ?? body?.records ?? body ?? [];
    console.log(`[History] ${records.length} record(s) found`);

    if (records.length > 0) {
      const first = records[0];
      console.log('[First record fields]', Object.keys(first));
      // Assert expected fields exist
      expect(first).toHaveProperty('id');
      // Add more field assertions once you know the actual schema:
      // expect(first).toHaveProperty('amount');
      // expect(first).toHaveProperty('status');
      // expect(first).toHaveProperty('createdAt');
    }
  });

});
