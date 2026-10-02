# Youtube_Uploader
This is a Youtube uploader app to speed the process of uploading videos to youtube with a couple clicks

See [PLAN.md](PLAN.md) for the full game plan.

## Setup

Requires [Node.js](https://nodejs.org) 22.13 or newer, and the Google Cloud project
from Phase 0 of the plan (YouTube Data API v3 enabled, OAuth client created with
redirect URI `http://localhost:3000/auth/callback`).

1. Install dependencies:
   ```sh
   npm install
   ```
2. Create your settings file:
   ```sh
   cp .env.example .env
   ```
3. Open `.env` and paste in your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Generate the two secrets and paste the printed lines into `.env`:
   ```sh
   npm run keygen
   ```
5. Start the app:
   ```sh
   npm start
   ```
6. Open http://localhost:3000 and click **Connect a channel**.

Google will warn that the app isn't verified yet. That's expected for your own
project: click **Continue**, and tick both YouTube permission boxes.

`.env` and `data/` (the local database with your encrypted tokens) are ignored by
git. Never commit them.
