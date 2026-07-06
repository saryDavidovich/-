const express = require('express');
const router = express.Router();
const db = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
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
  res.render('admin/dashboard', { lists });
});

// -------- Lists (topics) management --------
router.get('/lists/new', requireAuth, (req, res) => {
  res.render('admin/list_form', { list: null });
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

// -------- Approval queue --------
router.get('/queue/:listId', requireAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId);
  if (!list) return res.status(404).send('רשימה לא נמצאה');

  const pending = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND status = 'pending' ORDER BY created_at ASC
  `).all(list.id);

  // מצרפים לכל שאלה את התשובות הממתינות שלה, כדי שתראה אותן ביחד
  const items = pending.map(item => {
    if (item.type === 'question') {
      const pendingAnswers = db.prepare(`SELECT * FROM items WHERE parent_id = ? AND status = 'pending'`).all(item.id);
      return { ...item, pendingAnswers };
    }
    return item;
  }).filter(item => item.type !== 'answer'); // תשובות מוצגות מקוננות תחת השאלה

  res.render('admin/queue', { list, items });
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

  res.redirect(`/admin/queue/${item.list_id}`);
});

router.post('/items/:id/reject', requireAuth, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).send('לא נמצא');
  db.prepare(`UPDATE items SET status = 'rejected' WHERE id = ?`).run(item.id);
  res.redirect(`/admin/queue/${item.list_id}`);
});

module.exports = router;
