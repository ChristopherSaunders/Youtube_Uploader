import config from './config.js';
import app from './app.js';

// Express 5 calls this on startup errors too, not just on success.
const server = app.listen(config.port, (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. YouTube Uploader is probably already running:\n` +
        `open ${config.baseUrl} in your browser, or close the other window first.`,
    );
    process.exit(1);
  }
  if (err) throw err;
  console.log(`YouTube Uploader running at ${config.baseUrl} (${config.appMode} mode)`);
});

// Node cuts off requests after 5 minutes by default; big videos take longer.
server.requestTimeout = 0;
