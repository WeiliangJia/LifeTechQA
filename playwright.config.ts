import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
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
