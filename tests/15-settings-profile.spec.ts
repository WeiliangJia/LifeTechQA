import path from 'node:path';
import { expect, Page, test } from '@playwright/test';
import { login } from './helpers';

test.setTimeout(240000);

const SETTINGS_USER = {
  email: process.env.LIFETECH_SETTINGS_EMAIL ?? '1144890814@qq.com',
  password: process.env.LIFETECH_SETTINGS_PASSWORD ?? '66666666',
  newPassword: process.env.LIFETECH_SETTINGS_NEW_PASSWORD ?? '66666666',
};

const TITLE_OPTIONS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof'];
const UPLOAD_FILE = path.resolve(process.cwd(), 'tests/assets/settings-upload.jpg');
const UPLOAD_FILE_NAME = path.basename(UPLOAD_FILE);

const S = {
  settingsTitle: 'h1.settings-title',
  editButton: 'button:has-text("Edit")',
  saveButton: 'button.save-button, button:has-text("Save Changes")',
  titleFormItem: '.el-form-item',
  titleSelect: '.el-select',
  titleOptions: '.el-select-dropdown__item',
  firstName: 'input[placeholder="First Name"]',
  lastName: 'input[placeholder="Last Name"]',
  addressLine: 'input[placeholder="Address Line"]',
  city: 'input[placeholder="City"]',
  state: 'input[placeholder="State"]',
  postcode: 'input[placeholder="Postcode"]',
  mobilePhone: 'input[placeholder="Mobile Phone"]',
  newPassword: 'input[placeholder="Enter new password"]',
  repeatPassword: 'input[placeholder="Repeat new password"]',
  uploadInput: 'input[type="file"]',
  successToast: '.el-message__content',
  documentItem: '.document-item',
  documentTitle: '.document-title',
  deleteButton: 'button.delete-button',
  confirmModal: '.confirm-modal',
  confirmDeleteButton: 'button.confirm-button, button:has-text("Delete")',
};

type ProfileSnapshot = {
  title: string;
  firstName: string;
  lastName: string;
  addressLine: string;
  city: string;
  state: string;
  postcode: string;
  mobilePhone: string;
};

function successToast(page: Page) {
  return page.locator(S.successToast)
    .filter({ hasText: 'Personal information updated successfully' })
    .last();
}

function titleFormItem(page: Page) {
  return page.locator(S.titleFormItem)
    .filter({ has: page.locator('label', { hasText: 'Title' }) })
    .first();
}

function documentItem(page: Page, fileName: string) {
  return page.locator(S.documentItem)
    .filter({ has: page.locator(S.documentTitle, { hasText: new RegExp(`^${escapeRegExp(fileName)}$`) }) })
    .first();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openSettings(page: Page) {
  if (page.url().endsWith('/settings')) {
    await expect(page.locator(S.settingsTitle)).toHaveText('Settings');
    return;
  }

  const settingsIcon = page.locator('button.icon-button:visible').nth(1);
  if (await settingsIcon.count()) {
    await settingsIcon.click();
  } else {
    await page.goto('/settings');
  }

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator(S.settingsTitle)).toHaveText('Settings');
}

async function enableEditing(page: Page) {
  const firstName = page.locator(S.firstName);
  if (await firstName.isDisabled()) {
    await page.locator(S.editButton).click();
    await expect(firstName).toBeEnabled();
    await expect(page.locator(S.saveButton)).toBeVisible();
  }
}

async function currentTitle(page: Page) {
  const raw = (await titleFormItem(page).textContent()) ?? '';
  return raw.replace(/\s+/g, ' ').replace(/^Title\s*/, '').trim();
}

async function readProfile(page: Page): Promise<ProfileSnapshot> {
  return {
    title: await currentTitle(page),
    firstName: await page.locator(S.firstName).inputValue(),
    lastName: await page.locator(S.lastName).inputValue(),
    addressLine: await page.locator(S.addressLine).inputValue(),
    city: await page.locator(S.city).inputValue(),
    state: await page.locator(S.state).inputValue(),
    postcode: await page.locator(S.postcode).inputValue(),
    mobilePhone: await page.locator(S.mobilePhone).inputValue(),
  };
}

async function setTitle(page: Page, title: string) {
  if ((await currentTitle(page)) === title) return;

  await titleFormItem(page).locator(S.titleSelect).click({ force: true });

  const option = page.locator(S.titleOptions)
    .filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) })
    .first();

  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
  await expect.poll(async () => currentTitle(page)).toBe(title);
}

async function waitForProfileUpdate(page: Page) {
  return page.waitForResponse(
    response => {
      const pathname = new URL(response.url()).pathname;
      return /\/api\/user\/\d+$/.test(pathname) && response.request().method() !== 'GET';
    },
    { timeout: 20000 }
  );
}

async function waitForPasswordReset(page: Page) {
  return page.waitForResponse(
    response => response.url().includes('/api/user/settings/resetpassword'),
    { timeout: 20000 }
  );
}

async function waitForDocumentUpload(page: Page) {
  return page.waitForResponse(
    response => response.url().includes('/api/user/document/upload')
      && response.request().method() === 'POST',
    { timeout: 20000 }
  );
}

async function uploadDocument(page: Page, filePath: string, fileName: string) {
  const uploadResponsePromise = waitForDocumentUpload(page);
  await page.locator(S.uploadInput).setInputFiles(filePath);

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(200);

  const uploadBody = await uploadResponse.json();
  expect(uploadBody.success).toBe(true);
  expect(uploadBody.message).toContain('uploaded successfully');
  expect(uploadBody.data.documents.some((doc: { fileName: string }) => doc.fileName === fileName)).toBe(true);

  await expect(documentItem(page, fileName)).toBeVisible({ timeout: 10000 });
}

function buildEditedProfile(original: ProfileSnapshot): ProfileSnapshot {
  const editedTitle = TITLE_OPTIONS.find(option => option !== original.title) ?? 'Ms';
  const editedPhone = original.mobilePhone.endsWith('8')
    ? `${original.mobilePhone.slice(0, -1)}7`
    : `${original.mobilePhone.slice(0, -1)}8`;

  return {
    title: editedTitle,
    firstName: `${original.firstName}QA`,
    lastName: `${original.lastName}QA`,
    addressLine: `${original.addressLine} QA`,
    city: `${original.city} QA`,
    state: original.state === 'NSW' ? 'VIC' : 'NSW',
    postcode: original.postcode === '5000' ? '5001' : '5000',
    mobilePhone: editedPhone,
  };
}

async function fillProfile(page: Page, profile: ProfileSnapshot) {
  await setTitle(page, profile.title);
  await page.locator(S.firstName).fill(profile.firstName);
  await page.locator(S.lastName).fill(profile.lastName);
  await page.locator(S.addressLine).fill(profile.addressLine);
  await page.locator(S.city).fill(profile.city);
  await page.locator(S.state).fill(profile.state);
  await page.locator(S.postcode).fill(profile.postcode);
  await page.locator(S.mobilePhone).fill(profile.mobilePhone);
}

test.describe('Settings / Personal Information', () => {
  test('edit original personal info, upload jpg, and save with the same password', async ({ page }) => {
    await login(page, SETTINGS_USER.email, SETTINGS_USER.password);
    await openSettings(page);
    await enableEditing(page);

    const originalProfile = await readProfile(page);
    const editedProfile = buildEditedProfile(originalProfile);
    await fillProfile(page, editedProfile);
    await uploadDocument(page, UPLOAD_FILE, UPLOAD_FILE_NAME);

    const profileUpdatePromise = waitForProfileUpdate(page);
    const passwordResetPromise = waitForPasswordReset(page);

    await page.locator(S.newPassword).fill(SETTINGS_USER.newPassword);
    await page.locator(S.repeatPassword).fill(SETTINGS_USER.newPassword);
    await page.locator(S.saveButton).click();

    const [profileUpdate, passwordReset] = await Promise.all([
      profileUpdatePromise,
      passwordResetPromise,
    ]);

    expect(profileUpdate.status()).toBe(200);
    expect(passwordReset.status()).toBe(200);

    const profileBody = await profileUpdate.json();
    const passwordBody = await passwordReset.json();

    expect(profileBody.success).toBe(true);
    expect(profileBody.message).toBe('User has been updated successfully');
    expect(profileBody.data.title).toBe(editedProfile.title);
    expect(profileBody.data.firstName).toBe(editedProfile.firstName);
    expect(profileBody.data.lastName).toBe(editedProfile.lastName);
    expect(profileBody.data.address.street).toBe(editedProfile.addressLine);
    expect(profileBody.data.address.city).toBe(editedProfile.city);
    expect(profileBody.data.address.state).toBe(editedProfile.state);
    expect(profileBody.data.address.postcode).toBe(editedProfile.postcode);
    expect(profileBody.data.phone).toBe(editedProfile.mobilePhone);

    expect(passwordBody.success).toBe(true);
    expect(passwordBody.message).toContain('Password reset successfully');

    await expect(successToast(page)).toBeVisible({ timeout: 10000 });
    expect(await readProfile(page)).toEqual(editedProfile);
    await expect(documentItem(page, UPLOAD_FILE_NAME)).toBeVisible();
  });
});
