const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'newsletter.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#1D9E75',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  confirmed INTEGER DEFAULT 0,
  unsubscribed INTEGER DEFAULT 0,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(list_id, email)
);

-- items = questions, answers, and classified ads. one unified table so the
-- approval queue and the weekly compiler can treat them uniformly.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('question','answer','ad')),
  parent_id INTEGER REFERENCES items(id), -- answer -> points to its question
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','sent')),
  from_email TEXT,
  subject TEXT DEFAULT '',
  body_raw TEXT DEFAULT '',
  body_edited TEXT,
  word_count INTEGER DEFAULT 0,
  paid_tier TEXT DEFAULT 'free' CHECK(paid_tier IN ('free','plus','premium')),
  images_json TEXT DEFAULT '[]',
  links_json TEXT DEFAULT '[]',
  issue_id INTEGER REFERENCES issues(id),
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  html TEXT,
  sent_at TEXT,
  recipient_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','failed')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_list_status ON items(list_id, status);
CREATE INDEX IF NOT EXISTS idx_subscribers_list ON subscribers(list_id);
`);

module.exports = db;
