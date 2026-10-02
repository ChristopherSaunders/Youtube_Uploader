# YouTube Uploader — Game Plan

A simple, clean browser app (Node.js backend) that uploads videos to any YouTube
account the user can sign in to.

**Direction:** build and run it locally first (just me, my channels), but
structure it so it can be hosted online later, where anyone can sign in and
upload to *their own* channels.

---

## 1. How it works (the big picture)

```
 Browser (HTML/CSS/JS)          Node.js server (Express)            Google
 ─────────────────────          ────────────────────────            ──────
 "Add account" button  ───────▶ /auth/google  ──── redirect ──────▶ OAuth consent
                                /auth/callback ◀── code ─────────── (user signs in,
                                  stores refresh token per account   picks channel)
 Pick account, choose file,
 title, description, privacy ─▶ /api/upload  ── resumable upload ─▶ YouTube Data API v3
 Progress bar ◀── progress events (SSE) ──┘                          videos.insert
```

**Key rule:** the app never asks for or stores YouTube passwords. "Credentials"
means the user signs in through Google's OAuth consent screen, and the app keeps
a *refresh token* per connected account. That is the only way Google allows
third-party uploads, and it's what lets one app manage many accounts/channels.

---

## 2. Tech stack

| Layer      | Choice                                   | Why                                   |
|------------|------------------------------------------|---------------------------------------|
| Runtime    | Node.js 22.13+                           | Built-in SQLite, native fetch         |
| Server     | Express                                  | Minimal, well known                   |
| Google API | `googleapis` (official client)           | Handles OAuth + resumable uploads     |
| Sessions   | `express-session`                        | Track who's using the app             |
| File intake| `busboy` (or `multer` with disk storage) | Stream large files, don't buffer in RAM |
| Storage    | SQLite (built-in `node:sqlite`)          | Users + connected accounts + tokens; easy to move to Postgres when hosted |
| Frontend   | Plain HTML + CSS + vanilla JS            | "Simple and clean", no build step     |
| Progress   | Server-Sent Events (SSE)                 | Push YouTube upload % to the browser  |

---

## 3. Phases

### Phase 0 — Google Cloud setup (no code, ~30 min)
- [x] Create a project at console.cloud.google.com
- [x] Enable **YouTube Data API v3**
- [x] Configure the **OAuth consent screen** (External, add yourself as a test user)
- [x] Add scopes: `youtube.upload` and `youtube.readonly` (to show channel name/avatar)
- [x] Create an **OAuth Client ID** (type: Web application)
  - Authorized redirect URI: `http://localhost:3000/auth/callback`
- [x] Copy Client ID + Secret into a local `.env` (never commit it)

**Done when:** you have a `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`.

### Phase 1 — Project skeleton
- [x] `npm init`, install `express googleapis express-session dotenv` (SQLite is built into Node)
- [x] Folder layout:
  ```
  src/
    server.js          # Express app, routes
    auth.js            # OAuth flow, token refresh
    accounts.js        # Load/save connected accounts (encrypted tokens)
    db.js              # SQLite setup: users, accounts, uploads tables
    config.js          # All env-driven settings (BASE_URL, secrets, mode)
    upload.js          # Streams file → YouTube resumable upload
  public/
    index.html
    styles.css
    app.js
  .env.example
  ```
- [x] `npm start` serves `public/` on http://localhost:3000

**Done when:** a blank styled page loads.

### Phase 2 — Connect accounts (OAuth)
- [x] Multi-user-ready data model from day one:
  ```
  users     (id, google_sub, email, name, created_at)
  accounts  (id, user_id → users.id, channel_id, channel_title, thumbnail,
             encrypted_refresh_token, created_at)
  uploads   (id, user_id, account_id, video_id, title, status, created_at)
  ```
  Every query filters by `user_id`. Locally there is just one user (you), but
  nothing has to be rewritten when other people arrive.
- [x] `requireUser` middleware: locally (`APP_MODE=local`) it auto-signs-in the
      single owner user; hosted (`APP_MODE=hosted`) it requires a real login
- [x] `GET /auth/google` → redirect to Google with `access_type=offline`,
      `prompt=consent select_account` (forces account picker + refresh token)
- [x] `GET /auth/callback` → exchange code for tokens, call `channels.list?mine=true`
      to get channel id/title/thumbnail, save account
- [x] Encrypt refresh tokens at rest (AES-256-GCM with `TOKEN_ENCRYPTION_KEY`)
- [x] `GET /api/accounts` → list connected channels (no tokens sent to browser)
- [x] `DELETE /api/accounts/:id` → disconnect (and revoke token with Google)
- [x] Use a `state` parameter to prevent CSRF on the callback

**Done when:** you can connect 2+ accounts and see them listed with avatars.

### Phase 3 — Upload a video
- [ ] Upload form: account picker, file, title, description, tags, privacy
      (private / unlisted / public), "made for kids" toggle, optional category
- [ ] `POST /api/upload` streams the file to a temp file on disk (not RAM)
- [ ] Server calls `youtube.videos.insert` with `part=snippet,status` and a
      **resumable** media upload using the chosen account's credentials
- [ ] Return the new video ID + link `https://youtu.be/<id>`
- [ ] Delete the temp file when finished (success or failure)

**Done when:** a test video lands on the chosen channel.

### Phase 4 — Progress & polish
- [ ] Two-stage progress bar: browser → server (XHR `upload.onprogress`),
      then server → YouTube (SSE fed by `onUploadProgress`)
- [ ] Drag-and-drop file zone, file size/type validation
- [ ] Optional custom thumbnail (`thumbnails.set`)
- [ ] Clear error messages (quota exceeded, token revoked → "reconnect account")
- [ ] Upload history list (last N uploads per account)

**Done when:** it feels good to use and failures explain themselves.

### Phase 5 — Hardening (before anyone else uses it)
- [ ] Limit max file size; validate MIME type
- [ ] Rate-limit upload endpoint; `helmet` for security headers
- [ ] If hosted: HTTPS only, secure cookies, update redirect URI
- [ ] Retry with exponential backoff on 5xx / network errors during upload
- [ ] Basic tests for auth callback + upload route (mock Google API)
- [ ] Test that user A can never see or use user B's accounts

### Phase 6 — Go online, multi-user
- [ ] **App login = "Sign in with Google"** (OpenID Connect: `openid email profile`).
      No passwords to store. Signing in creates/finds the `users` row; connecting
      a channel is the separate step from Phase 2 (one user can connect many channels).
- [ ] Switch `APP_MODE=hosted`; `requireUser` now enforces a session
- [ ] Session store in the database (not memory) so restarts don't log people out
- [ ] Move SQLite → Postgres if the host has no persistent disk
- [ ] Deploy to Render / Railway / Fly.io (not Vercel/Netlify — upload size and timeout limits)
- [ ] Domain + HTTPS; add `https://<domain>/auth/callback` as a redirect URI
- [ ] Public pages Google requires: homepage, privacy policy, terms of service
- [ ] Per-user upload limits so one person can't burn the whole daily API quota
- [ ] "Delete my data" button (remove user, revoke all their tokens)
- [ ] Apply for **Google OAuth verification** (needed past 100 users and to drop
      the "unverified app" warning) and the **YouTube API compliance audit**
      (needed for public uploads and a higher quota)

---

## 4. Gotchas to know up front

1. **Unverified apps upload as Private only.** Videos uploaded through an API
   project that hasn't passed Google's YouTube API compliance audit are locked
   to *private*. Fine for personal use/testing; to publish public videos via the
   app you'll need to apply for the audit.
2. **Quota.** New projects get 10,000 units/day, and `videos.insert` is one of
   the most expensive calls (check the current cost in Google's quota
   calculator). Expect only a handful of uploads per day until you request more.
3. **Testing-mode refresh tokens expire after 7 days.** While the consent screen
   is in "Testing", users must reconnect weekly. Publishing the app removes this.
4. **Brand accounts / multiple channels.** One Google login can own several
   channels; the user picks the channel on Google's consent screen, so each
   channel is connected as its own "account" in the app.
5. **Large files.** Never load the whole video into memory — stream to disk,
   then stream to YouTube with resumable upload.

---

## 5. Decisions

- ✅ **Local first, hosted later.** Everything environment-specific (base URL,
  secrets, mode) lives in `.env` / `config.js`, never hard-coded.
- ✅ **Just me for now; multi-user when hosted.** The database is shaped for many
  users from the start; login is switched on in Phase 6.
- ✅ **App login when hosted = Sign in with Google.**
- ⬜ **Scheduling?** "Publish at" support (`status.publishAt`) in v1 or later?

---

## 6. Order of attack (suggested)

1. Phase 0 (you, in Google Cloud Console)
2. Phase 1 + 2 together → first win: accounts connect
3. Phase 3 → second win: a real upload
4. Phase 4 → make it nice
5. Phase 5 + 6 → harden, then go online with multi-user login
