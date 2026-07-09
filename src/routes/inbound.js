const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const db = require('../db');

// -----------------------------------------------------------------------
// זהו הלב האוטומטי של המערכת. כתובת ה-webhook הזו מחוברת ל-SendGrid Inbound
// Parse. כל מייל שמגיע ל-domain שלך מנותב הנה, וה"פעולה" מזוהה לפי הכתובת
// אליה המייל נשלח (plus-addressing), למשל:
//
//   ask+parenting@mail.yourdomain.com     -> שאלה חדשה לרשימת "הורות"
//   ads+parenting@mail.yourdomain.com     -> מודעה חדשה ללוח של "הורות"
//   topic+parenting@mail.yourdomain.com   -> נושא/מאמר חדש לרשימת "הורות"
//   reply+482@mail.yourdomain.com         -> תשובה לשאלה מספר 482 (בכל רשימה)
//
// כל זה קורה בלי שום מגע ידני - הפריט פשוט נוחת בתור ההמתנה שלך לאישור.
// -----------------------------------------------------------------------

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

// שדה ה-"to" של SendGrid מגיע בפורמט כמו: "Name <ask+parenting@yourdomain.com>"
// או פשוט "ask+parenting@yourdomain.com", ולפעמים כמה כתובות מופרדות בפסיק.
function extractEmailAddresses(raw) {
  return String(raw || '')
    .split(',')
    .map(part => {
      const match = part.match(/<([^>]+)>/);
      return (match ? match[1] : part).trim();
    })
    .filter(Boolean);
}

function parseRecipient(address) {
  const match = address.match(/^([^+@]+)\+([^@]+)@/);
  if (!match) return null;
  return { action: match[1].toLowerCase(), extra: match[2].toLowerCase() };
}

// עוברים על כל הכתובות שהופיעו ב-to (יכול להיות יותר מאחת אם הלקוח הוסיף
// עותק/CC), ומחזירים את הראשונה שבאמת תואמת את הפורמט שלנו (action+extra@).
function findMatchingRecipient(toRaw) {
  const addresses = extractEmailAddresses(toRaw);
  for (const addr of addresses) {
    const parsed = parseRecipient(addr);
    if (parsed) return parsed;
  }
  return null;
}

function extractLinks(body) {
  return [...body.matchAll(/https?:\/\/\S+/gi)].map(m => m[0]);
}

router.post('/inbound', upload.any(), (req, res) => {
  try {
    const body = req.body || {};
    const fromAddresses = extractEmailAddresses(body.from || '');
    const fromEmail = (fromAddresses[0] || '').toLowerCase();
    const toRaw = body.to || '';
    const subject = body.subject || '';
    const text = body.text || '';

    // לוג מלא של כל מייל נכנס - חשוב לאבחון בעיות. תראה את זה ב-Railway logs.
    console.log('=== מייל נכנס ===', {
      to: toRaw, from: fromEmail, subject, textLength: text.length, filesCount: (req.files || []).length
    });

    const parsed = findMatchingRecipient(toRaw);
    if (!parsed) {
      console.warn('לא זוהתה כתובת יעד תואמת בשדה to:', toRaw);
      return res.status(200).send('ignored: unrecognized address');
    }

    const { action, extra } = parsed;

    const attachedImages = (req.files || [])
      .filter(f => /^image\//.test(f.mimetype))
      .map(f => `/uploads/${f.filename}`);

    if (action === 'ask' || action === 'ads' || action === 'topic') {
      const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(extra);
      if (!list) {
        console.warn(`לא נמצאה רשימה פעילה עם slug="${extra}" (פעולה: ${action})`);
        return res.status(200).send('ignored: unknown list');
      }

      const typeMap = { ask: 'question', ads: 'ad', topic: 'article' };
      const type = typeMap[action];
      const links = extractLinks(text);

      db.prepare(`
        INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, images_json, links_json)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(list.id, type, fromEmail, subject, text, countWords(text), JSON.stringify(attachedImages), JSON.stringify(links));

      console.log(`נקלט בהצלחה: ${type} לרשימת "${list.name}" מאת ${fromEmail}`);
      return res.status(200).send('queued');
    }

    if (action === 'reply') {
      const parentId = parseInt(extra, 10);
      const question = db.prepare('SELECT * FROM items WHERE id = ? AND type = ?').get(parentId, 'question');
      if (!question) {
        console.warn(`תגובה הגיעה לשאלה שלא נמצאה, מזהה=${parentId}`);
        return res.status(200).send('ignored: unknown question');
      }

      db.prepare(`
        INSERT INTO items (list_id, type, parent_id, status, from_email, subject, body_raw, word_count)
        VALUES (?, 'answer', ?, 'pending', ?, ?, ?, ?)
      `).run(question.list_id, question.id, fromEmail, subject, text, countWords(text));

      console.log(`תגובה נקלטה בהצלחה לשאלה #${question.id} מאת ${fromEmail}`);
      return res.status(200).send('queued');
    }

    console.warn(`פעולה לא מוכרת: "${action}"`);
    return res.status(200).send('ignored: unknown action');

  } catch (err) {
    // חשוב מאוד: תמיד מחזירים 200 גם בשגיאה, אחרת SendGrid ינסה לשלוח שוב
    // ושוב ועלול לחסום את הכתובת שלנו. הטעות מתועדת ביומן לבדיקה.
    console.error('שגיאה בטיפול במייל נכנס:', err);
    return res.status(200).send('error logged');
  }
});

module.exports = router;
