const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db');

// -----------------------------------------------------------------------
// זהו הלב האוטומטי של המערכת. כתובת ה-webhook הזו מחוברת ל-SendGrid Inbound
// Parse. כל מייל שמגיע ל-domain שלך מנותב הנה, וה"פעולה" מזוהה לפי הכתובת
// אליה המייל נשלח (plus-addressing), למשל:
//
//   ask+parenting@yourdomain.com     -> שאלה חדשה לרשימת "הורות"
//   ads+parenting@yourdomain.com     -> מודעה חדשה ללוח של "הורות"
//   reply+482@yourdomain.com         -> תשובה לשאלה מספר 482 (בכל רשימה)
//
// כל זה קורה בלי שום מגע ידני - הפריט פשוט נוחת בתור ההמתנה שלך לאישור.
//
// חשוב: SendGrid Inbound Parse שולח את הבקשה כ-multipart/form-data (כדי
// לתמוך גם בקבצים מצורפים), ולא כ-form-urlencoded כמו ספקים אחרים. משתמשים
// כאן ב-multer כדי לפרסר את זה נכון.
// -----------------------------------------------------------------------

const upload = multer(); // שומר קבצים מצורפים בזיכרון; לא נוגעים בהם עדיין

function countWords(str = '') {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

// שדה ה-"to" של SendGrid מגיע בפורמט כמו: "Name <ask+parenting@yourdomain.com>"
// או פשוט "ask+parenting@yourdomain.com" - שולפים רק את הכתובת עצמה.
function extractEmailAddress(raw) {
  const match = String(raw).match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function parseRecipient(rawTo) {
  const address = extractEmailAddress(rawTo);
  const match = address.match(/^([^+@]+)\+([^@]+)@/);
  if (!match) return null;
  return { action: match[1].toLowerCase(), extra: match[2].toLowerCase() };
}

function extractLinks(body) {
  return [...body.matchAll(/https?:\/\/\S+/gi)].map(m => m[0]);
}

router.post('/inbound', upload.any(), (req, res) => {
  const body = req.body || {};
  const fromEmail = extractEmailAddress(body.from || '').toLowerCase();
  const toRaw = body.to || '';
  const subject = body.subject || '';
  const text = body.text || '';

  const parsed = parseRecipient(toRaw);
  if (!parsed) {
    console.warn('לא זוהתה כתובת יעד תקינה:', toRaw);
    return res.status(200).send('ignored: unrecognized address');
  }

  const { action, extra } = parsed;

  // קבצים מצורפים בפועל (תמונות/גיפים) מגיעים ב-req.files כשSendGrid שולח
  // אותם כ-multipart. כרגע (שכבת התשלום עוד לא פעילה) רק סופרים אותם -
  // כשתפעיל תשלום, כאן תוסיף העלאה ל-S3/Cloudinary ותשמור את ה-URL שיתקבל.
  const attachedImageNames = (req.files || [])
    .filter(f => /^image\//.test(f.mimetype))
    .map(f => f.originalname);

  if (action === 'ask' || action === 'ads') {
    const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(extra);
    if (!list) return res.status(200).send('ignored: unknown list');

    const type = action === 'ask' ? 'question' : 'ad';
    const links = extractLinks(text);

    db.prepare(`
      INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, images_json, links_json)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(list.id, type, fromEmail, subject, text, countWords(text), JSON.stringify(attachedImageNames), JSON.stringify(links));

    return res.status(200).send('queued');
  }

  if (action === 'reply') {
    const parentId = parseInt(extra, 10);
    const question = db.prepare('SELECT * FROM items WHERE id = ? AND type = ?').get(parentId, 'question');
    if (!question) return res.status(200).send('ignored: unknown question');

    db.prepare(`
      INSERT INTO items (list_id, type, parent_id, status, from_email, subject, body_raw, word_count)
      VALUES (?, 'answer', ?, 'pending', ?, ?, ?, ?)
    `).run(question.list_id, question.id, fromEmail, subject, text, countWords(text));

    return res.status(200).send('queued');
  }

  return res.status(200).send('ignored: unknown action');
});

module.exports = router;
