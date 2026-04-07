import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: [
    // DOM exploration scripts (not real tests)
    '**/*explore*',
    // Scheduled payment — not yet implemented
    '**/07-scheduled-payment.spec.ts',
    '**/16-scheduled-payment-probe.spec.ts',
    // Early drafts — not validated against real app state
    '**/00-selector-health.spec.ts',   // needs login + open payment dialog first
    '**/03-api-monitoring.spec.ts',    // pre-auth endpoint not triggered by current flow
    '**/06-error-handling.spec.ts',    // Stripe iframe not present without entity setup
    '**/08-form-persistence.spec.ts',  // El-Plus inputs not detectable as standard form values
    '**/10-visual-regression.spec.ts', // baseline screenshots outdated (21% pixel diff)
  ],
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false, // payment tests must run sequentially
  retries: 1,
  reporter: [
    ['html',  { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
    // Uncomment for CI (GitHub Actions / Jenkins):
    // ['junit', { outputFile: 'test-results/results.xml' }],
  ],
  use: {
    baseURL:    'https://lifetech.star-x-tech.com',
    // On failure: full trace (network + DOM snapshots + video) for diagnosis
    trace:      'on-first-retry',   // open with: npx playwright show-trace trace.zip
    screenshot: 'only-on-failure',  // auto-saved to test-results/
    video:      'retain-on-failure',
    headless:   process.env.CI === 'true' || process.env.HEADLESS === 'true',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
