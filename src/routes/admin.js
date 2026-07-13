const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { renderIssue } = require('../templates');
const { getOrderedApprovedEntries, nextManualOrder, saveManualOrder, getIssueSizeInfo, describeEntry } = require('../issueBuilder');

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

function getAllLists() {
  return db.prepare('SELECT * FROM lists ORDER BY created_at DESC').all();
}

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

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'סיסמה שגויה' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// -------- Dashboard --------
router.get('/', requireAuth, (req, res) => {
  const lists = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM items WHERE list_id = l.id AND status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM subscribers WHERE list_id = l.id AND unsubscribed = 0) AS subscriber_count
    FROM lists l ORDER BY l.created_at DESC
  `).all();
  const flash = req.session.flash || null;
  delete req.session.flash;
  const inboundDomain = process.env.INBOUND_DOMAIN || 'yourdomain.com';
  res.render('admin/dashboard', { lists, flash, inboundDomain, allLists: lists });
});

// -------- Lists (topics) management --------
router.get('/lists/new', requireAuth, (req, res) => {
  res.render('admin/list_form', { list: null, allLists: getAllLists() });
});

router.post('/lists/new', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const { slug, name, description, accent_color } = req.body;
  db.prepare(`INSERT INTO lists (slug, name, description, accent_color) VALUES (?, ?, ?, ?)`)
    .run(slug.trim().toLowerCase(), name.trim(), description || '', accent_color || '#1D9E75');
  res.redirect('/admin');
});

router.post('/lists/:id/toggle', requireAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (list) db.prepare('UPDATE lists SET active = ? WHERE id = ?').run(list.active ? 0 : 1, list.id);
  res.redirect('/admin');
});

function loadListOr404(req, res) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id || req.params.listId);
  if (!list) { res.status(404).send('רשימה לא נמצאה'); return null; }
  return list;
}

// -------- Approval queue --------
router.get('/lists/:id/queue', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const pendingQuestions = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' AND type = 'question' ORDER BY created_at ASC
  `).all(list.id);
  const pendingAds = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' AND type = 'ad' ORDER BY created_at ASC
  `).all(list.id);
  const pendingTopics = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' AND type = 'article' ORDER BY created_at ASC
  `).all(list.id);
  const pendingAnswers = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' AND type = 'answer' ORDER BY created_at ASC
  `).all(list.id);

  const pendingQuestionIds = new Set(pendingQuestions.map(q => q.id));

  // תשובות ששייכות לשאלה שעדיין ממתינה - מקוננות תחתיה כרגיל
  const questionItems = pendingQuestions.map(q => ({
    ...q,
    pendingAnswers: pendingAnswers.filter(a => a.parent_id === q.id)
  }));

  // תשובות ששייכות לשאלה שכבר אושרה/נשלחה בעבר - אלה היו "נעלמות" קודם כי
  // לא היה להן מקום להופיע בתור. מציגים אותן כפריט עצמאי, עם ציטוט השאלה
  // המקורית לצורך הקשר.
  const orphanAnswers = pendingAnswers
    .filter(a => !pendingQuestionIds.has(a.parent_id))
    .map(a => {
      const parentQuestion = db.prepare('SELECT * FROM items WHERE id = ?').get(a.parent_id);
      return { ...a, type: 'answer_standalone', parentQuestion };
    });

  const items = [...questionItems, ...pendingTopics, ...pendingAds, ...orphanAnswers]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  res.render('admin/queue', {
    list, items, allLists: getAllLists(),
    testSendResult: req.query.test_sent ? 'הגיליון נשלח לבדיקה בהצלחה.' : null,
    testSendError: req.query.test_error || null
  });
});

router.post('/items/:id/approve', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('לא נמצא');

  const editedBody = req.body.body_edited;
  const editedSubject = req.body.subject;
  const paidTier = req.body.paid_tier || item.paid_tier;

  db.prepare(`
    UPDATE items SET status = 'approved', body_edited = ?, subject = ?, paid_tier = ?, approved_at = datetime('now'), manual_order = ?
    WHERE id = ?
  `).run(editedBody, editedSubject, paidTier, nextManualOrder(item.list_id), item.id);

  res.redirect(`/admin/lists/${item.list_id}/queue`);
});

// -------- אישור מודעה - טופס נפרד (multipart) כי רק למודעה יש צבע/תמונה.
// שומרת תמונה שהגיעה כבר כקובץ מצורף במייל הנכנס (ראה inbound.js) אם לא
// הועלתה תמונה חדשה כאן - רק אם הרמה עדיין פרימיום. אם הרמה שונתה
// לחינם/מודגשת, התמונה (אם הייתה) מוסרת כי רק פרימיום תומכת בתמונה. --------
router.post('/items/:id/approve-ad', requireAuth, upload.single('image'), async (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('לא נמצא');

  const editedBody = req.body.body_edited;
  const editedSubject = req.body.subject;
  const paidTier = req.body.paid_tier || item.paid_tier;
  const useColor = paidTier === 'plus' || paidTier === 'premium';

  let images = paidTier === 'premium' ? JSON.parse(item.images_json || '[]') : [];
  if (req.file && paidTier === 'premium') {
    const { compressUploadedImage } = require('../imageProcessing');
    const finalPath = await compressUploadedImage(req.file.path);
    images = [`/uploads/${path.basename(finalPath)}`];
  }

  db.prepare(`
    UPDATE items SET status = 'approved', body_edited = ?, subject = ?, paid_tier = ?, images_json = ?, bg_color = ?, text_color = ?, approved_at = datetime('now'), manual_order = ?
    WHERE id = ?
  `).run(
    editedBody, editedSubject, paidTier, JSON.stringify(images),
    useColor ? (req.body.bg_color || null) : null, useColor ? (req.body.text_color || null) : null,
    nextManualOrder(item.list_id), item.id
  );

  res.redirect(`/admin/lists/${item.list_id}/queue`);
});

router.post('/items/:id/reject', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('לא נמצא');
  db.prepare(`UPDATE items SET status = 'rejected' WHERE id = ?`).run(item.id);
  res.redirect(`/admin/lists/${item.list_id}/queue`);
});

// -------- כתיבת שו"ת ישירות (בלי מייל) --------
router.get('/lists/:id/compose/qa', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  res.render('admin/compose_qa', { list, allLists: getAllLists() });
});

router.post('/lists/:id/compose/qa', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const { subject, question_body, answer_body } = req.body;
  const wc = (question_body || '').trim().split(/\s+/).filter(Boolean).length;

  const q = db.prepare(`
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, body_edited, word_count, approved_at, manual_order)
    VALUES (?, 'question', 'approved', 'admin', ?, ?, ?, ?, datetime('now'), ?)
  `).run(list.id, subject, question_body, question_body, wc, nextManualOrder(list.id));

  if (answer_body && answer_body.trim()) {
    const awc = answer_body.trim().split(/\s+/).filter(Boolean).length;
    db.prepare(`
      INSERT INTO items (list_id, type, parent_id, status, from_email, body_raw, body_edited, word_count, approved_at)
      VALUES (?, 'answer', ?, 'approved', 'admin', ?, ?, ?, datetime('now'))
    `).run(list.id, q.lastInsertRowid, answer_body, answer_body, awc);
  }

  res.redirect(`/admin/lists/${list.id}/preview`);
});

// -------- כתיבת נושא/מאמר ישירות (בלי שאלה-תשובה) --------
router.get('/lists/:id/compose/topic', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  res.render('admin/compose_topic', { list, allLists: getAllLists() });
});

router.post('/lists/:id/compose/topic', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const { subject, body } = req.body;
  const wc = (body || '').trim().split(/\s+/).filter(Boolean).length;

  db.prepare(`
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, body_edited, word_count, approved_at, manual_order)
    VALUES (?, 'article', 'approved', 'admin', ?, ?, ?, ?, datetime('now'), ?)
  `).run(list.id, subject || '', body, body, wc, nextManualOrder(list.id));

  res.redirect(`/admin/lists/${list.id}/preview`);
});

// -------- כתיבת מודעה ישירות (בלי מייל), כולל תמונה/גיף וצבעים --------
router.get('/lists/:id/compose/ad', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  res.render('admin/compose_ad', { list, allLists: getAllLists() });
});

router.post('/lists/:id/compose/ad', requireAuth, upload.single('image'), async (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  try {
    const { subject, body, paid_tier, bg_color, text_color } = req.body;
    const wc = (body || '').trim().split(/\s+/).filter(Boolean).length;
    const useStyle = paid_tier === 'plus' || paid_tier === 'premium';

    let images = [];
    if (req.file && paid_tier === 'premium') {
      const { compressUploadedImage } = require('../imageProcessing');
      const finalPath = await compressUploadedImage(req.file.path);
      images = [`/uploads/${path.basename(finalPath)}`];
    }

    db.prepare(`
      INSERT INTO items (list_id, type, status, from_email, subject, body_raw, body_edited, word_count, paid_tier, images_json, bg_color, text_color, approved_at, manual_order)
      VALUES (?, 'ad', 'approved', 'admin', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).run(
      list.id, subject || '', body, body, wc, paid_tier || 'free', JSON.stringify(images),
      useStyle ? (bg_color || null) : null, useStyle ? (text_color || null) : null, nextManualOrder(list.id)
    );

    res.redirect(`/admin/lists/${list.id}/preview`);
  } catch (err) {
    console.error('שגיאה בכתיבת מודעה ישירה:', err);
    res.status(500).send('אירעה שגיאה בשמירת המודעה. נסה שוב, ואם הבעיה חוזרת, נסה בלי תמונה כדי לבודד את הבעיה.');
  }
});

// -------- שליחת ניסיון לגיליון הבא - למייל אחד, בלי לגעת בהיסטוריה --------
router.post('/lists/:id/test-send', requireAuth, express.urlencoded({ extended: true }), async (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const to = (req.body.to || '').trim();
  if (!to) return res.redirect(`/admin/lists/${list.id}/queue?test_error=${encodeURIComponent('נא להזין כתובת מייל.')}`);

  try {
    const { sendTestIssue } = require('../compiler');
    await sendTestIssue(list, to);
    res.redirect(`/admin/lists/${list.id}/queue?test_sent=1`);
  } catch (err) {
    console.error('שגיאה בשליחת ניסיון:', err);
    res.redirect(`/admin/lists/${list.id}/queue?test_error=${encodeURIComponent(err.message || 'שגיאה בשליחה.')}`);
  }
});

// -------- תצוגה מקדימה חיה --------
router.get('/lists/:id/preview', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const entries = getOrderedApprovedEntries(list.id);
  const html = renderIssue({ list, entries, unsubscribeToken: 'preview' });
  res.send(html);
});

// -------- פאנל צד: רשימת פריטים לגרירה + מד גודל (נטען כ-fragment בתוך
// התצוגה המקדימה החיה, לא עמוד בפני עצמו) --------
router.get('/lists/:id/preview-panel', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const entries = getOrderedApprovedEntries(list.id);
  const outlineItems = entries.map(describeEntry);
  const size = getIssueSizeInfo(list);
  res.render('admin/partials/preview_panel', { list, outlineItems, size });
});

// -------- שמירת סדר חדש אחרי גרירה בתצוגה המקדימה --------
router.post('/lists/:id/reorder', requireAuth, express.json(), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const orderedIds = Array.isArray(req.body.order) ? req.body.order.map(Number).filter(Boolean) : [];
  saveManualOrder(list.id, orderedIds);
  res.json({ ok: true });
});

// -------- הגדרות רשימה --------
router.get('/lists/:id/settings', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  let palette = [];
  try { palette = JSON.parse(list.ad_color_palette_json || '[]'); } catch (e) { palette = []; }
  res.render('admin/settings', { list, allLists: getAllLists(), palette });
});

router.post('/lists/:id/settings', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const { name, description, accent_color, show_ad_buttons, show_ask_button, send_day, send_hour, send_minute } = req.body;

  // בונים את הפלטה מתוך שני מערכים מקבילים (color_name[] / color_hex[]) -
  // מתעלמים משורות ריקות (שם ריק, למשל אם הוסיפו שורה ולא מילאו אותה).
  const names = [].concat(req.body.color_name || []);
  const hexes = [].concat(req.body.color_hex || []);
  const palette = names
    .map((name, i) => ({ name: (name || '').trim(), hex: hexes[i] || '#FFFFFF' }))
    .filter(c => c.name);

  db.prepare(`
    UPDATE lists SET name = ?, description = ?, accent_color = ?, show_ad_buttons = ?, show_ask_button = ?,
      send_day = ?, send_hour = ?, send_minute = ?, ad_color_palette_json = ?
    WHERE id = ?
  `).run(
    name.trim(), description || '', accent_color || list.accent_color,
    show_ad_buttons ? 1 : 0, show_ask_button ? 1 : 0,
    parseInt(send_day, 10) || 0, parseInt(send_hour, 10) || 0, parseInt(send_minute, 10) || 0,
    JSON.stringify(palette), list.id
  );

  res.redirect(`/admin/lists/${list.id}/settings`);
});

// -------- מנויים --------
router.get('/lists/:id/subscribers', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  const { formatIsraelDateTime } = require('../timeUtil');
  const subscribers = db.prepare(`
    SELECT * FROM subscribers WHERE list_id = ? AND unsubscribed = 0 ORDER BY created_at DESC
  `).all(list.id).map(sub => ({ ...sub, created_at_display: formatIsraelDateTime(sub.created_at) }));
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/subscribers', { list, subscribers, allLists: getAllLists(), flash });
});

router.post('/lists/:id/subscribers/add', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  const email = (req.body.email || '').toLowerCase().trim();
  if (email) {
    const { subscribeEmail } = require('../subscriberUtil');
    subscribeEmail(list.id, email);
  }
  res.redirect(`/admin/lists/${list.id}/subscribers`);
});

router.post('/lists/:id/subscribers/:subId/remove', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  db.prepare(`UPDATE subscribers SET unsubscribed = 1 WHERE id = ? AND list_id = ?`).run(req.params.subId, list.id);
  res.redirect(`/admin/lists/${list.id}/subscribers`);
});

// -------- העלאת קובץ אקסל/CSV עם הרבה מיילים בבת אחת --------
router.post('/lists/:id/subscribers/bulk-upload', requireAuth, upload.single('file'), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  if (!req.file) {
    req.session.flash = 'לא נבחר קובץ.';
    return res.redirect(`/admin/lists/${list.id}/subscribers`);
  }

  const XLSX = require('xlsx');

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // מזהים כל תא שנראה כמו כתובת מייל, בכל עמודה ובכל שורה - כך שזה עובד
    // גם אם יש כותרת עמודה, גם אם המייל לא בעמודה הראשונה, וגם עם קובץ CSV פשוט.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = new Set();
    rows.forEach(row => {
      (row || []).forEach(cell => {
        const val = String(cell || '').trim().toLowerCase();
        if (emailPattern.test(val)) emails.add(val);
      });
    });

    let added = 0;
    const { subscribeEmail } = require('../subscriberUtil');
    for (const email of emails) {
      const result = subscribeEmail(list.id, email);
      if (result.ok) added++;
    }

    require('fs').unlinkSync(req.file.path);
    req.session.flash = `הועלו ${added} כתובות מייל חדשות מתוך ${emails.size} שזוהו בקובץ.`;
  } catch (err) {
    console.error('שגיאה בקריאת קובץ מנויים:', err);
    req.session.flash = 'שגיאה בקריאת הקובץ. ודא שזה קובץ Excel (.xlsx) או CSV תקין.';
  }

  res.redirect(`/admin/lists/${list.id}/subscribers`);
});

// -------- שליחה ידנית לבדיקה (בלי לחכות לתזמון השבועי) --------
router.post('/lists/:id/send-now', requireAuth, async (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const { compileAndSendIssue } = require('../compiler');
  try {
    const issueId = await compileAndSendIssue(list);
    if (issueId === null) {
      req.session.flash = 'אין תוכן מאושר לשליחה כרגע - אשר לפחות פריט אחד בתור לפני שליחה.';
    } else {
      const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(issueId);
      req.session.flash = `נשלח בהצלחה ל-${issue.recipient_count} מנויים.`;
    }
  } catch (err) {
    req.session.flash = `שגיאה בשליחה: ${err.message}`;
  }
  res.redirect('/admin');
});

// -------- היסטוריית גיליונות שנשלחו (כלום לא נמחק - רק לא היה איפה לראות) --------
router.get('/lists/:id/history', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const { formatIsraelDateTime } = require('../timeUtil');
  const issues = db.prepare(`
    SELECT * FROM issues WHERE list_id = ? AND status = 'sent' ORDER BY sent_at DESC
  `).all(list.id).map(issue => ({ ...issue, sent_at_display: formatIsraelDateTime(issue.sent_at) }));

  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('admin/history', { list, issues, allLists: getAllLists(), flash });
});

router.get('/lists/:id/history/:issueId', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND list_id = ?').get(req.params.issueId, list.id);
  if (!issue) return res.status(404).send('גיליון לא נמצא');
  res.send(issue.html);
});

router.post('/lists/:id/history/:issueId/resend', requireAuth, express.urlencoded({ extended: true }), async (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  const issue = db.prepare('SELECT * FROM issues WHERE id = ? AND list_id = ?').get(req.params.issueId, list.id);
  if (!issue) return res.status(404).send('גיליון לא נמצא');

  // emails מגיע כמערך משדות בשם emails[] (אחד או יותר, כולל שדות ריקים
  // שהמשתמש הוסיף עם כפתור ה-+ ולא מילא - מסננים אותם)
  let emails = req.body.emails;
  if (!emails) emails = [];
  if (!Array.isArray(emails)) emails = [emails];
  emails = emails.map(e => (e || '').trim().toLowerCase()).filter(Boolean);

  if (emails.length === 0) {
    req.session.flash = 'לא הוזנה אף כתובת מייל לשליחה חוזרת.';
    return res.redirect(`/admin/lists/${list.id}/history`);
  }

  const { sendViaSendGrid, rebuildIssueForResend } = require('../compiler');
  const { html, attachments } = rebuildIssueForResend(issue);

  let sentCount = 0;
  const errors = [];
  for (const email of emails) {
    try {
      await sendViaSendGrid(email, `${list.name} - שליחה חוזרת`, html, attachments);
      sentCount++;
    } catch (err) {
      errors.push(`${email}: ${err.message}`);
    }
  }

  req.session.flash = errors.length
    ? `נשלח ל-${sentCount} מתוך ${emails.length}. שגיאות: ${errors.join(' | ')}`
    : `הגיליון נשלח מחדש בהצלחה ל-${sentCount} כתובות.`;

  res.redirect(`/admin/lists/${list.id}/history`);
});

module.exports = router;
