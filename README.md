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

**Windows shortcut:** after the first setup, double-click `start.bat` to start the
app and open it in your browser. Close its window to stop the app. To put it on
your desktop: right-click `start.bat` → **Show more options** → **Send to** →
**Desktop (create shortcut)**.

Google will warn that the app isn't verified yet. That's expected for your own
project: click **Continue**, and tick both YouTube permission boxes.

`.env` and `data/` (the local database with your encrypted tokens) are ignored by
git. Never commit them.

## Tests

End-to-end tests drive the real app in a browser with [Playwright](https://playwright.dev).
Google sign-in and YouTube are faked (`tests/e2e/fake-google-server.js`), so tests never
touch a real channel or use upload quota.

```sh
npx playwright install chromium   # once
npm test                          # lint + end-to-end tests
npm run test:e2e -- --ui          # watch the tests run, step by step
```

## CI/CD

GitHub Actions (`.github/workflows/`):

- **CI** runs on every push and pull request: lint, a security audit of the app's
  dependencies, and the end-to-end tests on Linux and Windows with Node 22 and 24.
  If tests fail, the Playwright report is attached to the run.
- **Release** runs when you push a version tag. It runs CI, then publishes a GitHub
  Release with a zip of the app. To release:
  1. Update `"version"` in `package.json` (e.g. `0.2.0`) and commit it.
  2. `git tag v0.2.0` then `git push origin v0.2.0`

  Deploying to a server will be added here once the app is hosted (PLAN.md Phase 6).

