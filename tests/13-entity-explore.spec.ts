/**
 * Entity Flow Explorer
 *
 * 探索以下几个状态的 DOM，为 14-entity-flow.spec.ts 提供精确选择器：
 *   1. 登录后首页 — 找 Entity 导航入口
 *   2. Entity 列表页 — 找 "Add Entity" 按钮
 *   3. Add Entity 弹窗表单 — 找所有字段
 *   4. 提交后的 Plan 选择弹窗 — 找 plan 卡片
 *   5. Plan 选择后的支付表单 — 确认 Stripe iframe 是否与已知一致
 *
 * 运行：
 *   npx playwright test tests/13-entity-explore.spec.ts --headed
 */
import { test } from '@playwright/test';
import { login, dumpSnapshot } from './helpers';

// ─── 扩展版 dumpSnapshot：额外捕捉可点击的 div/li/span ────────────────────────

async function dumpFull(page: Parameters<typeof login>[0], label: string) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`[${label}]  ${page.url()}`);
  console.log('═'.repeat(64));

  const dom = await page.evaluate(() => {
    const toObj = (el: Element) => ({
      tag:        el.tagName.toLowerCase(),
      type:       (el as HTMLInputElement).type       ?? null,
      placeholder:(el as HTMLInputElement).placeholder ?? null,
      name:       (el as HTMLInputElement).name        ?? null,
      id:         el.id || null,
      class:      el.className || null,
      text:       (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) || null,
      ariaLabel:  el.getAttribute('aria-label'),
      role:       el.getAttribute('role'),
      disabled:   (el as HTMLButtonElement).disabled ?? false,
      visible:    (el as HTMLElement).offsetParent !== null,
    });

    const inputs  = Array.from(document.querySelectorAll('input')).map(toObj);
    const buttons = Array.from(document.querySelectorAll('button')).map(toObj);
    const selects = Array.from(document.querySelectorAll('select')).map(toObj);
    const custom  = Array.from(document.querySelectorAll(
      '[role="button"], [role="option"], [role="dialog"], ' +
      '[class*="btn"], [class*="card"], [class*="plan"], [class*="item"], ' +
      '[class*="option"], [class*="entity"], [class*="add"], [class*="modal"]'
    )).map(toObj).filter(el => el.text && el.text.length > 0 && el.visible);

    return { inputs, buttons, selects, custom };
  });

  console.log(`\n── inputs (${dom.inputs.length}) ──`);
  dom.inputs.filter(i => i.visible).forEach(i => console.log(' ', JSON.stringify(i)));

  console.log(`\n── buttons (${dom.buttons.length}, showing visible) ──`);
  dom.buttons.filter(b => b.visible).forEach(b => console.log(' ', JSON.stringify(b)));

  if (dom.selects.length) {
    console.log(`\n── selects (${dom.selects.length}) ──`);
    dom.selects.forEach(s => console.log(' ', JSON.stringify(s)));
  }

  console.log(`\n── custom clickable divs/spans (${dom.custom.length}) ──`);
  dom.custom.slice(0, 30).forEach(c => console.log(' ', JSON.stringify(c)));

  const visibleText = await page.evaluate(() =>
    (document.body as HTMLElement).innerText
      .split('\n').map(l => l.trim())
      .filter(l => l.length > 1 && l.length < 100)
      .slice(0, 50)
  );
  console.log('\n── Visible text (first 50 lines) ──');
  visibleText.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

  console.log('\n' + '═'.repeat(64) + '\n');
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

test('EXPLORE: step-by-step entity creation flow', async ({ page }) => {
  test.setTimeout(120000);

  // Log all API calls for reference
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

  // ── STEP 1: 登录 ────────────────────────────────────────────────────────────
  await login(page, '1144890814@qq.com', '66666666');
  await page.waitForTimeout(2000);
  console.log('\n[Step 1] Logged in →', page.url());
  await page.screenshot({ path: 'screenshots/13-s1-after-login.png', fullPage: true });
  await dumpFull(page, 'After Login — home/dashboard');

  // ── STEP 2: 找 Entity 导航 ──────────────────────────────────────────────────
  // 尝试常见的 Entity 导航方式
  const entityNavSelectors = [
    'a:has-text("Entity")',
    'a:has-text("Entities")',
    '[class*="nav"] :has-text("Entity")',
    '[class*="menu"] :has-text("Entity")',
    'li:has-text("Entity")',
    'span:has-text("Entity")',
  ];

  let entityNavClicked = false;
  for (const sel of entityNavSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Entity Nav] Found with: ${sel}`);
      await el.click();
      entityNavClicked = true;
      break;
    }
  }
  if (!entityNavClicked) {
    console.warn('[Entity Nav] NOT FOUND — check screenshot 13-s1-after-login.png for navigation');
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/13-s2-entity-list.png', fullPage: true });
  await dumpFull(page, 'Entity List Page');
  console.log('[Step 2] URL:', page.url());

  // ── STEP 3: 找 Add Entity 按钮 ──────────────────────────────────────────────
  const addEntitySelectors = [
    'button:has-text("Add Entity")',
    'button:has-text("Add")',
    'a:has-text("Add Entity")',
    '[class*="add"]:has-text("Entity")',
    'button:has-text("Create")',
    'button:has-text("New")',
  ];

  let addClicked = false;
  for (const sel of addEntitySelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log(`[Add Entity] Found with: ${sel}`);
      await el.click();
      addClicked = true;
      break;
    }
  }
  if (!addClicked) {
    console.warn('[Add Entity] Button NOT FOUND — check screenshot 13-s2-entity-list.png');
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/13-s3-add-entity-modal.png', fullPage: true });
  await dumpFull(page, 'Add Entity Modal/Form');
  console.log('[Step 3] URL after Add Entity click:', page.url());

  // ── STEP 4: 填写表单并提交 ───────────────────────────────────────────────────
  // 先不填，只抓 DOM 结构
  // 用通用方式填一些常见字段名（如有）
  const visibleInputs = page.locator('input:visible, textarea:visible');
  const inputCount = await visibleInputs.count();
  console.log(`[Form] Visible inputs: ${inputCount}`);

  for (let i = 0; i < inputCount; i++) {
    const el = visibleInputs.nth(i);
    const ph = await el.getAttribute('placeholder').catch(() => '');
    const ty = await el.getAttribute('type').catch(() => 'text');
    if (ty === 'hidden' || ty === 'radio' || ty === 'checkbox') continue;
    // Fill with placeholder text as dummy value
    const val = ph ? `Test ${ph}` : `TestValue${i}`;
    await el.fill(val).catch(() => {});
    console.log(`[Form] Filled input[${i}] placeholder="${ph}" → "${val}"`);
  }

  // Handle El-Plus dropdowns if any
  const elSelects = page.locator('.el-select:visible');
  const selectCount = await elSelects.count();
  if (selectCount > 0) {
    console.log(`[Form] ${selectCount} El-Plus dropdowns found`);
    for (let i = 0; i < selectCount; i++) {
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
      console.log(`[Form] dropdown[${i}]: selected "${optText}"`);
      await page.waitForTimeout(600);
    }
  }

  await page.screenshot({ path: 'screenshots/13-s4-form-filled.png', fullPage: true });

  // Find and click the submit button
  const submitSelectors = [
    'button[type="submit"]',
    'button.submit-btn',
    'button:has-text("Submit")',
    'button:has-text("Create")',
    'button:has-text("Save")',
    'button:has-text("Confirm")',
    'button:has-text("Next")',
  ];

  let submitClicked = false;
  for (const sel of submitSelectors) {
    const el = page.locator(sel).filter({ hasNot: page.locator('[disabled]') }).first();
    if (await el.count() > 0) {
      const txt = await el.innerText().catch(() => '?');
      console.log(`[Submit] Found with: ${sel} — text: "${txt}"`);
      await el.click();
      submitClicked = true;
      break;
    }
  }
  if (!submitClicked) {
    console.warn('[Submit] Button NOT FOUND — check screenshot 13-s4-form-filled.png');
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/13-s5-after-submit.png', fullPage: true });
  await dumpFull(page, 'After Entity Form Submit — expect Plan selection');
  console.log('[Step 4] URL after submit:', page.url());

  // ── STEP 5: Plan 选择弹窗 ───────────────────────────────────────────────────
  // DOM 抓取已在上方 dumpFull 中完成
  // 尝试找 plan 卡片
  const planSelectors = [
    '[class*="plan"]',
    '[class*="Plan"]',
    '[class*="subscription"]',
    '[class*="package"]',
    '[class*="pricing"]',
    '[role="radio"]',
  ];

  let planFound = false;
  for (const sel of planSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      console.log(`[Plan] ${count} element(s) found with: ${sel}`);
      planFound = true;
    }
  }
  if (!planFound) {
    console.warn('[Plan] No plan elements found — may need to scroll or wait longer');
  }

  // Click the first plan option
  const firstPlan = page.locator('[class*="plan"], [class*="Plan"], [role="radio"]').first();
  if (await firstPlan.count() > 0) {
    await firstPlan.click();
    console.log('[Plan] Clicked first plan option');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/13-s6-plan-selected.png', fullPage: true });
    await dumpFull(page, 'After Plan Selected — expect payment form');
  }

  // ── STEP 6: 支付表单 ─────────────────────────────────────────────────────────
  const stripeIframe = page.locator('iframe[title="Secure card number input frame"]');
  const hasStripe = await stripeIframe.waitFor({ timeout: 15000 })
    .then(() => true).catch(() => false);

  if (hasStripe) {
    console.log('[Step 6] Stripe payment form found ✓');
    await page.screenshot({ path: 'screenshots/13-s7-payment-form.png', fullPage: true });
    await dumpSnapshot(page, 'Payment Form');
  } else {
    console.warn('[Step 6] Stripe form NOT found — check screenshot 13-s6-plan-selected.png');
    await dumpFull(page, 'After Plan — no Stripe form');
    await page.screenshot({ path: 'screenshots/13-s7-no-payment.png', fullPage: true });
  }
});
