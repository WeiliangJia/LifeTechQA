# Payment Testing Playbook
## LifeTech / Star-X — Playwright + Stripe E2E

> 本文档总结了从零搭建支付测试过程中所有踩过的坑和确认有效的策略。
> 新成员接手测试时，从第 0 步开始照做即可。

---

## 核心原则

1. **先探索，后硬编码** — 跑 `05-explore-page.spec.ts`，看真实 DOM，再写选择器
2. **选择器集中管理** — 所有选择器只写在 `helpers.ts` 的 `SEL` 对象里，改一处全生效
3. **测试不改真实数据** — 用 `page.route()` mock 状态，不依赖账号的一次性状态
4. **失败先看原因，别乱改** — 超时 ≠ 选择器错，可能是时序/状态/API 用法问题

---

## 已确认的精确选择器（2026-03-29 DOM 快照）

```ts
// 登录页
input[placeholder="Mobile Number/Email"]
input[type="password"]
button:has-text("Continue")          // disabled when empty — don't try to click when empty

// 支付页 — Stripe iframes（由 Stripe SDK 控制，基本不会变）
iframe[title="Secure card number input frame"]     → input[name="cardnumber"]
iframe[title="Secure expiration date input frame"] → input[name="exp-date"]
iframe[title="Secure CVC input frame"]             → input[name="cvc"]

// 支付页 — 主框架
input[placeholder="Name on card"]
button.submit-button                 // text: "Complete Payment"
```

---

## 已确认的 API 端点

```
POST /api/auth/loginbyemail          → { success, token, userId }
GET  /api/auth/me                    → { subject, expiresAt, claims }
GET  /api/user/user/:id              → { data: { id, email, firstName, ... } }
GET  /api/payments/registration/status → { data: true/false }
GET  /api/payments/cards/pre-auth    → { data: { publicKey } }
```

---

## Stripe 必知陷阱

### 1. 必须用 `pressSequentially`，不能用 `fill`

```ts
// ❌ fill() 绕过 Stripe 键盘事件，Stripe 认为字段是空的
await input.fill('4242424242424242');

// ✅ 模拟真实按键，Stripe 能正确感知
await input.pressSequentially('4242424242424242', { delay: 30 });
```

### 2. 不能用 `waitForLoadState('networkidle')`

Stripe 保持长连接（WebSocket + 轮询），`networkidle` 永远等不到。

```ts
// ❌ 超时
await page.waitForLoadState('networkidle');

// ✅ 等已知元素出现
await page.waitForSelector('iframe[title="Secure card number input frame"]');
await page.waitForTimeout(1500);
```

### 3. `waitForResponse` 必须在操作之前注册

```ts
// ❌ 可能错过响应
await page.click('button');
const res = await page.waitForResponse('**/api/login'); // 太晚了

// ✅ 先挂监听，再触发
const resPromise = page.waitForResponse('**/api/login');
await page.click('button');
const res = await resPromise;
```

### 4. Stripe iframe 内的 input 是异步注入的

页面加载完 1-3 秒后 Stripe JS 才把 input 注入 iframe，操作前必须 `waitFor`。

```ts
await numberInput.waitFor({ timeout: 15000 });
await numberInput.click();   // 先 click 激活，再 pressSequentially
await numberInput.pressSequentially('4242424242424242', { delay: 30 });
```

---

## 测试状态隔离

### 问题：每个账号只能注册一次支付

成功注册后，app 登录直接跳 `/entities`，支付页面不再出现，后续测试全挂。

### 解决：mock 注册状态接口

```ts
// 在 beforeEach 里，login() 之前调用
await page.route('**/api/payments/registration/status', route => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: false }), // false = 未注册
  });
});
```

这样每次测试都像第一次注册，不依赖账号状态。

---

## Stripe 测试卡

| 卡号 | 场景 |
|------|------|
| `4242 4242 4242 4242` | 成功 ✅ |
| `4000 0000 0000 0002` | 卡被拒绝 ❌ |
| `4000 0000 0000 9995` | 余额不足 ❌ |
| `4000 0000 0000 0069` | 卡已过期 ❌ |
| `4000 0025 0000 3155` | 需要 3DS → 完成 → 成功 |
| `4000 0000 0000 0341` | 需要 3DS → 失败 → 拒绝 |

有效期：任意未来日期。CVC：任意 3 位数字。

---

## 测试类型全览

### E2E（必测）
- [ ] 正常支付流程 → 成功
- [ ] 各类拒绝卡 → 显示对应错误（不能显示 500）
- [ ] 3DS 卡 → 弹出 Modal → Complete/Fail 两种路径
- [ ] 空表单提交 → 按钮 disabled（本项目设计）
- [ ] 模拟 500 错误 → 友好提示，不显示 JS 报错
- [ ] 模拟网络中断 → 不显示空白页

### API 合约（必测）
- [ ] 登录接口返回 token + userId
- [ ] 注册状态接口返回正确 shape
- [ ] 所有接口响应 < 5s
- [ ] 卡号/CVC 不出现在任何 API 响应 body 里

### 表单持久化
- [ ] 导航离开再回来 → 已填数据仍显示
- [ ] API 返回值与表单显示值一致（防止前端绑定 bug）

### 选择器健康检查（每次部署后跑）
```bash
npx playwright test tests/00-selector-health.spec.ts
```

---

## 月度定时扣款测试

按优先级选一种：

**方案 A — Stripe Test Clock**（最准确）
1. 向后端团队索取 `sk_test_xxx`（Stripe test secret key）
2. 运行：
```bash
STRIPE_TEST_SECRET_KEY=sk_test_xxx npx playwright test tests/07-scheduled-payment.spec.ts
```

**方案 B — 后端 trigger 接口**
问后端团队：有没有 `POST /api/payments/trigger-monthly` 之类的调试接口？

**方案 C — Stripe CLI**
```bash
stripe listen --forward-to localhost:3000/api/payments/webhook
stripe trigger invoice.payment_succeeded
```

---

## 故障排查速查表

| 报错症状 | 真正原因 | 正确处理 |
|---------|---------|---------|
| `element is not enabled`（按钮） | 按钮是 `disabled` 状态，这是正确行为 | 改断言为 `expect(btn).toBeDisabled()` |
| `networkidle` 超时 | Stripe 长连接 | 改用 `domcontentloaded` + `waitForSelector` |
| iframe input not found，页面在 `/entities` | 支付已注册，app 重定向了 | `beforeEach` 加 `mockAsUnregistered()` |
| `browser has been closed` | `waitForResponse` 在操作后注册 | 先注册监听再触发操作 |
| 卡填了但表单仍视为空 | 用了 `fill()` 填 Stripe input | 改为 `pressSequentially()` |
| 第二次跑全挂 | 测试状态污染（真实支付已注册） | 用 `page.route()` mock 状态接口 |
| 选择器失效 | 前端迭代改了文字/class | 跑 `00-selector-health` 定位，改 `SEL` 对应行 |
| El-Plus 下拉 `waitForSelector` 5s 超时 | El-Plus 用 opacity/transform 动画，items 在 DOM 但 Playwright 判定"不可见" | 改用 `page.evaluate()` + `getBoundingClientRect()` 点击（见下方） |
| 下拉选项列表为空 / 国家列表不出现 | mock pattern 太宽，拦截了下拉数据接口 | mock 要用精确路径，不要用 `register*` 这类通配符 |
| Attempt 2 支付 `locator.click` 永久等待 | 第一次失败后出现错误弹窗，遮挡了提交按钮 | 在 Attempt 2 前先 click `button.dialog-button` 关闭弹窗 |
| `Email already exists` / `Phone already exists` | 固定测试数据在数据库中已存在 | 用 `Date.now()` 生成每次唯一的邮箱和手机号 |
| OTP 输入框未找到 | 选择器用了 placeholder，实际是 `input.code-input`（6 个独立单字符输入框） | `dumpSnapshot` 确认 class；用 loop 逐格填写 |

---

---

## El-Plus / Vue 3 组件专项陷阱（2026-03-30 确认）

### 1. El-Plus Select 下拉框：`waitForSelector` 永远超时

El-Plus 把下拉列表 portal 到 `<body>`，关闭后 items 仍在 DOM（不删除，只用 opacity/transform 隐藏）。Playwright 的 `visible` 状态检查在动画期间失败，即使 `offsetParent !== null` 也如此。

```ts
// ❌ 超时 — items 在 DOM 但 Playwright 认为"不可见"
await page.waitForSelector('.el-select-dropdown__item:not(.is-disabled)');

// ✅ 用 JS getBoundingClientRect 判断真实渲染，绕过 Playwright 可见性检查
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
    rendered[0].click();  // JS 直接点击，不经过 Playwright
    return text;
  }
  return null;
});
console.log(`Selected: ${optText}`);
```

**多个下拉框时**：每次选择后等 600ms，让 Vue 响应式更新完成。不要在循环里按 `Escape`（会干扰表单状态）。

### 2. OTP 分格输入框

新版注册页常用 6 个独立 `input.code-input`，无 placeholder、无 name。检测方式和填写方式：

```ts
const otpInputs = page.locator('input.code-input');
const count = await otpInputs.count();  // 确认是 6
const code = '123456';
for (let i = 0; i < count; i++) {
  await otpInputs.nth(i).fill(code[i]);
}
// 验证按钮通常是 button.verify-btn，disabled 直到 6 格全填
```

### 3. Mock pattern 精确性原则

```ts
// ❌ 太宽 — 拦截了 /api/auth/register-countries 等数据接口
await page.route('**/api/auth/register*', ...);

// ✅ 精确到具体端点
await page.route('**/api/auth/registeruserbyemail*', ...);
await page.route('**/api/auth/verify**', ...);
```

**经验法则**：写完 mock 后，在 `page.on('response')` 日志里确认：有没有本不该被 mock 的接口返回了假数据？

### 4. 支付失败后的错误弹窗

第一次支付失败（如 0341 卡被拒）后，app 通常显示错误对话框（`button.dialog-button`，文字 "Try Again"）。这个弹窗浮在表单上方，导致 Attempt 2 的 `submit-button.click()` 永久阻塞。

```ts
// Attempt 1 结束后，Attempt 2 开始前：
const tryAgainBtn = page.locator('button.dialog-button');
if (await tryAgainBtn.count() > 0) {
  await tryAgainBtn.click();
  console.log('[Dialog] Dismissed "Try Again" dialog');
  await page.waitForTimeout(1000);
}
```

### 5. 测试数据唯一性

数据库对 email / phone 有唯一约束，固定值在第二次跑就会报 `already exists`。

```ts
const RUN_ID     = Date.now();
const TEST_EMAIL = `autotest+${RUN_ID}@mailtest.com`;
const TEST_PHONE = `4${String(RUN_ID).slice(-8)}`; // 9 位，以 4 开头
// OTP 被 mock，邮箱和手机号不需要真实存在
```

---

## 新模块上手流程（5 步）

```bash
# 1. 探索页面 DOM
npx playwright test tests/05-explore-page.spec.ts --headed

# 2. 根据输出更新 tests/helpers.ts 里的 SEL 对象

# 3. 验证选择器
npx playwright test tests/00-selector-health.spec.ts --headed

# 4. 跑完整测试
npx playwright test --ignore=tests/05-explore-page.spec.ts --headed

# 5. 看报告
npx playwright show-report
```

---

## 前端更新后要做什么

| 改动类型 | 处理方式 |
|---------|---------|
| 按钮文字改了 | 跑 `00-selector-health`，改 `SEL` 1 行 |
| 新增/删除表单字段 | 跑 `05-explore-page`，更新 `SEL` 和断言 |
| CSS class 重构 | 不影响（我们不用 class 选择器） |
| API 路径改了 | `00-selector-health` 会报警，更新 `03-api-monitoring.spec.ts` |
| Stripe SDK 升级 | iframe title 极少变，`00-selector-health` 检测 |
| 页面路由改了 | 改 `helpers.ts` 里 `page.goto()` 的路径 |
