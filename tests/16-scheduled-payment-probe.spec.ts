/**
 * Scheduled Payment Probe
 *
 * Two things in one run:
 *   PART 1 — Navigate wallet/payment pages and capture every API call to
 *            discover unknown subscription/billing endpoints.
 *   PART 2 — Probe a list of candidate trigger endpoints with raw fetch
 *            and report which ones respond (not 404/401/405).
 */
import { test } from '@playwright/test';
import { login } from './helpers';
import { dumpSnapshot } from './helpers';
import { CREDENTIALS } from './fixtures';

const BASE = 'https://lifetech.star-x-tech.com';

// ─── Auth helper (raw fetch, no browser) ─────────────────────────────────────

async function getToken(): Promise<{ token: string; userId: number }> {
  const res  = await fetch(`${BASE}/api/auth/loginbyemail`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      email:    CREDENTIALS.valid.email,
      password: CREDENTIALS.valid.password,
    }),
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`Login failed: ${JSON.stringify(body).slice(0, 200)}`);
  return { token: body.token, userId: body.userId };
}

// ─── PART 1: Page exploration — capture all API calls ────────────────────────

test('PROBE 1 — capture all API calls on Wallet / Payment pages', async ({ page }) => {
  test.setTimeout(120000);

  const calls: { method: string; url: string }[] = [];
  const responses: { method: string; url: string; status: number; body: string }[] = [];

  page.on('request', req => {
    const url = req.url();
    if (url.includes(BASE) && (req.resourceType() === 'fetch' || req.resourceType() === 'xhr')) {
      calls.push({ method: req.method(), url: url.replace(BASE, '') });
    }
  });
  page.on('response', async res => {
    const url = res.url();
    if (url.includes(BASE) && url.includes('/api/')) {
      const body = await res.text().catch(() => '');
      responses.push({ method: res.request().method(), url: url.replace(BASE, ''), status: res.status(), body: body.slice(0, 300) });
    }
  });

  // Login first
  await login(page);
  console.log('[PROBE 1] Logged in →', page.url());

  // ── Navigate to wallet page ──────────────────────────────────────────────
  console.log('\n[PROBE 1] Navigating to /wallet ...');
  await page.goto(`${BASE}/wallet`).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await dumpSnapshot(page, 'Wallet Page');
  await page.screenshot({ path: 'screenshots/16-wallet.png', fullPage: true });

  // ── Navigate to payment page ─────────────────────────────────────────────
  console.log('\n[PROBE 1] Navigating to /payment ...');
  await page.goto(`${BASE}/payment`).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await dumpSnapshot(page, 'Payment Page');
  await page.screenshot({ path: 'screenshots/16-payment.png', fullPage: true });

  // ── Navigate to subscriptions page ──────────────────────────────────────
  for (const path of ['/subscriptions', '/billing', '/account/billing', '/settings/billing']) {
    await page.goto(`${BASE}${path}`).catch(() => {});
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    const url = page.url();
    if (!url.includes('/login') && url !== `${BASE}/`) {
      console.log(`[PROBE 1] Found page: ${path} → ${url}`);
      await dumpSnapshot(page, `Page: ${path}`);
      await page.screenshot({ path: `screenshots/16-page-${path.replace(/\//g, '-')}.png`, fullPage: true });
    }
  }

  // ── Report all captured API calls ────────────────────────────────────────
  console.log('\n══ API calls captured during page navigation ══════════════════');
  const uniqueUrls = [...new Set(responses.map(r => `[${r.status}] ${r.method} ${r.url}`))];
  uniqueUrls.forEach(u => console.log(' ', u));

  // Highlight subscription / billing / schedule related calls
  console.log('\n══ SUBSCRIPTION / BILLING / SCHEDULE related calls ════════════');
  const relevant = responses.filter(r =>
    /subscri|billing|schedule|cron|charge|renew|recur|trigger|invoice/i.test(r.url)
  );
  if (relevant.length === 0) {
    console.log('  (none found — check the full list above)');
  } else {
    relevant.forEach(r => {
      console.log(`  [${r.status}] ${r.method} ${r.url}`);
      console.log(`    body: ${r.body}`);
    });
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
});

// ─── PART 2: Probe candidate trigger endpoints ────────────────────────────────

test('PROBE 2 — brute-probe candidate scheduled-payment trigger endpoints', async () => {
  test.setTimeout(60000);

  const { token, userId } = await getToken();
  console.log(`[PROBE 2] Authenticated as userId=${userId}`);

  // Candidate endpoints to try (GET and POST)
  const candidates = [
    // Generic trigger paths
    { method: 'POST', path: '/api/payments/trigger' },
    { method: 'POST', path: '/api/payments/trigger-daily' },
    { method: 'POST', path: '/api/payments/trigger-monthly' },
    { method: 'POST', path: '/api/payments/trigger-scheduled' },
    { method: 'POST', path: '/api/payments/scheduled/trigger' },
    { method: 'POST', path: '/api/payments/scheduled/run' },
    { method: 'POST', path: '/api/payments/cron/trigger' },
    { method: 'POST', path: '/api/payments/cron/run' },
    // Entity subscription paths
    { method: 'POST', path: '/api/payments/entity/subscriptions/trigger' },
    { method: 'POST', path: `/api/payments/entity/subscriptions/charge` },
    { method: 'POST', path: `/api/payments/entity/${userId}/charge` },
    { method: 'POST', path: '/api/payments/entity/charge' },
    // Admin / scheduler paths
    { method: 'POST', path: '/api/admin/payments/trigger' },
    { method: 'POST', path: '/api/admin/trigger-billing' },
    { method: 'POST', path: '/api/admin/scheduler/run' },
    { method: 'POST', path: '/api/scheduler/trigger' },
    { method: 'POST', path: '/api/scheduler/payments' },
    { method: 'POST', path: '/api/scheduler/run' },
    // GET variants (some trigger endpoints use GET)
    { method: 'GET',  path: '/api/payments/scheduled' },
    { method: 'GET',  path: '/api/payments/subscriptions' },
    { method: 'GET',  path: '/api/payments/entity/subscriptions' },
    { method: 'GET',  path: `/api/payments/entity/subscriptions/${userId}` },
    { method: 'GET',  path: '/api/admin/scheduler' },
  ];

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };

  const results: { method: string; path: string; status: number; body: string }[] = [];

  for (const { method, path } of candidates) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify({ userId }) : undefined,
      });
      const body = await res.text().catch(() => '');
      results.push({ method, path, status: res.status, body: body.slice(0, 200) });
    } catch (e) {
      results.push({ method, path, status: -1, body: String(e) });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n══ PROBE RESULTS ═══════════════════════════════════════════════');

  const found    = results.filter(r => r.status !== 404 && r.status !== -1);
  const notFound = results.filter(r => r.status === 404 || r.status === -1);

  console.log('\n✅ RESPONDING endpoints (not 404):');
  if (found.length === 0) {
    console.log('  (none — all returned 404 or error)');
  } else {
    found.forEach(r => {
      const icon = r.status < 400 ? '🟢' : r.status === 401 || r.status === 403 ? '🔒' : '🔴';
      console.log(`  ${icon} [${r.status}] ${r.method} ${r.path}`);
      console.log(`       ${r.body}`);
    });
  }

  console.log('\n❌ 404 / unreachable endpoints:');
  notFound.forEach(r => console.log(`  [${r.status}] ${r.method} ${r.path}`));

  console.log('\n══ SUMMARY ═════════════════════════════════════════════════════');
  console.log(`  Total probed : ${results.length}`);
  console.log(`  Responding   : ${found.length}`);
  console.log(`  404/error    : ${notFound.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Non-failing assertion — we just want the log output
  // If a trigger endpoint is found, log it clearly
  const trigger = found.filter(r => r.status < 400);
  if (trigger.length > 0) {
    console.log('🎯 POSSIBLE TRIGGER ENDPOINTS:');
    trigger.forEach(r => console.log(`  → ${r.method} ${r.path}`));
  } else {
    console.log('⚠️  No trigger endpoint found automatically.');
    console.log('   Options:');
    console.log('   1. Ask backend team: "Is there a POST /api/xxx to trigger daily billing?"');
    console.log('   2. Use Stripe Test Clock (Strategy A in 07-scheduled-payment.spec.ts)');
    console.log('      → Requires STRIPE_TEST_SECRET_KEY=sk_test_xxx');
  }
});
