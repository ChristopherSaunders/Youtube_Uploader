import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import config from './config.js';
import authRoutes from './auth.js';
import apiRoutes from './api.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const app = express();
app.disable('x-powered-by');
if (config.appMode === 'hosted') app.set('trust proxy', 1);

// Memory session store is fine locally; Phase 6 moves sessions into the database.
app.use(
  session({
    name: 'ytu.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // must be lax so the cookie survives Google's redirect back
      secure: config.isHttps,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

app.use(express.json());
app.use(express.static(publicDir));
app.use(authRoutes);
app.use('/api', apiRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(config.port, () => {
  console.log(`YouTube Uploader running at ${config.baseUrl} (${config.appMode} mode)`);
});
