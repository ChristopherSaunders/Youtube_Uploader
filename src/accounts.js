// Connected YouTube channels. Every function takes the app user's id so one
// user can never see or use another user's channels.
import db from './db.js';
import { encrypt, decrypt } from './crypto.js';

const PUBLIC_COLUMNS = 'id, channel_id, channel_title, channel_handle, thumbnail_url, created_at';

export function listAccounts(userId) {
  return db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM accounts WHERE user_id = ? ORDER BY channel_title`)
    .all(userId);
}

// Includes the decrypted refresh token; never send this to the browser.
export function getAccountWithToken(userId, accountId) {
  const row = db
    .prepare('SELECT * FROM accounts WHERE user_id = ? AND id = ?')
    .get(userId, accountId);
  if (!row) return null;
  const { encrypted_refresh_token, ...account } = row;
  return { ...account, refreshToken: decrypt(encrypted_refresh_token) };
}

// Connecting the same channel again just refreshes its details and token.
export function saveAccount(userId, channel, refreshToken) {
  db.prepare(
    `INSERT INTO accounts
       (user_id, channel_id, channel_title, channel_handle, thumbnail_url, encrypted_refresh_token)
     VALUES (@userId, @channelId, @title, @handle, @thumbnailUrl, @token)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET
       channel_title = excluded.channel_title,
       channel_handle = excluded.channel_handle,
       thumbnail_url = excluded.thumbnail_url,
       encrypted_refresh_token = excluded.encrypted_refresh_token,
       updated_at = datetime('now')`,
  ).run({ userId, ...channel, token: encrypt(refreshToken) });
}

export function updateRefreshToken(accountId, refreshToken) {
  db.prepare(
    "UPDATE accounts SET encrypted_refresh_token = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(encrypt(refreshToken), accountId);
}

export function deleteAccount(userId, accountId) {
  return db.prepare('DELETE FROM accounts WHERE user_id = ? AND id = ?').run(userId, accountId)
    .changes > 0;
}
