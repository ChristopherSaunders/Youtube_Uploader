// Receives a video from the browser, saves it to a temp file, then sends it
// to YouTube in the background while the browser polls for progress.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import { google } from 'googleapis';
import config from './config.js';
import db from './db.js';
import { getAuthorizedClient } from './auth.js';
import { uploadVideoResumable } from './resumable.js';

const TEMP_DIR = path.join(os.tmpdir(), 'youtube-uploader');
fs.rmSync(TEMP_DIR, { recursive: true, force: true }); // leftovers from a crash
fs.mkdirSync(TEMP_DIR, { recursive: true });

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.mkv', '.avi', '.wmv', '.flv', '.webm', '.mpg', '.mpeg', '.3gp', '.mts',
]);
const PRIVACY_OPTIONS = ['private', 'unlisted', 'public'];
const THUMBNAIL_TYPES = ['image/jpeg', 'image/png'];
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024; // YouTube's limit

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function isVideo(filename, mimeType) {
  return mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

// Streams the multipart form to disk so large videos never sit in memory.
// The optional thumbnail is small (2 MB max), so it is kept in memory.
export function receiveUpload(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { files: 2, fileSize: config.maxUploadBytes, fields: 20, fieldSize: 10_000 },
      });
    } catch {
      return reject(httpError(400, 'Expected a video upload.'));
    }

    const fields = {};
    let file = null;
    let thumbnail = null;
    let writeDone = Promise.resolve();
    let thumbnailDone = Promise.resolve();
    let rejection = null;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (file) fs.rm(file.path, { force: true }, () => {});
      req.unpipe(parser);
      req.resume();
      reject(err);
    };

    parser.on('field', (name, value) => {
      fields[name] = value;
    });

    const receiveThumbnail = (stream, info) => {
      if (!THUMBNAIL_TYPES.includes(info.mimeType)) {
        rejection = httpError(400, 'Thumbnails must be JPG or PNG images.');
        return stream.resume();
      }
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size <= MAX_THUMBNAIL_BYTES) chunks.push(chunk);
      });
      thumbnailDone = new Promise((done) => {
        stream.on('end', () => {
          if (size > MAX_THUMBNAIL_BYTES) {
            rejection = httpError(413, 'Thumbnails can be at most 2 MB.');
          } else if (size > 0) {
            thumbnail = { buffer: Buffer.concat(chunks), mimeType: info.mimeType };
          }
          done();
        });
      });
    };

    parser.on('file', (name, stream, info) => {
      if (name === 'thumbnail' && !thumbnail) return receiveThumbnail(stream, info);
      if (name !== 'video' || file) return stream.resume();
      if (!isVideo(info.filename, info.mimeType)) {
        rejection = httpError(400, 'That file does not look like a video.');
        return stream.resume();
      }
      file = {
        path: path.join(TEMP_DIR, crypto.randomUUID()),
        filename: info.filename,
        mimeType: info.mimeType,
        size: 0,
      };
      stream.on('data', (chunk) => {
        file.size += chunk.length;
      });
      stream.on('limit', () => {
        rejection = httpError(413, `Video is larger than the ${config.maxUploadMb} MB limit.`);
      });
      writeDone = pipeline(stream, fs.createWriteStream(file.path));
    });

    parser.on('error', () => fail(httpError(400, 'The upload was interrupted.')));
    req.on('aborted', () => fail(httpError(400, 'The upload was cancelled.')));

    parser.on('close', async () => {
      try {
        await Promise.all([writeDone, thumbnailDone]);
      } catch {
        return fail(httpError(400, 'The upload was interrupted.'));
      }
      if (rejection) return fail(rejection);
      if (!file || file.size === 0) return fail(httpError(400, 'Choose a video file.'));
      settled = true;
      resolve({ fields, file, thumbnail });
    });

    req.pipe(parser);
  });
}

// YouTube's own rules for video details, checked before we spend quota.
export function parseVideoDetails(fields) {
  const title = (fields.title || '').trim();
  const description = (fields.description || '').trim();
  const tags = (fields.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!title) throw httpError(400, 'Add a title.');
  if (title.length > 100) throw httpError(400, 'Titles can be at most 100 characters.');
  if (/[<>]/.test(title)) throw httpError(400, 'Titles cannot contain < or >.');
  if (Buffer.byteLength(description) > 5000) {
    throw httpError(400, 'Descriptions can be at most 5,000 characters.');
  }
  if (/[<>]/.test(description)) throw httpError(400, 'Descriptions cannot contain < or >.');
  if (tags.join(',').length > 500) throw httpError(400, 'Tags can be at most 500 characters in total.');

  const privacy = fields.privacy || 'private';
  if (!PRIVACY_OPTIONS.includes(privacy)) throw httpError(400, 'Choose a visibility.');
  if (!['yes', 'no'].includes(fields.madeForKids)) {
    throw httpError(400, 'Say whether the video is made for kids.');
  }

  // Scheduled videos must be uploaded as private; YouTube makes them public
  // at publishAt.
  let publishAt = null;
  if (fields.publishAt) {
    const when = new Date(fields.publishAt);
    if (Number.isNaN(when.getTime())) throw httpError(400, 'Choose a valid publish date and time.');
    if (when.getTime() < Date.now() + 5 * 60 * 1000) {
      throw httpError(400, 'Schedule the video at least 5 minutes in the future.');
    }
    if (privacy !== 'private') throw httpError(400, 'Scheduled videos must be uploaded as private.');
    publishAt = when.toISOString();
  }

  return {
    title,
    description,
    tags,
    privacy,
    publishAt,
    madeForKids: fields.madeForKids === 'yes',
    categoryId: /^\d+$/.test(fields.categoryId || '') ? fields.categoryId : '22',
    notifySubscribers: fields.notifySubscribers !== 'false',
  };
}

function friendlyYouTubeError(err) {
  if (!err.response && !err.errors) return err.message; // our own messages
  const data = err.response?.data;
  if (data?.error === 'invalid_grant') {
    return 'This channel\'s connection has expired. Disconnect it and connect it again.';
  }
  const reason = err.errors?.[0]?.reason || data?.error?.errors?.[0]?.reason;
  switch (reason) {
    case 'quotaExceeded':
      return 'The app has used up its daily YouTube upload allowance. It resets at midnight Pacific time.';
    case 'uploadLimitExceeded':
      return 'This channel has reached YouTube\'s upload limit for now. Try again later.';
    case 'youtubeSignupRequired':
      return 'This Google account needs a YouTube channel before it can upload.';
    case 'insufficientPermissions':
    case 'forbidden':
      return 'YouTube refused the upload. Try disconnecting and reconnecting the channel.';
    default:
      return `YouTube rejected the upload: ${data?.error?.message || err.message}`;
  }
}

function friendlyThumbnailError(err) {
  const data = err.response?.data;
  const reason = err.errors?.[0]?.reason || data?.error?.errors?.[0]?.reason;
  const prefix = 'The video uploaded, but the thumbnail did not:';
  switch (reason) {
    case 'forbidden':
      return `${prefix} this channel needs to be verified for custom thumbnails. ` +
        'Verify it at youtube.com/verify, then add the thumbnail in YouTube Studio.';
    case 'invalidImage':
      return `${prefix} YouTube could not read the image. Try a different JPG or PNG.`;
    case 'uploadRateLimitExceeded':
      return `${prefix} too many thumbnail changes recently. Add it in YouTube Studio later.`;
    default:
      return `${prefix} ${data?.error?.message || err.message}`;
  }
}

// In-progress uploads, kept in memory for the browser to poll. Finished
// results are also saved in the uploads table.
const jobs = new Map();

export function getJob(userId, uploadId) {
  const job = jobs.get(uploadId);
  return job && job.userId === userId ? job : null;
}

export function startYouTubeUpload(user, account, details, file, thumbnail) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO uploads (user_id, account_id, title, status, publish_at)
       VALUES (?, ?, ?, 'uploading', ?)`,
    )
    .run(user.id, account.id, details.title, details.publishAt);
  const uploadId = Number(lastInsertRowid);

  const job = {
    id: uploadId,
    userId: user.id,
    status: 'uploading',
    bytesSent: 0,
    totalBytes: file.size,
    videoId: null,
    privacy: null,
    publishAt: null,
    retrying: false,
    error: null,
    warning: null,
  };
  jobs.set(uploadId, job);

  sendToYouTube(job, account, details, file, thumbnail).finally(() => {
    fs.rm(file.path, { force: true }, () => {});
    db.prepare(
      'UPDATE uploads SET status = ?, video_id = ?, error = ?, warning = ? WHERE id = ?',
    ).run(job.status, job.videoId, job.error, job.warning, job.id);
    setTimeout(() => jobs.delete(uploadId), 60 * 60 * 1000);
  });

  return job;
}

async function sendToYouTube(job, account, details, file, thumbnail) {
  const auth = getAuthorizedClient(account);
  const youtube = google.youtube({ version: 'v3', auth });
  try {
    const data = await uploadVideoResumable({
      auth,
      notifySubscribers: details.notifySubscribers,
      resource: {
        snippet: {
          title: details.title,
          description: details.description,
          tags: details.tags.length ? details.tags : undefined,
          categoryId: details.categoryId,
        },
        status: {
          privacyStatus: details.privacy,
          publishAt: details.publishAt || undefined,
          selfDeclaredMadeForKids: details.madeForKids,
        },
      },
      filePath: file.path,
      size: file.size,
      mimeType: file.mimeType.startsWith('video/') ? file.mimeType : 'application/octet-stream',
      onProgress: (bytes) => {
        job.bytesSent = bytes;
        job.retrying = false;
      },
      onRetry: ({ attempt, delayMs }) => {
        console.warn(`Upload interrupted; retry ${attempt} in ${Math.round(delayMs / 1000)}s`);
        job.retrying = true;
      },
    });
    job.bytesSent = job.totalBytes;
    job.retrying = false;
    job.videoId = data.id;
    job.privacy = data.status?.privacyStatus || details.privacy;
    job.publishAt = data.status?.publishAt || details.publishAt;
  } catch (err) {
    console.error('YouTube upload failed:', err.response?.data || err.message);
    job.status = 'error';
    job.error = friendlyYouTubeError(err);
    return;
  }

  // A thumbnail problem shouldn't count as a failed upload: the video is up.
  if (thumbnail) {
    job.status = 'thumbnail';
    try {
      await youtube.thumbnails.set({
        videoId: job.videoId,
        media: { mimeType: thumbnail.mimeType, body: Readable.from([thumbnail.buffer]) },
      });
    } catch (err) {
      console.error('Thumbnail upload failed:', err.response?.data || err.message);
      job.warning = friendlyThumbnailError(err);
    }
  }
  job.status = 'done';
}

export function listRecentUploads(userId) {
  return db
    .prepare(
      `SELECT u.id, u.title, u.status, u.video_id, u.error, u.warning, u.publish_at, u.created_at,
              a.channel_title
         FROM uploads u
         LEFT JOIN accounts a ON a.id = u.account_id
        WHERE u.user_id = ?
        ORDER BY u.id DESC
        LIMIT 10`,
    )
    .all(userId);
}
