// SQLite через встроенный node:sqlite (Node 22.5+), без нативных зависимостей
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || path.join(dir, 'geoguess.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sub TEXT UNIQUE NOT NULL,
    qv TEXT,
    name TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,           -- sid сессии, которая играет
    user_id INTEGER,               -- null для гостя
    time_limit INTEGER NOT NULL DEFAULT 0,
    rounds TEXT NOT NULL,          -- JSON: [{lat,lng,pano,cc}] — ответы живут только тут
    guesses TEXT NOT NULL DEFAULT '[]',
    current INTEGER NOT NULL DEFAULT 0,
    started INTEGER NOT NULL,      -- когда показан текущий раунд
    finished INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_lb ON games (finished, total DESC);
`);
// поле ranked добавили позже — для уже существующей базы
try { db.exec('ALTER TABLE games ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0'); } catch { /* уже есть */ }

// чистим старьё: сессии гостей и брошенные игры
export function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE updated < ?').run(now - 30 * 86400_000);
  db.prepare('DELETE FROM games WHERE finished = 0 AND created < ?').run(now - 2 * 86400_000);
}
cleanup();
setInterval(cleanup, 6 * 3600_000).unref();
