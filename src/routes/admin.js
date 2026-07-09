const express = require('express');
const router = express.Router();
const db = require('../db');
const { renderIssue } = require('../templates');

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

function getAllLists() {
  return db.prepare('SELECT * FROM lists ORDER BY created_at DESC').all();
}

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

  const pending = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' ORDER BY created_at ASC
  `).all(list.id);

  const items = pending.map(item => {
    if (item.type === 'question') {
      const pendingAnswers = db.prepare(`SELECT * FROM items WHERE parent_id = ? AND status = 'pending'`).all(item.id);
      return { ...item, pendingAnswers };
    }
    return item;
  }).filter(item => item.type !== 'answer');

  res.render('admin/queue', { list, items, allLists: getAllLists() });
});

router.post('/items/:id/approve', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('לא נמצא');

  const editedBody = req.body.body_edited;
  const editedSubject = req.body.subject;
  const paidTier = req.body.paid_tier || item.paid_tier;

  db.prepare(`
    UPDATE items SET status = 'approved', body_edited = ?, subject = ?, paid_tier = ?, approved_at = datetime('now')
    WHERE id = ?
  `).run(editedBody, editedSubject, paidTier, item.id);

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
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, body_edited, word_count, approved_at)
    VALUES (?, 'question', 'approved', 'admin', ?, ?, ?, ?, datetime('now'))
  `).run(list.id, subject, question_body, question_body, wc);

  if (answer_body && answer_body.trim()) {
    const awc = answer_body.trim().split(/\s+/).filter(Boolean).length;
    db.prepare(`
      INSERT INTO items (list_id, type, parent_id, status, from_email, body_raw, body_edited, word_count, approved_at)
      VALUES (?, 'answer', ?, 'approved', 'admin', ?, ?, ?, datetime('now'))
    `).run(list.id, q.lastInsertRowid, answer_body, answer_body, awc);
  }

  res.redirect(`/admin/lists/${list.id}/preview`);
});

// -------- כתיבת מודעה ישירות (בלי מייל) --------
router.get('/lists/:id/compose/ad', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  res.render('admin/compose_ad', { list, allLists: getAllLists() });
});

router.post('/lists/:id/compose/ad', requireAuth, express.urlencoded({ extended: true }), (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const { subject, body, paid_tier } = req.body;
  const wc = (body || '').trim().split(/\s+/).filter(Boolean).length;

  db.prepare(`
    INSERT INTO items (list_id, type, status, from_email, subject, body_raw, body_edited, word_count, paid_tier, approved_at)
    VALUES (?, 'ad', 'approved', 'admin', ?, ?, ?, ?, ?, datetime('now'))
  `).run(list.id, subject || '', body, body, wc, paid_tier || 'free');

  res.redirect(`/admin/lists/${list.id}/preview`);
});

// -------- תצוגה מקדימה חיה --------
router.get('/lists/:id/preview', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;

  const approvedQuestions = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND type = 'question' AND status = 'approved' ORDER BY approved_at ASC
  `).all(list.id);

  const qaPairs = approvedQuestions.map(question => {
    const answer = db.prepare(`
      SELECT * FROM items WHERE parent_id = ? AND type = 'answer' AND status = 'approved' ORDER BY approved_at ASC LIMIT 1
    `).get(question.id);
    return { question, answer: answer || null };
  });

  const tierOrder = { premium: 0, plus: 1, free: 2 };
  const ads = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND type = 'ad' AND status = 'approved' ORDER BY approved_at ASC
  `).all(list.id).sort((a, b) => (tierOrder[a.paid_tier] ?? 9) - (tierOrder[b.paid_tier] ?? 9));

  const html = renderIssue({ list, qaPairs, ads, unsubscribeToken: 'preview' });
  res.send(html);
});

// -------- מנויים --------
router.get('/lists/:id/subscribers', requireAuth, (req, res) => {
  const list = loadListOr404(req, res);
  if (!list) return;
  const subscribers = db.prepare(`
    SELECT * FROM subscribers WHERE list_id = ? AND unsubscribed = 0 ORDER BY created_at DESC
  `).all(list.id);
  res.render('admin/subscribers', { list, subscribers, allLists: getAllLists() });
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

module.exports = router;
