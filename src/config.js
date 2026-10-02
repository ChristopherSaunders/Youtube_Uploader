// All environment-specific settings live here so the same code runs locally
// and, later, hosted online. Nothing else should read process.env directly.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const required = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'TOKEN_ENCRYPTION_KEY',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(
    `Missing settings in .env: ${missing.join(', ')}\n` +
      'Copy .env.example to .env, fill in your Google client ID/secret, ' +
      'and run "npm run keygen" to generate the two secrets.',
  );
  process.exit(1);
}

if (!process.env.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
  console.error(
    'GOOGLE_CLIENT_ID looks wrong: it should end with ".apps.googleusercontent.com".\n' +
      'Copy the "Client ID" (not the secret or project ID) from ' +
      'https://console.cloud.google.com/auth/clients',
  );
  process.exit(1);
}

if (!process.env.GOOGLE_CLIENT_SECRET.startsWith('GOCSPX-')) {
  console.warn('Warning: GOOGLE_CLIENT_SECRET usually starts with "GOCSPX-". Double-check it in .env.');
}

const encryptionKey = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'hex');
if (encryptionKey.length !== 32) {
  console.error('TOKEN_ENCRYPTION_KEY must be 64 hex characters. Run "npm run keygen".');
  process.exit(1);
}

const appMode = process.env.APP_MODE || 'local';
if (!['local', 'hosted'].includes(appMode)) {
  console.error('APP_MODE must be "local" or "hosted".');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 20480;
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');

export default {
  appMode,
  port,
  baseUrl,
  isHttps: baseUrl.startsWith('https://'),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: `${baseUrl}/auth/callback`,
  sessionSecret: process.env.SESSION_SECRET,
  encryptionKey,
  databasePath: process.env.DATABASE_PATH || 'data/app.db',
  maxUploadMb,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
};
