// What happens when things go wrong mid-upload: dropped connections and
// channel sign-ins that expire (Google does this after 7 days in Testing mode).
import { test, expect } from '@playwright/test';
import {
  MB,
  connectChannel,
  fakeGoogleSignIn,
  fillUploadForm,
  historyRow,
  resetFakes,
  setGoogle,
  sha256,
  videoFile,
  youtubeReceived,
} from './helpers.js';

const RECONNECT_MESSAGE =
  "This channel's connection to Google has expired. Click Reconnect next to the channel, " +
  'sign in again, then retry.';

test.beforeEach(async ({ page, request }) => {
  await resetFakes(request);
  await connectChannel(page);
});

test('picks up where it left off when the connection drops', async ({ page, request }) => {
  await setGoogle(request, { dropOnce: true });
  // Over 8 MB, so the drop happens on the second chunk.
  const file = await fillUploadForm(page, { file: videoFile('Episode 43.mp4', 12 * MB) });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#progress-detail')).toContainText('Reconnecting and picking up where it left off');
  await expect(page.locator('#result-text')).toContainText('Uploaded!', { timeout: 30_000 });

  const { uploads, drops } = await youtubeReceived(request);
  expect(drops).toBe(1);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].sha256).toBe(sha256(file.buffer)); // nothing lost or duplicated
});

test('catches an expired sign-in before sending the video', async ({ page, request }) => {
  await setGoogle(request, { expired: true });
  let videoSent = false;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/uploads')) videoSent = true;
  });

  await fillUploadForm(page);
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#flash')).toHaveText(RECONNECT_MESSAGE);
  await expect(page.locator('.account-handle')).toHaveText('Connection expired');
  await expect(page.getByRole('link', { name: 'Reconnect' })).toBeVisible();
  expect(videoSent).toBe(false);
  expect((await youtubeReceived(request)).uploads).toHaveLength(0);
});

test('lets you reconnect and retry when the sign-in expires mid-upload', async ({ page, request }) => {
  await setGoogle(request, { expireDuringUpload: true });
  const file = await fillUploadForm(page, { file: videoFile('Episode 44.mp4', 12 * MB), title: 'Episode 44' });
  await page.getByRole('button', { name: 'Upload to YouTube' }).click();

  await expect(page.locator('#flash')).toHaveText(RECONNECT_MESSAGE, { timeout: 30_000 });
  const row = historyRow(page, 'Episode 44');
  await expect(row.locator('.status')).toHaveText('Failed');
  await expect(row.getByRole('button', { name: 'Retry' })).toBeVisible();

  // Reconnect: Google issues a fresh sign-in.
  await setGoogle(request, { expired: false });
  await fakeGoogleSignIn(page);
  await page.getByRole('link', { name: 'Reconnect' }).click();
  await expect(page.locator('#flash')).toHaveText('Connected Neighbour Please Podcast.');
  await expect(page.getByRole('link', { name: 'Reconnect' })).toBeHidden();

  // Retry re-sends the copy the app kept; no need to choose the file again.
  await historyRow(page, 'Episode 44').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#result-text')).toContainText('Uploaded!', { timeout: 30_000 });
  await expect(historyRow(page, 'Episode 44').locator('.status')).toHaveText('Uploaded');

  const { uploads } = await youtubeReceived(request);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].sha256).toBe(sha256(file.buffer));
});
