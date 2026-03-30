# LifeTech Payment Test Suite

Playwright 自动化测试套件，针对 https://lifetech.star-x-tech.com 的登录和支付流程。

## 快速开始

```bash
# 安装依赖（含 Playwright 浏览器）
npm install
npx playwright install chromium

# 第一步：先运行 Explorer 了解页面结构
npx playwright test tests/05-explore-page.spec.ts --headed

# 查看 screenshots/ 目录中的截图，根据实际页面更新 tests/helpers.ts 中的选择器

# 运行全套测试
npm test

# 带浏览器界面运行（方便调试）
npm run test:headed

# 查看 HTML 测试报告
npm run test:report
```

## 测试文件说明

| 文件 | 内容 |
|------|------|
| `01-login.spec.ts` | 登录功能：正确/错误密码、空表单验证 |
| `02-payment-form.spec.ts` | 支付表单：成功支付、各种卡错误场景 |
| `03-api-monitoring.spec.ts` | 微服务监控：记录所有 API 调用、安全检查、性能检查 |
| `04-edge-cases.spec.ts` | 边界：HTTPS、控制台错误、Session、重复提交、未登录访问 |
| `05-explore-page.spec.ts` | 页面探索：输出实际选择器，帮助校准其他测试 |

## 测试卡

| 卡号 | 场景 |
|------|------|
| `4242 4242 4242 4242` | 成功支付 ✅ |
| `4000 0000 0000 0002` | 卡被拒绝 ❌ |
| `4000 0000 0000 9995` | 余额不足 ❌ |
| `4000 0000 0000 0069` | 卡已过期 ❌ |
| `4000 0025 0000 3155` | 需要 3DS 验证 |

## 选择器适配

如果测试找不到元素，先运行 `05-explore-page.spec.ts` 查看实际 DOM 结构，
然后更新 `tests/helpers.ts` 中的 `login()` 和 `fillCard()` 函数的选择器。
