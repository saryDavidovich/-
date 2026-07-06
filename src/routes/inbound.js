const express = require('express');
const router = express.Router();
const db = require('../db');

// -----------------------------------------------------------------------
// זהו הלב האוטומטי של המערכת. כתובת ה-webhook הזו מחוברת לספק המייל שלך
// (Mailgun / Postmark / SendGrid - כולם שולחים בפורמט form-encoded דומה).
// כל מייל שמגיע ל-domain שלך מנותב הנה, והשם מזהה את עצמו לפי הכתובת אליה
// הוא נשלח (plus-addressing), למשל:
//
//   ask+parenting@yourdomain.com     -> שאלה חדשה לרשימת "הורות"
//   ads+parenting@yourdomain.com     -> מודעה חדשה ללוח של "הורות"
//   reply+482@yourdomain.com         -> תשובה לשאלה מספר 482 (בכל רשימה)
//
// כל זה קורה בלי שום מגע ידני - הפריט פשוט נוחת בתור ההמתנה שלך לאישור.
// -----------------------------------------------------------------------

function countWords(str = '') {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function parseRecipient(rawTo) {
  // מצפה לכתובת מהצורה local+extra@domain
  const match = String(rawTo).match(/^([^+@]+)\+([^@]+)@/);
  if (!match) return null;
  return { action: match[1].toLowerCase(), extra: match[2].toLowerCase() };
}

function extractAttachmentUrls(body) {
  // ספקי מייל שולחים attachment-count + attachment-1 וכו' כקבצים בפועל
  // (multipart). לצורך הפרוטוטייפ אנחנו קולטים קישורי תמונה שמופיעים
  // בגוף ההודעה עצמה; כשתפעיל את שכבת התשלום, תרחיב את זה לקליטת
  // הקבצים המצורפים ולהעלאתם לאחסון (S3 / Cloudinary) ולשמור שם את ה-URL.
  const urls = [...body.matchAll(/https?:\/\/\S+\.(?:png|jpe?g|gif)\b/gi)].map(m => m[0]);
  return urls;
}

function extractLinks(body) {
  return [...body.matchAll(/https?:\/\/\S+/gi)]
    .map(m => m[0])
    .filter(u => !/\.(png|jpe?g|gif)$/i.test(u));
}

router.post('/inbound', express.urlencoded({ extended: true }), (req, res) => {
  // התאם את שמות השדות לפורמט של הספק שתבחר. הדוגמה כאן היא בפורמט Mailgun.
  const body = req.body || {};
  const fromEmail = (body.sender || body.from || '').toLowerCase().trim();
  const toRaw = body.recipient || body.to || '';
  const subject = body.subject || '';
  const text = body['body-plain'] || body.text || '';

  const parsed = parseRecipient(toRaw);
  if (!parsed) {
    console.warn('לא זוהתה כתובת יעד תקינה:', toRaw);
    return res.status(200).send('ignored: unrecognized address');
  }

  const { action, extra } = parsed;

  if (action === 'ask' || action === 'ads') {
    const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(extra);
    if (!list) return res.status(200).send('ignored: unknown list');

    const type = action === 'ask' ? 'question' : 'ad';
    const images = extractAttachmentUrls(text);
    const links = extractLinks(text);

    db.prepare(`
      INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, images_json, links_json)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(list.id, type, fromEmail, subject, text, countWords(text), JSON.stringify(images), JSON.stringify(links));

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
