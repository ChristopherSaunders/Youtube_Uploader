// JSON API used by the browser.
import express from 'express';
import config from './config.js';
import { requireUser } from './users.js';
import { listAccounts, getAccountWithToken, deleteAccount } from './accounts.js';
import { createOAuthClient } from './auth.js';

const router = express.Router();
router.use(requireUser);

router.get('/me', (req, res) => {
  res.json({ mode: config.appMode, name: req.user.name, email: req.user.email });
});

router.get('/accounts', (req, res) => {
  res.json(listAccounts(req.user.id));
});

router.delete('/accounts/:id', async (req, res) => {
  const account = getAccountWithToken(req.user.id, Number(req.params.id));
  if (!account) return res.status(404).json({ error: 'Channel not found.' });

  // Tell Google to cancel the app's access too. If that fails (e.g. the user
  // already removed access in their Google settings) we still forget it here.
  try {
    await createOAuthClient().revokeToken(account.refreshToken);
  } catch (err) {
    console.warn(`Could not revoke token for "${account.channel_title}":`, err.message);
  }

  deleteAccount(req.user.id, account.id);
  res.status(204).end();
});

export default router;
