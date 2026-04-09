import { test, expect, Locator } from '@playwright/test';
import { login } from './helpers';

test.setTimeout(120000);

const EVENT_EMAIL = process.env.LIFETECH_EVENT_EMAIL || '1144890814@qq.com';
const EVENT_PASSWORD = process.env.LIFETECH_EVENT_PASSWORD || '66666666';
const EVENT_DATE = process.env.LIFETECH_EVENT_DATE || '2026-04-30';

const S = {
  networkingBtn: 'button:has-text("Networking")',
  addEventBtn: 'button.btn-add, button:has-text("Add Event")',
  dialog: '.el-dialog',
  titleInput: 'input[placeholder="Enter event title"]',
  dateInput: 'input[placeholder="Pick a date"]',
  locationInput: 'input[placeholder="Enter location"]',
  descriptionInput: 'input[placeholder="Enter description"]',
  startInput: 'input[placeholder="Start"]',
  endInput: 'input[placeholder="End"]',
  createBtn: 'button.btn-submit, button:has-text("Create Event")',
  editBtn: '.edit-btn',
  removeBtn: '.remove-btn',
  confirmRemoveBtn: 'button:has-text("OK")',
  successToast: '.el-message__content',
  calendar: '.calendar-content',
};

async function selectFirstAttendee(page: Parameters<typeof login>[0]) {
  const attendeesSelect = page.locator(`${S.dialog} .el-select`).first();
  const attendeesInput = attendeesSelect.locator('input').first();

  const candidatesResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && response.url().includes('/api/calendar/attendees/candidates');
  }, { timeout: 10000 }).catch(() => null);

  await attendeesSelect.click();
  await attendeesInput.fill('a');
  await candidatesResponsePromise;
  await page.waitForTimeout(300);

  await attendeesInput.press('ArrowDown');
  await attendeesInput.press('Enter');

  const selectedTag = attendeesSelect.locator('.el-select__tags-text').first();
  await expect(selectedTag).toBeVisible({ timeout: 5000 });
  const selectedName = ((await selectedTag.textContent()) || '').trim();

  await page.keyboard.press('Escape').catch(() => {});
  await page.locator(S.dialog).click({ position: { x: 20, y: 20 } }).catch(() => {});
  await page.waitForTimeout(300);

  return selectedName;
}

async function maybeSelectEventType(page: Parameters<typeof login>[0]) {
  const eventTypeSelect = page.locator(`${S.dialog} .el-select`).nth(1);
  if (await eventTypeSelect.count() === 0) return '';

  await eventTypeSelect.click({ force: true });
  await page.waitForTimeout(300);

  const preferredOption = page.locator('.el-select-dropdown__item').filter({ hasText: /Others|Lark video meeting/i }).first();
  if (await preferredOption.count() === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    return '';
  }

  const optionText = ((await preferredOption.textContent()) || '').trim();
  await preferredOption.click({ force: true });
  await page.waitForTimeout(300);

  await page.keyboard.press('Escape').catch(() => {});
  await page.locator(S.dialog).click({ position: { x: 20, y: 20 } }).catch(() => {});
  await page.waitForTimeout(200);

  return optionText;
}

async function replaceFieldValue(locator: Locator, value: string) {
  await locator.click();
  await locator.press('Meta+A').catch(() => {});
  await locator.fill('');
  await locator.pressSequentially(value, { delay: 15 });
  await expect(locator).toHaveValue(value);
}

function calendarEventLocator(page: Parameters<typeof login>[0], title: string) {
  return page.locator(S.calendar).getByText(title, { exact: true }).first();
}

async function openCalendarEventByTitle(
  page: Parameters<typeof login>[0],
  eventId: number,
  title: string
) {
  const detailResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'GET'
      && response.url().endsWith(`/api/calendar/events/${eventId}`);
  }, { timeout: 15000 }).catch(() => null);

  const eventLocator = calendarEventLocator(page, title);
  await expect(eventLocator).toBeVisible({ timeout: 15000 });
  await eventLocator.click({ force: true });
  await detailResponsePromise;
  await expect(page.locator(S.editBtn).last()).toBeVisible({ timeout: 10000 });
}

test.describe('Networking', () => {
  test('create, edit, and remove an event from Networking', async ({ page }) => {
    const runId = Date.now();
    const eventTitle = `Auto Event ${runId}`;
    const editedTitle = `${eventTitle} Edited`;
    const location = 'Sydney Harbour';
    const editedLocation = 'Barangaroo';
    const description = 'Automated add-event smoke test';
    const editedDescription = 'Automated add-event edited smoke test';

    page.on('response', async (response) => {
      if (!response.url().includes('/api/')) return;
      if (!/(calendar|networking)/i.test(response.url())) return;
      console.log(`[API ${response.status()}] ${response.request().method()} ${response.url().replace('https://lifetech.star-x-tech.com', '')}`);
    });

    await login(page, EVENT_EMAIL, EVENT_PASSWORD);

    const calendarLoadPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET'
        && response.url().includes('/api/calendar/events?');
    }, { timeout: 15000 }).catch(() => null);

    await page.locator(S.networkingBtn).click();
    await page.waitForURL('**/networking', { timeout: 15000 });
    await calendarLoadPromise;
    await expect(page.locator(S.calendar)).toBeVisible({ timeout: 10000 });

    await page.locator(S.addEventBtn).first().click();
    await expect(page.locator(S.dialog)).toBeVisible({ timeout: 10000 });

    const startTime = await page.locator(S.startInput).inputValue();
    const endTime = await page.locator(S.endInput).inputValue();
    console.log(`[Add Event] default time range: ${startTime} -> ${endTime}`);

    await page.locator(S.titleInput).fill(eventTitle);
    await page.locator(S.dateInput).fill(EVENT_DATE);
    await page.locator(S.locationInput).fill(location);
    await page.locator(S.descriptionInput).fill(description);

    const selectedAttendee = await selectFirstAttendee(page);
    console.log(`[Add Event] attendee selected: ${selectedAttendee}`);

    const selectedEventType = await maybeSelectEventType(page);
    if (selectedEventType) {
      console.log(`[Add Event] event type selected: ${selectedEventType}`);
    }

    const createResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST'
        && response.url().includes('/api/calendar/events');
    }, { timeout: 15000 });

    const refreshResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET'
        && response.url().includes('/api/calendar/events?');
    }, { timeout: 15000 }).catch(() => null);

    await page.locator(S.createBtn).click({ force: true });

    const createResponse = await createResponsePromise;
    const createBody = await createResponse.json();
    const eventId = createBody.data.id as number;
    expect(createResponse.status()).toBe(201);
    expect(createBody.success).toBeTruthy();
    expect(createBody.data.summary).toBe(eventTitle);
    expect(createBody.data.startDate).toBe(EVENT_DATE);
    expect(createBody.data.location).toBe(location);
    expect(createBody.data.attendees?.length ?? 0).toBeGreaterThan(0);

    await refreshResponsePromise;
    await expect(page.locator(S.successToast).filter({ hasText: 'Event created successfully' }).last()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(S.dialog)).toBeHidden({ timeout: 10000 });

    const createdCalendarEvent = calendarEventLocator(page, eventTitle);
    await expect(createdCalendarEvent).toBeVisible({ timeout: 15000 });
    console.log(`[Add Event] created event: ${eventTitle} (#${eventId})`);

    await openCalendarEventByTitle(page, eventId, eventTitle);
    await page.locator(S.editBtn).last().click({ force: true });
    const editDialog = page.locator(S.dialog).filter({ hasText: 'Edit Event' }).last();
    await expect(editDialog).toBeVisible({ timeout: 10000 });

    await replaceFieldValue(editDialog.locator(S.titleInput), editedTitle);
    await replaceFieldValue(editDialog.locator(S.locationInput), editedLocation);
    await replaceFieldValue(editDialog.locator(S.descriptionInput), editedDescription);

    const editResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'PUT'
        && response.url().endsWith(`/api/calendar/events/${eventId}`);
    }, { timeout: 15000 });

    const editRefreshPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET'
        && response.url().includes('/api/calendar/events?');
    }, { timeout: 15000 }).catch(() => null);

    await editDialog.locator('button.btn-submit, button:has-text("Edit Event")').last().click({ force: true });

    const editResponse = await editResponsePromise;
    const editBody = await editResponse.json();
    expect(editResponse.status()).toBe(200);
    expect(editBody.success).toBeTruthy();
    expect(editBody.data.id).toBe(eventId);
    expect(editBody.data.summary).toBe(editedTitle);
    expect(editBody.data.location).toBe(editedLocation);

    await editRefreshPromise;
    await expect(page.locator(S.successToast).filter({ hasText: 'Event updated successfully' }).last()).toBeVisible({ timeout: 10000 });

    const editedCalendarEvent = calendarEventLocator(page, editedTitle);
    await expect(editedCalendarEvent).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      return await calendarEventLocator(page, eventTitle).count();
    }, { timeout: 15000 }).toBe(0);

    await openCalendarEventByTitle(page, eventId, editedTitle);
    await page.locator(S.removeBtn).last().click({ force: true });
    await expect(page.getByText('Are you sure to remove this event?', { exact: false })).toBeVisible({ timeout: 10000 });

    const deleteResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'DELETE'
        && response.url().endsWith(`/api/calendar/events/${eventId}`);
    }, { timeout: 15000 });

    const deleteRefreshPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET'
        && response.url().includes('/api/calendar/events?');
    }, { timeout: 15000 }).catch(() => null);

    await page.locator(S.confirmRemoveBtn).last().click({ force: true });

    const deleteResponse = await deleteResponsePromise;
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status()).toBe(200);
    expect(deleteBody.success).toBeTruthy();
    expect(deleteBody.message).toBe('Event removed');

    const deleteRefresh = await deleteRefreshPromise;
    if (deleteRefresh) {
      const deleteRefreshBody = await deleteRefresh.json().catch(() => null);
      if (deleteRefreshBody?.data) {
        const removedStillPresent = deleteRefreshBody.data.some((event: { id: number; summary: string }) => {
          return event.id === eventId || event.summary === editedTitle;
        });
        expect(removedStillPresent).toBeFalsy();
      }
    }

    await expect.poll(async () => {
      return await calendarEventLocator(page, editedTitle).count();
    }, { timeout: 15000 }).toBe(0);

    console.log(`[Add Event] removed event: ${editedTitle} (#${eventId})`);
  });
});
