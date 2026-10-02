// JSON API used by the browser.
import fs from 'node:fs';
import express from 'express';
import config from './config.js';
import { requireUser } from './users.js';
import { listAccounts, getAccountWithToken, deleteAccount } from './accounts.js';
import { createOAuthClient } from './auth.js';
import {
  receiveUpload,
  parseVideoDetails,
  startYouTubeUpload,
  getJob,
  listRecentUploads,
  httpError,
} from './upload.js';

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

router.post('/uploads', async (req, res) => {
  const { fields, file, thumbnail } = await receiveUpload(req);
  try {
    const details = parseVideoDetails(fields);
    const account = getAccountWithToken(req.user.id, Number(fields.accountId));
    if (!account) throw httpError(400, 'Choose a connected channel.');
    const job = startYouTubeUpload(req.user, account, details, file, thumbnail);
    res.status(202).json(job);
  } catch (err) {
    fs.rm(file.path, { force: true }, () => {});
    throw err;
  }
});

router.get('/uploads', (req, res) => {
  res.json(listRecentUploads(req.user.id));
});

router.get('/uploads/:id', (req, res) => {
  const job = getJob(req.user.id, Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Upload not found.' });
  res.json(job);
});

export default router;
