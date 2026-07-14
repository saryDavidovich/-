const db = require('./db');

const getStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const setStmt = db.prepare(`
  INSERT INTO app_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

function getSetting(key, fallback = '') {
  const row = getStmt.get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}

function setSetting(key, value) {
  setStmt.run(key, value == null ? '' : String(value));
}

function getAllSettings() {
  return db.prepare('SELECT key, value FROM app_settings').all()
    .reduce((acc, row) => { acc[row.key] = row.value; return acc; }, {});
}

module.exports = { getSetting, setSetting, getAllSettings };
