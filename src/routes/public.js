const express = require('express');
const router = express.Router();
const db = require('../db');

// דגל תכונה: כשתהיה מוכן להפעיל תשלום על תמונות/גיפים/קישורים,
// תשנה את זה ל-true בקובץ ה-.env (PAID_FEATURES_ENABLED=true) -
// אין צורך לגעת בקוד בכלל.
const PAID_FEATURES_ENABLED = process.env.PAID_FEATURES_ENABLED === 'true';
const FREE_WORD_LIMIT = parseInt(process.env.FREE_WORD_LIMIT || '40', 10);

function countWords(str = '') {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

router.get('/ads/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  res.render('ads/submit', { list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT, error: null, sent: false });
});

router.post('/ads/:slug', express.urlencoded({ extended: true }), (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const { email, subject, body } = req.body;
  const wc = countWords(body || '');

  if (wc > FREE_WORD_LIMIT) {
    return res.render('ads/submit', {
      list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT,
      error: `המודעה החינמית מוגבלת ל-${FREE_WORD_LIMIT} מילים (כרגע: ${wc}).`,
      sent: false
    });
  }

  db.prepare(`
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, paid_tier)
    VALUES (?, 'ad', 'pending', ?, ?, ?, ?, 'free')
  `).run(list.id, email, subject || '', body, wc);

  res.render('ads/submit', { list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT, error: null, sent: true });
});

// -------- הרשמה להצטרפות לרשימה --------
const { v4: uuidv4 } = require('uuid');

router.get('/subscribe/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  res.render('subscribe', { list, subscribed: false });
});

router.post('/subscribe/:slug', express.urlencoded({ extended: true }), (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).send('נא להזין מייל');

  try {
    db.prepare(`INSERT INTO subscribers (list_id, email, confirmed, token) VALUES (?, ?, 1, ?)`)
      .run(list.id, email, uuidv4());
  } catch (e) { /* כבר רשום - מתעלמים */ }

  res.render('subscribe', { list, subscribed: true });
});

// -------- הסרה מרשימה --------
router.get('/unsubscribe/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscribers WHERE token = ?').get(req.params.token);
  if (!sub) return res.status(404).send('קישור לא תקין');
  db.prepare('UPDATE subscribers SET unsubscribed = 1 WHERE id = ?').run(sub.id);
  res.send('הוסרת בהצלחה מרשימת התפוצה.');
});

module.exports = router;
