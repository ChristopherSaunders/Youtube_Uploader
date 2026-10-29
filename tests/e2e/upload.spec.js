import { test, expect } from '@playwright/test';
import {
  MB,
  connectChannel,
  fillUploadForm,
  historyRow,
  resetFakes,
  setGoogle,
  sha256,
  tinyPng,
  videoFile,
  youtubeReceived,
} from './helpers.js';

test.beforeEach(async ({ page, request }) => {
  await resetFakes(request);
  await connectChannel(page);
});

test('uploads a video with its details and thumbnail', async ({ page, request }) => {
  const file = await fillUploadForm(page);
  await expect(page.getByLabel('Title')).toHaveValue('Episode 42'); // pre-filled from the file name

  await page.getByLabel('Title').fill('Episode 42: The Fence Debate');
  await page.getByLabel('Description').fill('We talk about fences.');
  await page.getByLabel('Tags').fill('podcast, comedy');
  await page.getByLabel('Category').selectOption({ label: 'Entertainment' });
  await page.getByLabel('Visibility').selectOption('unlisted');
  await page.getByLabel('Notify subscribers').uncheck();
  await page.locator('#thumbnail').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.locator('#thumb-preview')).toBeVisible();

  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#result-text')).toHaveText('Uploaded! YouTube is now processing your video.');
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('href', 'https://youtu.be/video1');
  await expect(page.getByRole('link', { name: 'Edit in YouTube Studio' })).toHaveAttribute(
    'href',
    'https://studio.youtube.com/video/video1/edit',
  );
  await expect(historyRow(page, 'Episode 42: The Fence Debate').locator('.status')).toHaveText('Uploaded');

  const { uploads, thumbnails } = await youtubeReceived(request);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatchObject({
    title: 'Episode 42: The Fence Debate',
    description: 'We talk about fences.',
    tags: ['podcast', 'comedy'],
    categoryId: '24',
    privacyStatus: 'unlisted',
    publishAt: null,
    madeForKids: false,
    notifySubscribers: false,
    mimeType: 'video/mp4',
    bytes: file.buffer.length,
    sha256: sha256(file.buffer),
  });
  expect(thumbnails).toEqual([{ videoId: 'video1', mimeType: 'image/png', bytes: tinyPng.length }]);

  // "Upload another" brings back a clean form.
  await page.getByRole('button', { name: 'Upload another' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('');
  await expect(page.locator('#thumb-preview')).toBeHidden();
});

test('requires an answer to "made for kids"', async ({ page, request }) => {
  await fillUploadForm(page, { madeForKids: null });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();
  await expect(page.locator('#flash')).toContainText('made for kids');
  expect((await youtubeReceived(request)).uploads).toHaveLength(0);
});

test('requires a title', async ({ page }) => {
  await fillUploadForm(page, { title: '' });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();
  await expect(page.locator('#flash')).toHaveText('Add a title.');
});

test('rejects thumbnails over 2 MB before uploading', async ({ page }) => {
  await page.locator('#thumbnail').setInputFiles({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(3 * MB),
  });
  await expect(page.locator('#flash')).toContainText('YouTube allows up to 2 MB');
  await expect(page.locator('#thumb-preview')).toBeHidden();
});

test('schedules a video to go public later', async ({ page, request }) => {
  await fillUploadForm(page, { title: 'Christmas special' });
  await page.getByLabel('Visibility').selectOption('scheduled');
  await expect(page.getByLabel('Publish on')).toBeVisible();
  await page.getByLabel('Publish on').fill('2030-12-25T09:30');
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#result-text')).toContainText("It's scheduled to go public on");
  await expect(historyRow(page, 'Christmas special')).toContainText('Scheduled for');

  // 9:30 in the browser's time zone, sent to YouTube as an exact moment.
  const expected = await page.evaluate(() => new Date('2030-12-25T09:30').toISOString());
  const [upload] = (await youtubeReceived(request)).uploads;
  expect(upload).toMatchObject({ privacyStatus: 'private', publishAt: expected });
});

test('rejects a publish time in the past', async ({ page }) => {
  await fillUploadForm(page);
  await page.getByLabel('Visibility').selectOption('scheduled');
  await page.getByLabel('Publish on').fill('2020-01-01T09:00');
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();
  await expect(page.locator('#flash')).toHaveText('Schedule the video at least 5 minutes in the future.');
});

test('explains when YouTube refuses the upload', async ({ page, request }) => {
  await setGoogle(request, { rejectWith: 'quotaExceeded' });
  await fillUploadForm(page, { title: 'Over the limit' });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#flash')).toContainText('used up its daily YouTube upload allowance');
  await expect(page.locator('#upload-form')).toBeVisible(); // details are kept for another try
  await expect(historyRow(page, 'Over the limit').locator('.status')).toHaveText('Failed');
});

test('still uploads the video when YouTube refuses the thumbnail', async ({ page, request }) => {
  await setGoogle(request, { thumbnailForbidden: true });
  await fillUploadForm(page, { title: 'Unverified channel' });
  await page.locator('#thumbnail').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#result-text')).toContainText('Uploaded!');
  await expect(page.locator('#result-warning')).toContainText('needs to be verified for custom thumbnails');
  await expect(historyRow(page, 'Unverified channel').locator('.status')).toHaveText('Uploaded, no thumbnail');
  expect((await youtubeReceived(request)).uploads).toHaveLength(1);
});

test('rejects files that are not videos', async ({ page }) => {
  await page.locator('#video').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await page.getByLabel('Title').fill('Not a video');
  await page.getByLabel("No, it's not made for kids").check();
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();
  await expect(page.locator('#flash')).toHaveText('That file does not look like a video.');
});

test('keeps a large upload intact across several chunks', async ({ page, request }) => {
  const file = await fillUploadForm(page, { file: videoFile('Long episode.mp4', 20 * MB) });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();
  await expect(page.locator('#result-text')).toContainText('Uploaded!');
  const [upload] = (await youtubeReceived(request)).uploads;
  expect(upload.sha256).toBe(sha256(file.buffer));
});
