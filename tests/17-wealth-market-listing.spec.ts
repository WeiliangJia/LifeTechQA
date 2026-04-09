/**
 * Wealth Market Listing Flow
 *
 * Expected business result:
 *   1) Login
 *   2) Create a new entity and pay entity subscription fee
 *   3) Wealth Market -> List your entity (select the newly created entity)
 *   4) Complete application information
 *   5) Pay application fee with 0341 (expect failure)
 *   6) Retry with 4242 (expect success)
 *   7) Open Payment page and verify latest 2 history records include
 *      one failed payment and one successful payment
 */
import { test, expect, Page, Response } from '@playwright/test';
import { login, fillCard, handle3DS, dumpSnapshot } from './helpers';
import { CARDS, CREDENTIALS } from './fixtures';

test.setTimeout(300000);

const BASE = 'https://lifetech.star-x-tech.com';
const TEST_EMAIL = process.env.LIFETECH_TEST_EMAIL ?? CREDENTIALS.valid.email;
const TEST_PASSWORD = process.env.LIFETECH_TEST_PASSWORD ?? CREDENTIALS.valid.password;

const S = {
  entityMenu: 'button.nav-item:has-text("Entity")',
  addEntityBtn: 'button.add-entity-button',
  addEntityModal: 'div.modal-container',
  addEntityTypeSelect: 'div.modal-container .el-select',
  addEntityNameInput: 'input[placeholder="Enter entity name"]',
  addEntityAbnInput: 'input[placeholder="Search by ABN"]',
  addEntityAcnInput: 'input[placeholder="Enter ACN"]',
  addEntityTfnInput: 'input[placeholder="Enter tax file number"]',
  addEntityPhoneInput: 'input[placeholder="Enter telephone number"]',
  addEntityAddressInput: 'input[placeholder="Enter address line"]',
  addEntityCityInput: 'input[placeholder="Enter City"]',
  addEntityPostcodeInput: 'input[placeholder="Enter Post Code"]',
  addEntityWebsiteInput: 'input[placeholder="Enter company website link"]',
  addEntityCreateBtn: 'button.modal-button.submit-button',
  entityPlanSelectBtn: 'button.select-button',
  entityPlanPayBtn: 'button.pay-button',

  wealthMarketMenu: 'text=Wealth Market',
  paymentMenu: 'text=Payment',
  listEntityBtn: 'button:has-text("List Your Entity"), button:has-text("List your entity")',
  selectListingDialog: '.select-listing-dialog',
  selectEntity: '.select-listing-dialog .el-select',
  selectEntityOption: '.el-select-dropdown__item:not(.is-disabled)',
  nextBtn: 'button.select-listing-dialog__next, .select-listing-dialog button:has-text("Next")',
  payFeeBtn: 'button.pay-fee-btn, button:has-text("Pay Application Fee")',
  stripeCardIframe: 'iframe[title="Secure card number input frame"]',
  applicationTerms: 'label:has-text("I confirm I have read and agree")',
  historyRows: '.el-table__body tbody tr, table tbody tr',
};

type CardData = {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
};

type CapturedResponse = {
  url: string;
  status: number;
  body: unknown;
};

function randDigits(length: number) {
  let out = '';
  while (out.length < length) out += Math.floor(Math.random() * 10);
  if (out[0] === '0') out = `1${out.slice(1)}`;
  return out;
}

async function selectFirstRenderedElPlusOption(page: Page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.el-select-dropdown__item:not(.is-disabled)')) as HTMLElement[];
    const rendered = items.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !/no data/i.test((el.innerText || '').trim());
    });
    if (rendered.length === 0) return null;
    const text = rendered[0].innerText.trim();
    rendered[0].click();
    return text;
  });
}

function normalizeStatusFromRecord(record: Record<string, unknown>) {
  const preferred = [
    record.status,
    record.payment_status,
    record.paymentStatus,
    record.result,
    record.payment_result,
    record.state,
  ].filter(Boolean).join(' ');

  const hay = (preferred || JSON.stringify(record)).toLowerCase();
  if (/(fail|failed|failure|declin|reject|error|unsuccess|cancel|void|失败|错误|拒绝)/i.test(hay)) {
    return 'failed';
  }
  if (/(success|succeed|paid|complete|completed|approve|成功|完成|已支付)/i.test(hay)) {
    return 'success';
  }
  return 'unknown';
}

function pickTimestamp(record: Record<string, unknown>) {
  const keys = [
    'createdAt',
    'created_at',
    'updatedAt',
    'updated_at',
    'paidAt',
    'paid_at',
    'paymentDate',
    'payment_date',
    'time',
    'timestamp',
  ];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number') {
      // support both seconds and milliseconds epoch
      return value > 10_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return 0;
}

function extractRecordArray(payload: unknown): Record<string, unknown>[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  if (typeof payload !== 'object') return [];

  const obj = payload as Record<string, unknown>;
  const keys = ['data', 'records', 'items', 'rows', 'list', 'history', 'payments', 'result'];
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v)) return v.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
    if (v && typeof v === 'object') {
      const nested = v as Record<string, unknown>;
      for (const nestedKey of ['data', 'records', 'items', 'rows', 'list']) {
        const nv = nested[nestedKey];
        if (Array.isArray(nv)) {
          return nv.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
        }
      }
    }
  }
  return [];
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
      await loc.click();
      return true;
    }
  }
  return false;
}

async function fillIfBlank(page: Page, selector: string, value: string) {
  const input = page.locator(selector).first();
  if (await input.count() === 0) return;
  const current = await input.inputValue().catch(() => '');
  if (!current || !current.trim()) await input.fill(value);
}

async function fillIfInvalid(
  page: Page,
  selector: string,
  value: string,
  invalid: (current: string) => boolean,
) {
  const input = page.locator(selector).first();
  if (await input.count() === 0) return;
  const current = await input.inputValue().catch(() => '');
  if (invalid((current ?? '').trim())) {
    await input.fill(value);
  }
}

async function createEntityAndPaySetupFee(page: Page) {
  const runId = Date.now();
  const entityName = `WMEntity${runId}`;
  const abn = randDigits(11);
  const acn = randDigits(9);
  const tfn = randDigits(9);

  const inEntityPage = await clickFirstVisible(page, [S.entityMenu, 'text=Entity']);
  expect(inEntityPage, 'Entity menu should be clickable before creating new entity').toBeTruthy();
  await page.waitForURL(/\/entities/i, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const addEntityClicked = await clickFirstVisible(page, [S.addEntityBtn]);
  expect(addEntityClicked, 'Add Entity button should be visible').toBeTruthy();
  await expect(page.locator(S.addEntityModal)).toBeVisible({ timeout: 10000 });

  // Entity type (first dropdown)
  const typeSelect = page.locator(S.addEntityTypeSelect).first();
  if (await typeSelect.count() > 0) {
    await typeSelect.click();
    const entityTypeText = await selectFirstRenderedElPlusOption(page);
    console.log('[Entity Create] entity type:', entityTypeText ?? '(unknown)');
  }

  // Fill add-entity fields
  const fields: Array<{ selector: string; value: string }> = [
    { selector: S.addEntityNameInput, value: entityName },
    { selector: S.addEntityAbnInput, value: abn },
    { selector: S.addEntityAcnInput, value: acn },
    { selector: S.addEntityTfnInput, value: tfn },
    { selector: S.addEntityPhoneInput, value: '0412345678' },
    { selector: S.addEntityAddressInput, value: '123 Test Street' },
    { selector: S.addEntityCityInput, value: 'Sydney' },
    { selector: S.addEntityPostcodeInput, value: '2000' },
    { selector: S.addEntityWebsiteInput, value: `https://example.com/${runId}` },
  ];

  for (const { selector, value } of fields) {
    const loc = page.locator(selector).first();
    if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
      await loc.fill(value);
    }
  }

  // Optional extra dropdowns (state/country) in modal
  const modalSelects = page.locator(`${S.addEntityModal} .el-select`);
  const modalSelectCount = await modalSelects.count();
  for (let i = 1; i < modalSelectCount; i++) {
    const dd = modalSelects.nth(i);
    if (!(await dd.isVisible().catch(() => false))) continue;
    await dd.click();
    await selectFirstRenderedElPlusOption(page);
  }

  await page.screenshot({ path: 'screenshots/17-entity-create-filled.png', fullPage: true });

  // Submit create entity
  const createdResponsePromise = page.waitForResponse(
    res => res.request().method() === 'POST' && /\/api\/entities(\/|$)/i.test(res.url()),
    { timeout: 45000 },
  ).catch(() => null);

  const createBtn = page.locator(S.addEntityCreateBtn).first();
  await expect(createBtn).toBeVisible({ timeout: 8000 });
  await createBtn.click();
  await page.waitForTimeout(2500);

  const createdRes = await createdResponsePromise;
  if (createdRes) console.log('[Entity Create] API:', createdRes.status(), createdRes.url());

  // Plan select -> pay dialog
  const payBtn = page.locator(S.entityPlanPayBtn).first();
  const payDialogVisible = await payBtn.isVisible().catch(() => false);
  if (!payDialogVisible) {
    const selectPlan = page.locator(S.entityPlanSelectBtn).first();
    await expect(selectPlan).toBeVisible({ timeout: 15000 });
    await selectPlan.click();
    await page.waitForTimeout(1500);
  }

  await expect(payBtn).toBeVisible({ timeout: 20000 });

  const dialog = page.locator('.el-dialog').last();
  const savedCard4242 = dialog.locator('text=/4242/').first();
  const hasSavedCard4242 =
    await savedCard4242.count() > 0 && await savedCard4242.isVisible().catch(() => false);

  if (hasSavedCard4242) {
    await savedCard4242.click();
    console.log('[Entity Fee] Using saved card ending 4242');
  } else {
    await clickFirstVisible(page, [
      '.el-dialog button:has-text("Use a different card")',
      '.el-dialog button:has-text("Add Payment Method")',
      '.el-dialog [class*="different-card"]',
      '.el-dialog [class*="new-card"]',
      'text=Use a different card',
    ]);
    await fillCard(page, CARDS.visa_success);
  }

  const subscribePayResponsePromise = page.waitForResponse(
    res =>
      res.request().method() === 'POST'
      && (
        /\/api\/payments\/entity\/\d+\/subscribe/i.test(res.url())
        || /\/api\/payments/i.test(res.url())
      ),
    { timeout: 45000 },
  ).catch(() => null);

  await payBtn.click();
  const subscribePayRes = await subscribePayResponsePromise;
  const subscribePayBody = await subscribePayRes?.json().catch(() => null);
  console.log('[Entity Fee] API:', subscribePayRes?.status(), subscribePayRes?.url());

  const entityPaySuccess =
    (subscribePayRes ? subscribePayRes.status() >= 200 && subscribePayRes.status() < 300 : false)
    || bodyMentionsSuccess(subscribePayBody)
    || await page.locator('text=/success|succeed|paid|complete|thank|成功|完成/i').count() > 0;

  expect(entityPaySuccess, 'New entity setup fee payment should succeed').toBeTruthy();

  // Close the payment dialog if still open (it blocks navigation clicks)
  await page.waitForTimeout(1500);
  const closeBtn = page.locator('button.el-dialog__headerbtn').last();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
    console.log('[Entity Fee] Closed payment dialog after success');
    await page.waitForTimeout(500);
  }
  // Dismiss any success overlay/toast blocking the page
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // NOTE: Do NOT poll /entities page here — that query uses a different
  // backend index from `ableToList=true`, so a positive match on /entities
  // doesn't guarantee the Wealth Market dropdown will have the entity.
  // `waitForEntityListable` (called later from openListDialogAndSelectEntity)
  // polls the correct endpoint directly and is the single source of truth.
  // Just navigate away from the payment dialog so it doesn't block anything.
  await page.goto('/entities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  return { entityName };
}

async function findVisibleOptionByText(page: Page, entityName: string) {
  // Element Plus teleports dropdowns to body, so there can be multiple stale
  // .el-select-dropdown in DOM. Iterate all matches and return the first
  // VISIBLE one rather than blindly using .first().
  const matches = page
    .locator(S.selectEntityOption)
    .filter({ hasText: entityName });
  const count = await matches.count();
  for (let i = 0; i < count; i++) {
    const opt = matches.nth(i);
    if (await opt.isVisible().catch(() => false)) return opt;
  }
  return null;
}

async function scrollDropdownToLoadAll(page: Page) {
  // Scroll the currently visible el-select dropdown body to trigger rendering
  // of virtualized / lazy-loaded options.
  await page.evaluate(async () => {
    const dropdowns = Array.from(
      document.querySelectorAll('.el-select-dropdown'),
    ) as HTMLElement[];
    const visible = dropdowns.find(
      d => d.offsetWidth > 0 && d.offsetHeight > 0,
    );
    if (!visible) return;
    const wrap =
      (visible.querySelector('.el-scrollbar__wrap') as HTMLElement | null)
      ?? (visible.querySelector('.el-select-dropdown__wrap') as HTMLElement | null);
    if (!wrap) return;
    const step = Math.max(120, Math.floor(wrap.clientHeight * 0.8));
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (let y = 0; y <= wrap.scrollHeight + step; y += step) {
      wrap.scrollTop = y;
      await sleep(150);
    }
    wrap.scrollTop = 0;
    await sleep(100);
  });
}

function pickEntityName(record: Record<string, unknown>): string {
  const candidates = [
    record.name,
    record.entityName,
    record.entity_name,
    record.companyName,
    record.company_name,
    record.displayName,
    record.title,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function pickEntityId(record: Record<string, unknown>): string | number | null {
  const candidates = [
    record.id,
    record.entityId,
    record.entity_id,
    record.uuid,
    record._id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' || typeof c === 'number') return c;
  }
  return null;
}

/**
 * Given the listable-entities API response (already parsed via
 * extractRecordArray), find the target entity by exact name and return its
 * array index + id. Returns { index: -1, id: null } if not found.
 */
function findEntityInListable(
  listable: Record<string, unknown>[],
  entityName: string,
): { index: number; id: string | number | null } {
  const target = entityName.trim();
  for (let i = 0; i < listable.length; i++) {
    if (pickEntityName(listable[i]) === target) {
      return { index: i, id: pickEntityId(listable[i]) };
    }
  }
  return { index: -1, id: null };
}

/**
 * Click the N-th enabled option in the currently-visible el-select dropdown
 * from inside the page (so we can scroll virtualized lists into view before
 * clicking). Returns the trimmed text content of the clicked option, or null
 * if the index is out of range / no visible dropdown exists.
 */
async function clickOptionAtIndex(page: Page, index: number): Promise<string | null> {
  return page.evaluate((idx) => {
    const dropdowns = Array.from(
      document.querySelectorAll('.el-select-dropdown'),
    ) as HTMLElement[];
    const visible = dropdowns.find(d => {
      const r = d.getBoundingClientRect();
      const cs = getComputedStyle(d);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    if (!visible) return null;
    const items = Array.from(
      visible.querySelectorAll('.el-select-dropdown__item:not(.is-disabled)'),
    ) as HTMLElement[];
    if (idx < 0 || idx >= items.length) return null;
    items[idx].scrollIntoView({ block: 'center' });
    items[idx].click();
    return (items[idx].textContent || '').trim();
  }, index);
}

/**
 * Poll the /api/entities/by-user/{id}?ableToList=true endpoint DIRECTLY
 * (via page.evaluate fetch, so browser auth cookies/tokens are reused) until
 * the newly-created entity appears in the response.
 *
 * This avoids the slow UI retry loop (open dialog → click select → close → reload)
 * when the real bottleneck is backend index sync — which can take 1–3 minutes.
 */
async function waitForEntityListable(
  page: Page,
  entityName: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    const payload = await page.evaluate(async () => {
      const userId =
        localStorage.getItem('userId')
        ?? localStorage.getItem('user_id')
        ?? localStorage.getItem('uid');
      if (!userId) return { error: 'no userId in localStorage' };
      const token =
        localStorage.getItem('token')
        ?? localStorage.getItem('access_token')
        ?? localStorage.getItem('authToken')
        ?? '';
      try {
        const res = await fetch(`/api/entities/by-user/${userId}?ableToList=true`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return { error: `status ${res.status}` };
        return { data: await res.json() };
      } catch (e) {
        return { error: String(e) };
      }
    }).catch(() => null as { data?: unknown; error?: string } | null);

    if (payload && 'data' in payload && payload.data !== undefined) {
      const list = extractRecordArray(payload.data);
      const names = list.map(pickEntityName).filter(Boolean);
      const found = names.some(n => n === entityName.trim());
      console.log(
        `[waitForEntityListable #${attempt}] ${list.length} listable entities`
        + (names.length ? ` → [${names.slice(0, 10).join(', ')}${names.length > 10 ? ', ...' : ''}]` : '')
        + ` | target="${entityName}" inApi=${found}`,
      );
      if (found) {
        console.log(
          `[waitForEntityListable] entity listable after ${((Date.now() - start) / 1000).toFixed(1)}s`,
        );
        return true;
      }
    } else {
      console.log(
        `[waitForEntityListable #${attempt}] fetch error: ${payload?.error ?? 'unknown'}`,
      );
    }

    // Poll every 2s — tight enough to catch fast index updates without
    // hammering the server
    if (Date.now() - start + 2000 >= timeoutMs) break;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function openListDialogAndSelectEntity(page: Page, entityName: string) {
  // Step 1: pre-poll the backend directly until the new entity appears in
  // the listable-entities response. Lightweight (fetch every 2s) — much
  // cheaper than repeatedly reopening the dialog from the UI. The 180s
  // ceiling is deliberately generous: on slow backend days the listable
  // index can lag by 60–120s, and we'd rather wait here than burn budget
  // on UI retry (each UI attempt costs ~10s of reload + dialog animation).
  const apiReady = await waitForEntityListable(page, entityName, 180000);
  if (!apiReady) {
    console.warn(
      `[Wealth Market] entity "${entityName}" still NOT in ableToList API after 180s`
      + ' — UI retry will still attempt, but this usually indicates a backend /'
      + ' business-rule issue (e.g. wrong entity type or plan tier).',
    );
  }

  // Step 2: open the dialog and select the option. Because the pre-poll has
  // already verified backend readiness, 3 attempts is plenty — this only
  // guards against transient DOM rendering races.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const listClicked = await clickFirstVisible(page, [S.listEntityBtn]);
    expect(listClicked, '"List Your Entity" button should be visible').toBeTruthy();
    await expect(page.locator(S.selectListingDialog)).toBeVisible({ timeout: 10000 });

    // Capture the API response triggered by opening the el-select. This is
    // the ground truth the dropdown is built from.
    const apiPromise = page.waitForResponse(
      res =>
        res.request().method() === 'GET'
        && /\/api\/entities\/by-user\/\d+.*ableToList=true/i.test(res.url()),
      { timeout: 15000 },
    ).catch(() => null);

    const select = page.locator(S.selectEntity).first();
    await select.click();

    const apiRes = await apiPromise;
    const apiBody = await apiRes?.json().catch(() => null);
    const listable = extractRecordArray(apiBody);

    // On first attempt, log the raw shape of an entity so we can verify
    // `pickEntityName` / `pickEntityId` are reading the right fields.
    if (attempt === 1 && listable.length > 0) {
      console.log(
        '[Wealth Market] sample listable entity shape:',
        JSON.stringify(listable[0]).slice(0, 400),
      );
    }

    const apiNames = listable.map(pickEntityName).filter(Boolean);
    const { index: targetIdx, id: targetId } = findEntityInListable(listable, entityName);

    console.log(
      `[Wealth Market] attempt ${attempt}/${maxAttempts}: ${listable.length} listable entities`
      + ` | target="${entityName}" apiIndex=${targetIdx} apiId=${targetId}`
      + (apiNames.length
        ? ` | names=[${apiNames.slice(0, 10).join(', ')}${apiNames.length > 10 ? ', ...' : ''}]`
        : ''),
    );

    if (targetIdx >= 0) {
      // Strategy A: click the option at the exact index the API told us
      await page.waitForTimeout(400); // allow options to render
      const clickedText = await clickOptionAtIndex(page, targetIdx);
      if (clickedText && clickedText === entityName.trim()) {
        console.log(
          `[Wealth Market] selected "${entityName}" via API index ${targetIdx}`,
        );
        return true;
      }

      if (clickedText !== null && clickedText !== entityName.trim()) {
        console.warn(
          `[Wealth Market] index ${targetIdx} text mismatch: dropdown="${clickedText}"`
          + ` vs target="${entityName}" — DOM order may differ from API`,
        );
      }

      // Strategy B: fall back to text match (handles DOM/API order mismatch)
      await scrollDropdownToLoadAll(page);
      const match = await findVisibleOptionByText(page, entityName);
      if (match) {
        await match.click();
        console.log('[Wealth Market] selected entity via text fallback:', entityName);
        return true;
      }
      console.warn(
        '[Wealth Market] entity in API response but not clickable in dropdown DOM — will retry',
      );
    } else {
      console.log(
        `[Wealth Market] "${entityName}" NOT in this attempt's ableToList response`
        + ' — backend may have evicted it since the pre-poll; will retry',
      );
    }

    const close = page.locator(`${S.selectListingDialog} .el-dialog__headerbtn`).first();
    if (await close.count() > 0) await close.click();
    await page.waitForTimeout(800);

    if (attempt < maxAttempts) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    }
  }
  return false;
}

async function ensureTermsChecked(page: Page) {
  const termsLabel = page.locator(S.applicationTerms).first();
  if (await termsLabel.count() === 0) return;

  const checkbox = termsLabel.locator('input[type="checkbox"]').first();
  if (await checkbox.count() === 0) return;

  const checked = await checkbox.isChecked().catch(() => false);
  if (!checked) await termsLabel.click();
}

async function ensureStripeFormReady(page: Page) {
  // If dialog is not open, click Pay Application Fee first
  const stripeFrame = page.locator(S.stripeCardIframe).first();
  const hasStripe = await stripeFrame.count() > 0 && await stripeFrame.isVisible().catch(() => false);

  if (!hasStripe) {
    const opened = await clickFirstVisible(page, [S.payFeeBtn]);
    expect(opened, 'Pay Application Fee button should be clickable').toBeTruthy();
    await page.waitForTimeout(1200);
  }

  // Some accounts have saved cards; switch to "new card" mode if needed
  await clickFirstVisible(page, [
    '.el-dialog button:has-text("Use a different card")',
    '.el-dialog button:has-text("Add Payment Method")',
    '.el-dialog [class*="different-card"]',
    '.el-dialog [class*="new-card"]',
    'text=Use a different card',
  ]);

  await expect(page.locator(S.stripeCardIframe).first()).toBeVisible({ timeout: 20000 });
}

async function clickSubmitInPaymentDialog(page: Page) {
  const clicked = await clickFirstVisible(page, [
    '.el-dialog button.pay-button',
    '.el-dialog button.submit-button',
    '.el-dialog button:has-text("Pay")',
    '.el-dialog button:has-text("Complete Payment")',
    'button.pay-button',
    'button.submit-button',
  ]);
  expect(clicked, 'A payment submit button should be visible in dialog').toBeTruthy();
}

async function closeAnyBlockingDialog(page: Page) {
  await clickFirstVisible(page, [
    'button.dialog-button:has-text("Try Again")',
    '.el-dialog__headerbtn',
    '.el-dialog button:has-text("Cancel")',
  ]);
  await page.waitForTimeout(700);
}

async function verifyStripeCardFilled(page: Page): Promise<boolean> {
  // Stripe marks empty inputs with `is-empty` and unfilled inputs with
  // `Input--empty`. After a successful fill the class should include neither.
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll(
      'iframe[title="Secure card number input frame"]',
    )) as HTMLIFrameElement[];
    for (const f of frames) {
      try {
        const doc = f.contentDocument;
        if (!doc) continue;
        const input = doc.querySelector('input[name="cardnumber"]') as HTMLInputElement | null;
        if (!input) continue;
        const cls = input.className || '';
        // Consider "filled" if it has neither empty nor invalid markers
        if (!/is-empty|Input--empty|is-invalid/.test(cls)) return true;
      } catch {
        // cross-origin iframe — can't introspect; assume OK
        return true;
      }
    }
    return false;
  });
}

async function runPaymentAttempt(
  page: Page,
  card: CardData,
  expected: 'fail' | 'success',
): Promise<Response | null> {
  await ensureStripeFormReady(page);

  // Stripe iframes are notoriously flaky about key dispatch when the iframe
  // is still settling. Let the iframe finish its internal init before we
  // start typing, then verify the card number actually made it in. If not,
  // retry fillCard once.
  await page.waitForTimeout(1500);
  await fillCard(page, card);
  await page.waitForTimeout(800);

  const filled = await verifyStripeCardFilled(page).catch(() => true);
  if (!filled) {
    console.warn(
      '[Stripe] card number input still empty/invalid after fillCard — retrying once',
    );
    await page.waitForTimeout(1000);
    await fillCard(page, card);
    await page.waitForTimeout(800);
  }

  const confirmPaymentPromise = page.waitForResponse(
    res =>
      res.request().method() === 'POST'
      && /\/api\/marketplace\/applications\/\d+\/confirm-payment/i.test(res.url()),
    { timeout: 30000 },
  ).catch(() => null);

  const genericPayPromise = page.waitForResponse(
    res =>
      res.request().method() === 'POST'
      && (
        res.url().includes('/api/payments')
        || /\/api\/.*(pay|payment|subscribe|checkout)/i.test(res.url())
      ),
    { timeout: 30000 },
  ).catch(() => null);

  await clickSubmitInPaymentDialog(page);

  if (expected === 'fail') {
    // 0341 typically opens 3DS and should fail auth
    await handle3DS(page, 'fail');
  }

  const confirmPaymentRes = await confirmPaymentPromise;
  const payResponse = confirmPaymentRes ?? await genericPayPromise;
  await page.waitForTimeout(3000);
  return payResponse;
}

function bodyMentionsFailure(payload: unknown) {
  const hay = JSON.stringify(payload ?? '').toLowerCase();
  return /(fail|failed|declin|error|unsuccess|失败|错误)/.test(hay);
}

function bodyMentionsSuccess(payload: unknown) {
  const hay = JSON.stringify(payload ?? '').toLowerCase();
  return /(success|succeed|paid|complete|completed|成功|完成)/.test(hay);
}

test.describe('Wealth Market Listing', () => {
  test('create new entity + pay -> list in marketplace -> 0341 fail -> 4242 success -> history check', async ({ page }) => {
    const paymentGetResponses: CapturedResponse[] = [];

    page.on('response', async res => {
      const url = res.url();
      if (!url.includes('/api/')) return;

      if (url.includes(BASE)) {
        console.log(
          `[API ${res.status()}] ${res.request().method()} ${url.replace(BASE, '')}`,
        );
      }

      if (
        res.request().method() === 'POST'
        && /\/api\/marketplace\/applications(\/\d+\/confirm-payment)?/i.test(url)
      ) {
        const body = await res.json().catch(() => null);
        if (body) {
          console.log('[Marketplace payment body]', JSON.stringify(body).slice(0, 500));
        }
      }

      if (res.request().method() !== 'GET' || !url.includes('/api/payments')) return;
      const body = await res.json().catch(() => null);
      paymentGetResponses.push({ url, status: res.status(), body });
    });

    // ── Step 1: Login ──────────────────────────────────────────────────────
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    // ── Step 2: Create a brand-new entity and pay entity setup fee ────────
    const { entityName } = await createEntityAndPaySetupFee(page);
    console.log('[Step 2] New entity created and paid:', entityName);

    // ── Step 3: Open Wealth Market ─────────────────────────────────────────
    const marketOpened = await clickFirstVisible(page, [S.wealthMarketMenu]);
    expect(marketOpened, 'Wealth Market menu should be clickable').toBeTruthy();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/marketplace/i, { timeout: 15000 });

    // ── Step 4: List your entity -> choose the new entity -> Next ─────────
    const selectedEntityFound = await openListDialogAndSelectEntity(page, entityName);
    expect(
      selectedEntityFound,
      `Should find the newly created entity "${entityName}" in List Your Entity dropdown`,
    ).toBeTruthy();

    const nextBtn = page.locator(S.nextBtn).first();
    await expect(nextBtn).toBeEnabled({ timeout: 10000 });
    await nextBtn.click();
    await page.waitForURL(/\/marketplace\/create/i, { timeout: 15000 });
    await page.waitForTimeout(1500);

    // ── Step 5: Complete Application Information ───────────────────────────
    const runId = Date.now();
    await fillIfBlank(page, 'input[placeholder="Mr"], input[placeholder="Miss"]', 'Miss');
    await fillIfBlank(page, 'input[placeholder="John"]', 'Joy');
    await fillIfBlank(page, 'input[placeholder="Smith"]', 'Zhu');
    await fillIfInvalid(
      page,
      'input[placeholder="Mobile Phone"]',
      '412345678',
      current => current.replace(/\D/g, '').length < 8,
    );
    await fillIfInvalid(
      page,
      'input[placeholder="contact@info.com.au"]',
      'joy_zhu0921@163.com',
      current => !/.+@.+\..+/.test(current),
    );
    await fillIfBlank(page, 'input[placeholder="Enter ABRS ID"]', String(runId).slice(-8));
    await fillIfBlank(page, 'input[placeholder="Enter Entity Name"]', `WM-Auto-${runId}`);
    await fillIfInvalid(
      page,
      'input[placeholder="Enter ABN"]',
      '12345678901',
      current => current.replace(/\D/g, '').length !== 11,
    );
    await fillIfInvalid(
      page,
      'input[placeholder="Enter ACN"]',
      '123456789',
      current => current.replace(/\D/g, '').length !== 9,
    );
    await fillIfBlank(page, 'input[placeholder="https://example.com"]', `https://example.com/${runId}`);
    await fillIfBlank(page, 'textarea[placeholder="Enter Business Scope Here"]', `Automated listing test ${runId}`);
    await ensureTermsChecked(page);

    await page.screenshot({ path: 'screenshots/17-wealth-market-application-filled.png', fullPage: true });

    // ── Step 6: First payment with 0341 (expect fail) ──────────────────────
    console.log('\n[Attempt 1] card 4000 0000 0000 0341 (expect failure)');
    const failRes = await runPaymentAttempt(page, CARDS.three_d_secure_fail, 'fail');
    const failBody = await failRes?.json().catch(() => null);
    console.log('[Attempt 1] API:', failRes?.status(), failRes?.url());

    const failSignal =
      (failRes ? failRes.status() >= 400 : false)
      || bodyMentionsFailure(failBody)
      || await page.locator('text=/failed|declined|error|unsuccess|失败|错误/i').count() > 0;

    console.log(
      '[Attempt 1] fail signal:', failSignal,
      '| body:', (JSON.stringify(failBody) ?? 'null').slice(0, 300),
    );
    await page.screenshot({ path: 'screenshots/17-wealth-market-pay-attempt1-fail.png', fullPage: true });
    await closeAnyBlockingDialog(page);

    // ── Step 7: Retry with 4242 (expect success) ───────────────────────────
    console.log('\n[Attempt 2] card 4242 4242 4242 4242 (expect success)');
    const successRes = await runPaymentAttempt(page, CARDS.visa_success, 'success');
    const successBody = await successRes?.json().catch(() => null);
    console.log('[Attempt 2] API:', successRes?.status(), successRes?.url());

    const successSignal =
      (successRes ? successRes.status() >= 200 && successRes.status() < 300 : false)
      || bodyMentionsSuccess(successBody)
      || await page.locator('text=/success|succeed|paid|complete|成功|已支付|完成/i').count() > 0;

    console.log(
      '[Attempt 2] success signal:', successSignal,
      '| body:', (JSON.stringify(successBody) ?? 'null').slice(0, 300),
    );
    await page.screenshot({ path: 'screenshots/17-wealth-market-pay-attempt2-success.png', fullPage: true });

    // ── Step 8: Open Payment page and verify latest two history items ──────
    const paymentOpened = await clickFirstVisible(page, [S.paymentMenu]);
    if (!paymentOpened) await page.goto(`${BASE}/payment`);
    await page.waitForURL(/\/payment/i, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await page.screenshot({ path: 'screenshots/17-wealth-market-payment-page.png', fullPage: true });

    const hasHistoryTitle = await page.locator('text=Payment History').count() > 0;
    const uiRowsCount = await page.locator(S.historyRows).count();
    console.log('[Payment page] has "Payment History" title:', hasHistoryTitle, '| rows:', uiRowsCount);

    // Pick best payment-history-like API response
    const candidates = paymentGetResponses
      .map(entry => ({
        ...entry,
        records: extractRecordArray(entry.body),
      }))
      .filter(entry => entry.records.length >= 2);

    expect(candidates.length, 'Should capture a payment-history API response with at least 2 records').toBeGreaterThan(0);

    candidates.sort((a, b) => {
      const aScore = (a.url.includes('history') ? 3 : 0) + (a.records.length >= 2 ? 1 : 0);
      const bScore = (b.url.includes('history') ? 3 : 0) + (b.records.length >= 2 ? 1 : 0);
      return bScore - aScore;
    });

    const selected = candidates[0];
    const sorted = [...selected.records].sort((a, b) => pickTimestamp(b) - pickTimestamp(a));
    const latestTwo = sorted.slice(0, 2);
    const latestTwoStatuses = latestTwo.map(normalizeStatusFromRecord);

    console.log('[Payment history API source]', selected.url.replace(BASE, ''));
    console.log('[Payment history latest two statuses]', latestTwoStatuses.join(', '));

    expect(latestTwo.length, 'Payment history should have at least 2 records').toBe(2);
    expect(
      latestTwoStatuses.filter(s => s === 'failed').length >= 1,
      'Latest two payment records should include a failed payment',
    ).toBeTruthy();
    expect(
      latestTwoStatuses.filter(s => s === 'success').length >= 1,
      'Latest two payment records should include a successful payment',
    ).toBeTruthy();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await dumpSnapshot(page, '17-wealth-market failure snapshot');
    }
  });
});
