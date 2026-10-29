import { test, expect } from '@playwright/test';
import { connectChannel, fakeGoogleSignIn, resetFakes, setGoogle } from './helpers.js';

test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

test('explains how to start when no channel is connected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#accounts-empty')).toBeVisible();
  await expect(page.locator('#upload-hint')).toHaveText('Connect a channel above to start uploading.');
  await expect(page.locator('#upload-form')).toBeHidden();
});

test('connects a channel through Google sign-in', async ({ page }) => {
  const signIns = await fakeGoogleSignIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: '+ Connect a channel' }).click();

  await expect(page.locator('#flash')).toHaveText('Connected Neighbour Please Podcast.');
  await expect(page).toHaveURL('/'); // message parameters are cleaned out of the address bar
  const channel = page.locator('.account');
  await expect(channel.locator('.account-title')).toHaveText('Neighbour Please Podcast');
  await expect(channel.locator('.account-handle')).toHaveText('@neighbourpleasepodcast');
  await expect(page.locator('#upload-form')).toBeVisible();

  // The app asked Google for the right things.
  const params = signIns[0].searchParams;
  expect(params.get('access_type')).toBe('offline');
  expect(params.get('prompt')).toContain('consent');
  expect(params.get('redirect_uri')).toBe('http://localhost:3100/auth/callback');
  expect(params.get('scope')).toContain('https://www.googleapis.com/auth/youtube.upload');
  expect(params.get('state')).toMatch(/^[0-9a-f]{32}$/);
});

test('shows a message when Google sign-in is cancelled', async ({ page }) => {
  await fakeGoogleSignIn(page, { cancel: true });
  await page.goto('/');
  await page.getByRole('link', { name: '+ Connect a channel' }).click();
  await expect(page.locator('#flash')).toHaveText('Connection cancelled.');
  await expect(page.locator('.account')).toHaveCount(0);
});

test('asks for both YouTube permissions when one is unticked', async ({ page, request }) => {
  await setGoogle(request, { grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'] });
  await fakeGoogleSignIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: '+ Connect a channel' }).click();
  await expect(page.locator('#flash')).toContainText('tick both YouTube permission boxes');
  await expect(page.locator('.account')).toHaveCount(0);
});

test('explains when the Google account has no YouTube channel', async ({ page, request }) => {
  await setGoogle(request, { channel: null });
  await fakeGoogleSignIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: '+ Connect a channel' }).click();
  await expect(page.locator('#flash')).toContainText('has no YouTube channel yet');
});

test('rejects a sign-in callback that did not come from our sign-in link', async ({ page }) => {
  await page.goto('/auth/callback?code=stolen&state=not-ours');
  await expect(page.locator('#flash')).toContainText('Sign-in link expired or was invalid');
  await expect(page.locator('.account')).toHaveCount(0);
});

test('disconnects a channel', async ({ page }) => {
  await connectChannel(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('#flash')).toHaveText('Disconnected Neighbour Please Podcast.');
  await expect(page.locator('#accounts-empty')).toBeVisible();
  await expect(page.locator('#upload-form')).toBeHidden();
});
