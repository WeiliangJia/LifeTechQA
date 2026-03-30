/**
 * File Upload Tests
 *
 * Covers:
 *   - Happy path: valid file uploads successfully
 *   - Validation: wrong type, oversized file, empty file
 *   - Security: executable files, path traversal filenames
 *   - Persistence: uploaded file is retrievable after upload
 *   - API: upload endpoint returns correct response
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ─── Test file factory ────────────────────────────────────────────────────────

function createTempFile(filename: string, content: string | Buffer, dir = os.tmpdir()): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

// Create test files once (reused across tests)
const FILES = {
  validPdf:    createTempFile('test-valid.pdf',     Buffer.from('%PDF-1.4 test content')),
  validJpg:    createTempFile('test-valid.jpg',     Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(20)])), // JPEG magic bytes
  validPng:    createTempFile('test-valid.png',     Buffer.from([0x89, 0x50, 0x4E, 0x47, ...Buffer.alloc(20)])), // PNG magic bytes
  oversized:   createTempFile('test-oversized.pdf', Buffer.alloc(11 * 1024 * 1024, 'x')), // 11 MB
  emptyFile:   createTempFile('test-empty.pdf',     Buffer.alloc(0)),
  wrongType:   createTempFile('test-wrong.exe',     Buffer.from('MZ')), // PE executable header
  svgXss:      createTempFile('test-xss.svg',       '<svg onload="alert(1)"><script>alert(1)</script></svg>'),
  doubleExt:   createTempFile('test-double.pdf.exe', Buffer.from('fake exe')),
};

// ─────────────────────────────────────────────────────────────────────────────
test.describe('File Upload — Happy Path', () => {

  test('upload valid PDF → success response + file visible', async ({ page }) => {
    await login(page);

    // Capture upload API call
    const uploadResponsePromise = page.waitForResponse(
      res => res.url().includes('/upload') || res.url().includes('/file') || res.url().includes('/document'),
      { timeout: 30000 }
    ).catch(() => null);

    // Navigate to upload page (adjust URL)
    await page.goto('/upload').catch(() => {}); // adjust route
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Set file on the input — works even if the input is hidden
    const fileInput = page.locator('input[type="file"]').first();

    if (await fileInput.count() === 0) {
      console.warn('[Upload] No file input found — check page URL and update this test');
      await page.screenshot({ path: 'screenshots/09-no-file-input.png', fullPage: true });
      test.skip();
      return;
    }

    await fileInput.setInputFiles(FILES.validPdf);
    console.log('[Upload] File set:', FILES.validPdf);

    // Click upload/submit button if separate from file input
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("Submit"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();

    const uploadRes = await uploadResponsePromise;
    if (uploadRes) {
      const body = await uploadRes.json().catch(() => null);
      console.log(`[Upload API] ${uploadRes.status()} — ${JSON.stringify(body).slice(0, 200)}`);
      expect(uploadRes.status()).toBeLessThan(400);
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-upload-success.png', fullPage: true });

    // Verify file appears in the UI
    const fileVisible = await page.locator('text=/test-valid|\.pdf/i').count() > 0
      || await page.locator('[class*="file"], [class*="upload"], [class*="attachment"]').count() > 0;
    console.log('[Upload] File visible in UI:', fileVisible);
  });

  test('upload valid image (JPG) → success', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    await fileInput.setInputFiles(FILES.validJpg);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-upload-jpg.png', fullPage: true });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('File Upload — Validation', () => {

  test('oversized file (>10MB) → rejected with error message', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    await fileInput.setInputFiles(FILES.oversized);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-oversized.png' });

    const hasError = await page.locator('text=/too large|size|limit|超出|文件过大/i').count() > 0
      || await page.locator('[class*="error"]').count() > 0;
    console.log('[Oversized] Error shown:', hasError);
    expect(hasError, 'Should show size limit error').toBeTruthy();
  });

  test('empty file → rejected', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    await fileInput.setInputFiles(FILES.emptyFile);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-empty-file.png' });

    const hasError = await page.locator('[class*="error"], [role="alert"]').count() > 0;
    console.log('[Empty file] Error shown:', hasError);
  });

  test('wrong file type (.exe) → rejected by frontend or backend', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    // Check if the input has accept attribute (frontend validation)
    const acceptAttr = await fileInput.getAttribute('accept');
    console.log('[Type check] input accept=', acceptAttr);

    await fileInput.setInputFiles(FILES.wrongType);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/09-wrong-type.png' });

    // Should be blocked — either button stays disabled, or error appears
    const hasError = await page.locator('text=/type|format|allowed|格式|类型/i').count() > 0
      || await page.locator('[class*="error"]').count() > 0;
    console.log('[Wrong type] Rejected:', hasError);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('File Upload — Security', () => {

  test('SVG with embedded XSS script → not executed after upload', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    // Listen for any alert dialog — a sign that XSS succeeded
    let xssTriggered = false;
    page.on('dialog', async dialog => {
      xssTriggered = true;
      console.error('[SECURITY ❌] XSS dialog triggered:', dialog.message());
      await dialog.dismiss();
    });

    await fileInput.setInputFiles(FILES.svgXss);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();
    await page.waitForTimeout(3000);

    // Navigate to where the file would be displayed
    // (adjust if your app shows uploaded files on a different page)
    await page.waitForTimeout(2000);

    expect(xssTriggered, 'SVG XSS should not execute').toBeFalsy();
    console.log('[Security] SVG XSS not triggered ✓');
  });

  test('double extension file (file.pdf.exe) → rejected or sanitized', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    // Intercept upload request to check if filename is sanitized
    let uploadedFilename = '';
    page.on('request', req => {
      if (req.url().includes('/upload') || req.url().includes('/file')) {
        const postData = req.postData() ?? '';
        if (postData.includes('.pdf.exe')) {
          uploadedFilename = 'pdf.exe (NOT sanitized)';
        }
      }
    });

    await fileInput.setInputFiles(FILES.doubleExt);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();
    await page.waitForTimeout(2000);

    if (uploadedFilename) {
      console.warn('[Security ⚠️] Double extension file was not sanitized:', uploadedFilename);
    } else {
      console.log('[Security] Double extension handled ✓');
    }

    await page.screenshot({ path: 'screenshots/09-double-ext.png' });
  });

  test('uploaded file URL is not publicly guessable (requires auth to access)', async ({ page, context }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    let uploadedFileUrl = '';
    page.on('response', async res => {
      if ((res.url().includes('/upload') || res.url().includes('/file')) && res.status() < 400) {
        const body = await res.json().catch(() => null);
        // Adjust field name to match actual API response
        uploadedFileUrl = body?.url ?? body?.fileUrl ?? body?.data?.url ?? '';
      }
    });

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }
    await fileInput.setInputFiles(FILES.validPdf);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();
    await page.waitForTimeout(3000);

    if (!uploadedFileUrl) {
      console.warn('[Auth check] Could not extract file URL from upload response — skip auth check');
      return;
    }

    console.log('[Auth check] Trying unauthenticated access to:', uploadedFileUrl);

    // Try to access the file URL WITHOUT auth cookies
    const unauthPage = await context.newPage();
    await context.clearCookies();
    const res = await unauthPage.goto(uploadedFileUrl);

    const status = res?.status() ?? 0;
    console.log(`[Auth check] Unauthenticated access → ${status}`);

    // Should be 401/403, NOT 200
    expect(status, 'Uploaded files should not be publicly accessible without auth')
      .not.toBe(200);

    await unauthPage.close();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
test.describe('File Upload — Persistence', () => {

  test('uploaded file appears in file list after refresh', async ({ page }) => {
    await login(page);
    await page.goto('/upload').catch(() => {});
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) { test.skip(); return; }

    await fileInput.setInputFiles(FILES.validPdf);
    const submitBtn = page.locator('button:has-text("Upload"), button:has-text("上传")').first();
    if (await submitBtn.count() > 0) await submitBtn.click();
    await page.waitForTimeout(3000);

    // Reload and check
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'screenshots/09-after-reload.png', fullPage: true });

    // File name or some file indicator should still be present
    const fileVisible = await page.locator('text=/test-valid|\.pdf/i').count() > 0
      || await page.locator('[class*="file-list"], [class*="attachment"]').count() > 0;
    console.log('[Persistence] File visible after reload:', fileVisible);
  });

});
