// "Connect a YouTube channel" flow using Google OAuth 2.0.
import crypto from 'node:crypto';
import express from 'express';
import { google } from 'googleapis';
import config from './config.js';
import { requireUser } from './users.js';
import { saveAccount, updateRefreshToken } from './accounts.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.redirectUri,
  );
}

// An OAuth client ready to call YouTube on behalf of one connected channel.
// Google occasionally issues a new refresh token; keep the stored one current.
export function getAuthorizedClient(account) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: account.refreshToken });
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) updateRefreshToken(account.id, tokens.refresh_token);
  });
  return client;
}

function redirectWithMessage(res, key, message) {
  res.redirect(`/?${key}=${encodeURIComponent(message)}`);
}

const router = express.Router();

router.get('/auth/google', requireUser, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const url = createOAuthClient().generateAuthUrl({
    access_type: 'offline', // gives us a refresh token
    prompt: 'consent select_account', // always show the account/channel picker
    scope: SCOPES,
    state,
  });
  res.redirect(url);
});

router.get('/auth/callback', requireUser, async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;

  if (error) {
    return redirectWithMessage(
      res,
      'error',
      error === 'access_denied' ? 'Connection cancelled.' : `Google returned an error: ${error}`,
    );
  }
  if (!code || !state || state !== expectedState) {
    return redirectWithMessage(res, 'error', 'Sign-in link expired or was invalid. Please try again.');
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);

    // Google lets people untick individual permissions on the consent screen.
    const granted = (tokens.scope || '').split(' ');
    const missingScopes = SCOPES.filter((scope) => !granted.includes(scope));
    if (missingScopes.length) {
      return redirectWithMessage(
        res,
        'error',
        'Please tick both YouTube permission boxes on the Google screen so the app can upload.',
      );
    }
    if (!tokens.refresh_token) {
      return redirectWithMessage(res, 'error', 'Google did not return a long-lived token. Please try again.');
    }

    client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: client });
    const { data } = await youtube.channels.list({ part: ['snippet'], mine: true });
    const channel = data.items?.[0];
    if (!channel) {
      return redirectWithMessage(
        res,
        'error',
        'That Google account has no YouTube channel yet. Create one on YouTube first.',
      );
    }

    const { snippet } = channel;
    saveAccount(
      req.user.id,
      {
        channelId: channel.id,
        title: snippet.title,
        handle: snippet.customUrl || null,
        thumbnailUrl: snippet.thumbnails?.default?.url || null,
      },
      tokens.refresh_token,
    );
    redirectWithMessage(res, 'connected', snippet.title);
  } catch (err) {
    console.error('OAuth callback failed:', err.response?.data || err.message);
    redirectWithMessage(res, 'error', 'Could not connect that channel. Check the server log for details.');
  }
});

export default router;
