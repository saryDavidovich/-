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
//   ask+parenting@mail.yourdomain.com          -> שאלה חדשה לרשימת "הורות"
//   ads+parenting@mail.yourdomain.com          -> מודעת שורה חינם
//   adsplus+parenting@mail.yourdomain.com      -> מודעה מודגשת
//   adspremium+parenting@mail.yourdomain.com   -> מודעה פרימיום
//   topic+parenting@mail.yourdomain.com        -> נושא/מאמר חדש
//   reply+482@mail.yourdomain.com              -> תשובה לשאלה מספר 482
//   join+parenting@mail.yourdomain.com         -> הצטרפות לרשימה (לפי כתובת השולח)
//   leave+parenting@mail.yourdomain.com        -> הסרה מרשימה (לפי כתובת השולח)
//
// כל זה קורה בלי שום מגע ידני - הפריט פשוט נוחת בתור ההמתנה שלך לאישור.
// כל התהליך מתבסס על תגובות/שליחות מייל בלבד, כדי שגם לקוחות עם גישה
// מוגבלת לדפדפן (למשל "נטו מייל") יוכלו להשתמש בכל התכונות.
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

// פלטת צבעים בעברית - כך שלקוח שמפרסם מודעה מודגשת/פרימיום יכול לבקש צבע
// רקע בלי שום ממשק, רק בכתיבת שורה במייל עצמו (ראה extractRequestedColor).
const COLOR_NAMES = {
  'לבן': '#FFFFFF', 'שחור': '#111111', 'אדום': '#E4572E', 'ורוד': '#F7B2C4',
  'כתום': '#F2994A', 'צהוב': '#F6D860', 'ירוק': '#8FD19E', 'תכלת': '#A7D8F0',
  'כחול': '#5B8DEF', 'סגול': '#B48EF0', 'חום': '#B08968', 'אפור': '#C9C9C9',
  'קרם': '#FFF6E5', 'בז': '#F3E5D0'
};

// מחפשת שורה בנוסח "צבע: X" או "צבע רקע: X" בגוף המייל - X יכול להיות שם
// צבע בעברית (מהפלטה למעלה) או קוד hex (#A7D8F0 / A7D8F0). מחזירה את
// הצבע שנמצא ואת השורה המדויקת, כדי שאפשר יהיה להסיר אותה מהתוכן הגלוי.
function extractRequestedColor(text) {
  const match = String(text || '').match(/^[ \t]*צבע(?:[ \t]*רקע)?[ \t]*[:\-][ \t]*(.+)$/im);
  if (!match) return null;

  const raw = match[1].trim();
  const hexMatch = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (hexMatch) return { bg: '#' + hexMatch[1].toUpperCase(), matchedLine: match[0] };

  const cleaned = raw.replace(/[^\u05D0-\u05EA]/g, '');
  for (const [name, hex] of Object.entries(COLOR_NAMES)) {
    if (cleaned.includes(name)) return { bg: hex, matchedLine: match[0] };
  }
  return null;
}

// בוחרת אוטומטית טקסט לבן או כהה, לפי בהירות צבע הרקע שהתבקש - כדי
// שהטקסט תמיד יהיה קריא, גם אם הלקוח בחר רקע כהה.
function pickReadableTextColor(hexBg) {
  const hex = hexBg.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#2C2C2A' : '#FFFFFF';
}

router.post('/inbound', upload.any(), async (req, res) => {
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

    if (action === 'ask' || action === 'ads' || action === 'adsplus' || action === 'adspremium' || action === 'topic') {
      const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(extra);
      if (!list) {
        console.warn(`לא נמצאה רשימה פעילה עם slug="${extra}" (פעולה: ${action})`);
        return res.status(200).send('ignored: unknown list');
      }

      const typeMap = { ask: 'question', ads: 'ad', adsplus: 'ad', adspremium: 'ad', topic: 'article' };
      const tierMap = { ads: 'free', adsplus: 'plus', adspremium: 'premium' };
      const type = typeMap[action];
      const tier = tierMap[action] || 'free';

      // תמונה/גיף מצורפים למייל - נתמך רק בפרימיום (עקבי עם מה שכתוב
      // בהוראות שהלקוח קיבל בגיליון עצמו וגם בממשק הניהול).
      let attachedImages = [];
      if (type === 'ad' && tier === 'premium') {
        const { compressUploadedImage } = require('../imageProcessing');
        const imageFiles = (req.files || []).filter(f => /^image\//.test(f.mimetype));
        for (const f of imageFiles) {
          const finalPath = await compressUploadedImage(f.path);
          attachedImages.push(`/uploads/${path.basename(finalPath)}`);
        }
      }

      // בקשת צבע רקע דרך שורת טקסט ("צבע: כחול" וכו') - נתמך במודגשת
      // ובפרימיום. השורה עצמה מוסרת מהתוכן שיוצג בגיליון.
      let bodyText = text;
      let bgColor = null;
      let textColor = null;
      if (type === 'ad' && (tier === 'plus' || tier === 'premium')) {
        const colorRequest = extractRequestedColor(text);
        if (colorRequest) {
          bgColor = colorRequest.bg;
          textColor = pickReadableTextColor(colorRequest.bg);
          bodyText = text.replace(colorRequest.matchedLine, '').trim();
        }
      }

      const links = extractLinks(bodyText);

      db.prepare(`
        INSERT INTO items (list_id, type, status, from_email, subject, body_raw, word_count, paid_tier, images_json, links_json, bg_color, text_color)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(list.id, type, fromEmail, subject, bodyText, countWords(bodyText), tier, JSON.stringify(attachedImages), JSON.stringify(links), bgColor, textColor);

      console.log(`נקלט בהצלחה: ${type} (רמה: ${tier}${bgColor ? ', צבע: ' + bgColor : ''}${attachedImages.length ? ', ' + attachedImages.length + ' תמונות' : ''}) לרשימת "${list.name}" מאת ${fromEmail}`);
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

    // הצטרפות/הסרה דרך מייל בלבד - לא צריך שום קישור או טוקן, כתובת השולח
    // עצמה (from) היא מה שמזהה את המנוי. שימושי במיוחד למי שאין לו גישה
    // נוחה לדפדפן.
    if (action === 'join') {
      const list = db.prepare('SELECT * FROM lists WHERE slug = ? AND active = 1').get(extra);
      if (!list) {
        console.warn(`ניסיון הצטרפות לרשימה לא קיימת: slug="${extra}"`);
        return res.status(200).send('ignored: unknown list');
      }
      try {
        db.prepare(`INSERT INTO subscribers (list_id, email, confirmed, token) VALUES (?, ?, 1, ?)`)
          .run(list.id, fromEmail, require('uuid').v4());
        console.log(`הצטרפות חדשה במייל: ${fromEmail} לרשימת "${list.name}"`);
      } catch (e) {
        console.log(`${fromEmail} כבר רשום לרשימת "${list.name}" - לא נוצרה כפילות.`);
      }
      return res.status(200).send('joined');
    }

    if (action === 'leave') {
      const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(extra);
      if (!list) return res.status(200).send('ignored: unknown list');
      const result = db.prepare(`UPDATE subscribers SET unsubscribed = 1 WHERE list_id = ? AND email = ?`)
        .run(list.id, fromEmail);
      console.log(`הסרה במייל: ${fromEmail} מרשימת "${list.name}" (${result.changes} שורות עודכנו)`);
      return res.status(200).send('left');
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
