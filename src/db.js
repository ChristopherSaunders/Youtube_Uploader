// SQLite database. Shaped for many users from day one: every account and
// upload belongs to a user, and every query filters by user_id.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

// Node's built-in SQLite: nothing to compile, works the same on Windows/Mac/Linux.
const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub  TEXT UNIQUE,            -- Google account id; NULL for the local owner
    email       TEXT,
    name        TEXT,
    is_local_owner INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id       TEXT NOT NULL,
    channel_title    TEXT NOT NULL,
    channel_handle   TEXT,
    thumbnail_url    TEXT,
    encrypted_refresh_token TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    video_id    TEXT,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL,
    error       TEXT,
    warning     TEXT,
    publish_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Columns added after the first release, for databases created before them.
const uploadColumns = db.prepare('PRAGMA table_info(uploads)').all().map((column) => column.name);
for (const column of ['warning', 'publish_at']) {
  if (!uploadColumns.includes(column)) db.exec(`ALTER TABLE uploads ADD COLUMN ${column} TEXT`);
}

export default db;
