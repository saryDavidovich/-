const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// דגל תכונה: כשתהיה מוכן להפעיל תשלום על תמונות/גיפים/קישורים,
// תשנה את זה ל-true בקובץ ה-.env (PAID_FEATURES_ENABLED=true) -
// אין צורך לגעת בקוד בכלל.
const PAID_FEATURES_ENABLED = process.env.PAID_FEATURES_ENABLED === 'true';
const FREE_WORD_LIMIT = parseInt(process.env.FREE_WORD_LIMIT || '40', 10);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeExt = (path.extname(file.originalname) || '').slice(0, 10);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const upload = multer({ storage });

function countWords(str = '') {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function validTier(t) {
  return ['free', 'plus', 'premium'].includes(t) ? t : 'free';
}

// -------- פרסום מודעה --------
router.get('/ads/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  const requestedTier = validTier(req.query.tier);
  res.render('ads/submit', {
    list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT,
    requestedTier, error: null, sent: false
  });
});

router.post('/ads/:slug', upload.single('image'), async (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const { email, subject, body, bg_color, text_color } = req.body;
  const tier = validTier(req.body.paid_tier);
  const wc = countWords(body || '');

  // מגבלת המילים חלה רק על המודעה החינמית - מודעות מודגשות/פרימיום
  // (כשיופעלו בתשלום) לא כפופות למגבלה הזו.
  if (tier === 'free' && wc > FREE_WORD_LIMIT) {
    return res.render('ads/submit', {
      list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT, requestedTier: tier,
      error: `המודעה החינמית מוגבלת ל-${FREE_WORD_LIMIT} מילים (כרגע: ${wc}).`,
      sent: false
    });
  }

  try {
    let images = [];
    if (PAID_FEATURES_ENABLED && tier === 'premium' && req.file) {
      const { compressUploadedImage } = require('../imageProcessing');
      const finalPath = await compressUploadedImage(req.file.path);
      images = [`/uploads/${path.basename(finalPath)}`];
    }
    const useStyle = PAID_FEATURES_ENABLED && (tier === 'plus' || tier === 'premium');

    db.prepare(`
      INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, paid_tier, images_json, bg_color, text_color)
      VALUES (?, 'ad', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      list.id, email, subject || '', body, wc, tier, JSON.stringify(images),
      useStyle ? (bg_color || null) : null, useStyle ? (text_color || null) : null
    );

    res.render('ads/submit', { list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT, requestedTier: tier, error: null, sent: true });
  } catch (err) {
    console.error('שגיאה בפרסום מודעה מהלקוח:', err);
    res.render('ads/submit', {
      list, paidEnabled: PAID_FEATURES_ENABLED, wordLimit: FREE_WORD_LIMIT, requestedTier: tier,
      error: 'אירעה שגיאה בשליחת המודעה. נסה שוב, אולי בלי תמונה.',
      sent: false
    });
  }
});

// -------- פרסום נושא/מאמר (מהלקוח, בלי מייל) --------
router.get('/topics/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  res.render('topics/submit', { list, error: null, sent: false });
});

router.post('/topics/:slug', express.urlencoded({ extended: true }), (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const { email, subject, body } = req.body;
  const wc = countWords(body || '');

  db.prepare(`
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count)
    VALUES (?, 'article', 'pending', ?, ?, ?, ?)
  `).run(list.id, email, subject || '', body, wc);

  res.render('topics/submit', { list, error: null, sent: true });
});

// -------- הרשמה להצטרפות לרשימה --------
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
    const result = db.prepare(`INSERT INTO subscribers (list_id, email, confirmed, token) VALUES (?, ?, 1, ?)`)
      .run(list.id, email, uuidv4());
    console.log(`מנוי חדש נרשם: ${email} לרשימה "${list.name}" (list_id=${list.id}), שורה חדשה מספר ${result.lastInsertRowid}`);
  } catch (e) {
    // רק שגיאת "כבר רשום" (UNIQUE constraint) מתעלמים ממנה בשקט - כל שגיאה
    // אחרת היא בעיה אמיתית שצריך לדעת עליה, לא להסתיר.
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/.test(e.message)) {
      console.log(`מנוי כבר קיים: ${email} לרשימה "${list.name}" - לא נוצרה שורה כפולה.`);
    } else {
      console.error(`שגיאה אמיתית בהרשמת מנוי ${email} לרשימה "${list.name}":`, e);
      return res.status(500).send('אירעה שגיאה בהרשמה. נסה שוב מאוחר יותר.');
    }
  }

  res.render('subscribe', { list, subscribed: true });
});

// -------- הסרה מרשימה --------
router.get('/unsubscribe/:token', (req, res) => {
  const sub = db.prepare('SELECT * FROM subscribers WHERE token = ?').get(req.params.token);
  if (!sub) return res.status(404).send('קישור לא תקין');
  db.prepare('UPDATE subscribers SET unsubscribed = 1 WHERE id = ?').run(sub.id);
  res.send('הוסרת בהצלחה מרשימת התפוצה.');
});

// -------- ארכיון ציבורי - הלקוחות יכולים לראות גיליונות עבר --------
router.get('/archive/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const { formatIsraelDateTime } = require('../timeUtil');
  const issues = db.prepare(`
    SELECT id, sent_at FROM issues WHERE list_id = ? AND status = 'sent' ORDER BY sent_at DESC
  `).all(list.id).map(issue => ({ ...issue, sent_at_display: formatIsraelDateTime(issue.sent_at) }));

  res.render('archive_list', { list, issues });
});

router.get('/archive/:slug/:issueId', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!list) return res.status(404).send('רשימה לא נמצאה');
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND list_id = ? AND status = ?').get(req.params.issueId, list.id, 'sent');
  if (!issue) return res.status(404).send('גיליון לא נמצא');
  res.send(issue.html);
});

module.exports = router;
