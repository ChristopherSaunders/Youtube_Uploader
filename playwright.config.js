// End-to-end tests: the real app in a real browser, with Google and YouTube
// faked by tests/e2e/fake-google-server.js. Run with: npm run test:e2e
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100; // not 3000, so it never collides with the app you're using
const baseURL = `http://localhost:${PORT}`;
const scratch = path.join(os.tmpdir(), 'youtube-uploader-e2e');

export default defineConfig({
  testDir: 'tests/e2e',
  // One shared fake YouTube, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Lets an environment with a preinstalled Chromium use it.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning tests/e2e/fake-google-server.js',
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    env: {
      ...process.env,
      APP_MODE: 'local',
      PORT: String(PORT),
      BASE_URL: baseURL,
      GOOGLE_CLIENT_ID: 'e2e-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-e2e-test',
      SESSION_SECRET: 'e2e-session-secret',
      TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
      DATABASE_PATH: path.join(scratch, 'data', 'app.db'),
      UPLOAD_TEMP_DIR: path.join(scratch, 'uploads'),
      MAX_UPLOAD_MB: '50',
    },
  },
});
