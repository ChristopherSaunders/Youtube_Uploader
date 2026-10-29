// Runs the real app for the end-to-end tests, with Google sign-in and YouTube
// faked at the network edge: nothing here talks to Google, and uploads never
// reach a real channel. Tests control and inspect the fakes via /__test/*.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

// Start every run from an empty database and upload folder.
fs.rmSync(path.dirname(process.env.DATABASE_PATH), { recursive: true, force: true });
fs.rmSync(process.env.UPLOAD_TEMP_DIR, { recursive: true, force: true });

const { SCOPES } = await import('../../src/auth.js');

const DEFAULT_CHANNEL = {
  id: 'UC-test-channel',
  title: 'Neighbour Please Podcast',
  handle: '@neighbourpleasepodcast',
};

function freshState() {
  return {
    // What Google says when the app signs in / refreshes a token
    expired: false, // saved sign-in rejected with invalid_grant
    grantedScopes: SCOPES, // scopes the user ticked on the consent screen
    channel: DEFAULT_CHANNEL, // null = Google account without a channel
    // What YouTube does during an upload
    rejectWith: null, // e.g. 'quotaExceeded', returned when the upload starts
    dropOnce: false, // drop the connection halfway through the 2nd chunk
    expireDuringUpload: false, // sign-in expires after the 1st chunk
    thumbnailForbidden: false, // channel isn't verified for custom thumbnails
    // What YouTube received
    uploads: [],
    thumbnails: [],
    drops: 0,
    sessions: new Map(),
    nextId: 1,
  };
}

let state = freshState();

function expiredSignInError() {
  return Object.assign(new Error('invalid_grant'), {
    response: {
      status: 400,
      data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    },
  });
}

// --- Google sign-in
const OAuth2 = google.auth.OAuth2;
OAuth2.prototype.getToken = async function getToken(code) {
  return {
    tokens: {
      access_token: 'fake-access-token',
      refresh_token: `fake-refresh-${code}`,
      scope: state.grantedScopes.join(' '),
    },
  };
};
OAuth2.prototype.getAccessToken = async function getAccessToken() {
  if (state.expired) throw expiredSignInError();
  return { token: 'fake-access-token' };
};
OAuth2.prototype.revokeToken = async function revokeToken() {
  return { data: {} };
};

// --- YouTube Data API calls made through googleapis
const realYoutube = google.youtube.bind(google);
google.youtube = (options) => {
  const youtube = realYoutube(options);
  youtube.channels.list = async () => ({
    data: {
      items: state.channel
        ? [
            {
              id: state.channel.id,
              snippet: { title: state.channel.title, customUrl: state.channel.handle, thumbnails: {} },
            },
          ]
        : [],
    },
  });
  youtube.thumbnails.set = async ({ videoId, media }) => {
    let bytes = 0;
    for await (const chunk of media.body) bytes += chunk.length;
    if (state.thumbnailForbidden) {
      throw Object.assign(new Error('forbidden'), { errors: [{ reason: 'forbidden' }] });
    }
    state.thumbnails.push({ videoId, mimeType: media.mimeType, bytes });
    return { data: {} };
  };
  return youtube;
};

// --- YouTube's resumable upload endpoint (the app calls it with fetch)
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const SESSION_URL = 'https://fake-youtube.test/upload/';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function startSession(url, init) {
  if (state.rejectWith) {
    return json(403, {
      error: { message: state.rejectWith, errors: [{ reason: state.rejectWith }] },
    });
  }
  const id = String(state.nextId++);
  state.sessions.set(id, {
    resource: JSON.parse(init.body),
    notifySubscribers: new URL(url).searchParams.get('notifySubscribers') === 'true',
    size: Number(init.headers['X-Upload-Content-Length']),
    mimeType: init.headers['X-Upload-Content-Type'],
    chunks: [],
    received: 0,
    videoId: null,
  });
  return new Response(null, { status: 200, headers: { location: SESSION_URL + id } });
}

function finish(session) {
  if (!session.videoId) {
    const data = Buffer.concat(session.chunks);
    const { snippet, status } = session.resource;
    session.videoId = `video${state.uploads.length + 1}`;
    state.uploads.push({
      videoId: session.videoId,
      title: snippet.title,
      description: snippet.description,
      tags: snippet.tags || [],
      categoryId: snippet.categoryId,
      privacyStatus: status.privacyStatus,
      publishAt: status.publishAt || null,
      madeForKids: status.selfDeclaredMadeForKids,
      notifySubscribers: session.notifySubscribers,
      mimeType: session.mimeType,
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    });
  }
  const { status } = session.resource;
  return json(200, {
    id: session.videoId,
    status: { privacyStatus: status.privacyStatus, publishAt: status.publishAt },
  });
}

function receiveChunk(url, init) {
  const session = state.sessions.get(url.slice(SESSION_URL.length));
  if (!session) return json(404, { error: { message: 'Upload session not found' } });

  const progress = () =>
    new Response(null, {
      status: 308,
      headers: session.received ? { range: `bytes=0-${session.received - 1}` } : {},
    });
  const keep = (bytes) => {
    session.chunks.push(bytes);
    session.received += bytes.length;
  };

  const range = init.headers['Content-Range'];
  if (range.startsWith('bytes */')) {
    return session.received === session.size ? finish(session) : progress();
  }

  const start = Number(/bytes (\d+)-/.exec(range)[1]);
  if (start !== session.received) {
    return json(400, { error: { message: `Expected offset ${session.received}, got ${start}` } });
  }
  const body = Buffer.from(init.body);

  if (start > 0 && state.expireDuringUpload) {
    state.expireDuringUpload = false;
    state.expired = true;
    throw new TypeError('fetch failed');
  }
  if (start > 0 && state.dropOnce) {
    state.dropOnce = false;
    state.drops += 1;
    keep(body.subarray(0, Math.floor(body.length / 2))); // half arrived, then the line dropped
    throw new TypeError('fetch failed');
  }

  keep(body);
  return session.received === session.size ? finish(session) : progress();
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith(UPLOAD_URL)) return startSession(url, init);
  if (url.startsWith(SESSION_URL)) return receiveChunk(url, init);
  throw new Error(`Unexpected outbound request during tests: ${url}`);
};

// --- Test controls
const { default: app } = await import('../../src/app.js');
const { default: db } = await import('../../src/db.js');

app.post('/__test/reset', (req, res) => {
  db.exec('DELETE FROM uploads; DELETE FROM accounts;');
  state = freshState();
  res.json({ ok: true });
});

app.post('/__test/google', (req, res) => {
  Object.assign(state, req.body);
  res.json({ ok: true });
});

app.get('/__test/youtube', (req, res) => {
  res.json({ uploads: state.uploads, thumbnails: state.thumbnails, drops: state.drops });
});

await import('../../src/server.js');
