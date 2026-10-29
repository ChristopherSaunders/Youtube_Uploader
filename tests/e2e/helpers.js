import crypto from 'node:crypto';
import { expect } from '@playwright/test';

export const BASE_URL = 'http://localhost:3100';

// A real 1×1 PNG, so the thumbnail preview can load it.
export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const MB = 1024 * 1024;

export function videoFile(name = 'Episode 42.mp4', size = 200_000) {
  return { name, mimeType: 'video/mp4', buffer: crypto.randomBytes(size) };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function resetFakes(request) {
  await request.post('/__test/reset');
}

export async function setGoogle(request, settings) {
  await request.post('/__test/google', { data: settings });
}

export async function youtubeReceived(request) {
  return (await request.get('/__test/youtube')).json();
}

// Stands in for Google's sign-in page. The app still builds its real sign-in
// link (and remembers its state value); instead of following it to Google, the
// browser goes straight back to the app's callback, as if the user picked their
// account and clicked Allow. Returns the sign-in URLs the app produced.
export async function fakeGoogleSignIn(page, { cancel = false } = {}) {
  const requests = [];
  await page.route('**/auth/google', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const googleUrl = new URL(response.headers().location);
    requests.push(googleUrl);
    const state = googleUrl.searchParams.get('state');
    const query = cancel ? 'error=access_denied' : 'code=fake-code';
    await route.fulfill({
      response,
      headers: { ...response.headers(), location: `${BASE_URL}/auth/callback?${query}&state=${state}` },
    });
  });
  return requests;
}

export async function connectChannel(page) {
  await fakeGoogleSignIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: '+ Connect a channel' }).click();
  await expect(page.locator('#flash')).toHaveText('Connected Neighbour Please Podcast.');
}

export async function fillUploadForm(page, { file = videoFile(), title, madeForKids = 'no' } = {}) {
  await page.locator('#video').setInputFiles(file);
  if (title !== undefined) await page.getByLabel('Title').fill(title);
  if (madeForKids === 'no') await page.getByLabel("No, it's not made for kids").check();
  if (madeForKids === 'yes') await page.getByLabel("Yes, it's made for kids").check();
  return file;
}

export function historyRow(page, title) {
  return page.locator('#history li').filter({ hasText: title });
}
