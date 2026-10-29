// YouTube's resumable upload protocol. The video goes up in chunks; if the
// connection drops, we ask YouTube how much it received and carry on from
// there instead of starting over.
// https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
import fs from 'node:fs/promises';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CHUNK_SIZE = 8 * 1024 * 1024; // must be a multiple of 256 KB
const MAX_RETRIES = 8; // without any upload progress in between
const RETRYABLE_STATUSES = new Set([401, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isNetworkError(err) {
  return ['TypeError', 'TimeoutError', 'AbortError'].includes(err.name);
}

// Shaped like a googleapis error so the same friendly-message code handles it.
async function apiError(res) {
  const data = await res.json().catch(() => ({}));
  const err = new Error(data.error?.message || `YouTube returned HTTP ${res.status}`);
  err.errors = data.error?.errors;
  err.response = { status: res.status, data };
  return err;
}

// "Range: bytes=0-524287" means YouTube has the first 524288 bytes.
function confirmedBytes(res) {
  const match = /bytes=0-(\d+)/.exec(res.headers.get('range') || '');
  return match ? Number(match[1]) + 1 : 0;
}

export async function uploadVideoResumable({
  auth,
  resource,
  notifySubscribers,
  filePath,
  size,
  mimeType,
  onProgress = () => {},
  onRetry = () => {},
}) {
  const authHeader = async () => {
    const { token } = await auth.getAccessToken(); // refreshes when expired
    return `Bearer ${token}`;
  };

  const startSession = async () => {
    const params = new URLSearchParams({
      uploadType: 'resumable',
      part: 'snippet,status',
      notifySubscribers: String(notifySubscribers),
    });
    return fetch(`${UPLOAD_URL}?${params}`, {
      method: 'POST',
      headers: {
        Authorization: await authHeader(),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(resource),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  const file = await fs.open(filePath, 'r');
  try {
    let sessionUrl = null;
    let offset = 0;
    let checkStatus = false;
    let retries = 0;

    for (;;) {
      let res = null;
      try {
        if (!sessionUrl) {
          res = await startSession();
          if (res.ok) {
            sessionUrl = res.headers.get('location');
            offset = 0;
            continue;
          }
        } else if (checkStatus || offset >= size) {
          // Ask YouTube how much of the video it already has.
          res = await fetch(sessionUrl, {
            method: 'PUT',
            headers: { Authorization: await authHeader(), 'Content-Range': `bytes */${size}` },
            body: Buffer.alloc(0),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } else {
          const length = Math.min(CHUNK_SIZE, size - offset);
          const chunk = Buffer.alloc(length);
          await file.read(chunk, 0, length, offset);
          res = await fetch(sessionUrl, {
            method: 'PUT',
            headers: {
              Authorization: await authHeader(),
              'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}`,
            },
            body: chunk,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        }
      } catch (err) {
        if (!isNetworkError(err)) throw err;
      }
      checkStatus = false;

      if (res?.status === 200 || res?.status === 201) {
        onProgress(size);
        return res.json();
      }
      if (res?.status === 308) {
        const confirmed = confirmedBytes(res);
        if (confirmed > offset) retries = 0; // only real progress resets the count
        offset = confirmed;
        onProgress(offset);
        if (offset < size) continue;
      }

      if (res?.status === 404 || res?.status === 410) {
        sessionUrl = null; // upload session expired; start a fresh one
      } else if (res?.status === 308) {
        checkStatus = true; // YouTube has every byte but hasn't confirmed yet
      } else if (res && !RETRYABLE_STATUSES.has(res.status)) {
        throw await apiError(res);
      } else {
        if (res?.status === 401) auth.setCredentials({ refresh_token: auth.credentials.refresh_token });
        checkStatus = Boolean(sessionUrl);
      }

      retries += 1;
      if (retries > MAX_RETRIES) {
        throw new Error('Kept losing the connection to YouTube. Check your internet and try again.');
      }
      const delayMs = Math.min(64, 2 ** retries) * 1000 + Math.random() * 1000;
      onRetry({ attempt: retries, delayMs });
      await sleep(delayMs);
    }
  } finally {
    await file.close();
  }
}
