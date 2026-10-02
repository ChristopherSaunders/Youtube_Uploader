import db from './db.js';
import config from './config.js';

function getOrCreateLocalOwner() {
  const existing = db.prepare('SELECT * FROM users WHERE is_local_owner = 1').get();
  if (existing) return existing;
  const { lastInsertRowid } = db
    .prepare("INSERT INTO users (name, is_local_owner) VALUES ('Local owner', 1)")
    .run();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
}

// Locally there is one user (you), signed in automatically. When hosted,
// a real "Sign in with Google" login is required (added in Phase 6).
export function requireUser(req, res, next) {
  if (config.appMode === 'local') {
    req.user = getOrCreateLocalOwner();
    return next();
  }

  const user = req.session.userId
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
}
