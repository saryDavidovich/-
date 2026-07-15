const express = require('express');
const router = express.Router();
const db = require('../db');
const nedarim = require('../nedarim');
const { getBaseUrl } = require('../appSettings');

// -----------------------------------------------------------------------
// תשלום עבור מודעה בתשלום (מודגשת/פרימיום), דרך נדרים פלוס - זרימת
// "הקמת עסקה בצד שרת" (ראה src/nedarim.js לתיעוד מלא של הבחירה).
//
//   GET  /payment/:token            -> דף התשלום עם האייפרם
//   POST /payment/:token/start      -> השרת מקים את העסקה מול נדרים פלוס
//   POST /payment/webhook           -> CallBack מנדרים פלוס - האישור האמיתי היחיד
//
// חשוב: לעולם לא מסמנים "שולם" על סמך תגובת האייפרם בצד הלקוח - רק על סמך
// ה-webhook, אחרי אימות IP + הצלבת ה-Param הייחודי + הסכום.
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------

router.get('/payment/:token', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE payment_token = ?').get(req.params.token);
  if (!item) return res.status(404).send('קישור תשלום לא נמצא או לא תקין.');

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(item.list_id);

  if (item.payment_status === 'paid') {
    return res.render('payment', { status: 'paid', list, item });
  }
  if (!nedarim.isConfigured()) {
    return res.render('payment', { status: 'not_configured', list, item });
  }

  res.render('payment', { status: 'pay', list, item });
});

router.post('/payment/:token/start', express.json(), async (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE payment_token = ?').get(req.params.token);
  if (!item) return res.status(404).json({ ok: false, error: 'לא נמצא' });
  if (item.payment_status === 'paid') return res.status(400).json({ ok: false, error: 'המודעה כבר שולמה' });

  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(item.list_id);
  const callbackUrl = `${getBaseUrl()}/payment/webhook`;

  const result = await nedarim.createServerTransaction({
    amount: item.payment_amount,
    paymentToken: item.payment_token,
    comment: `מודעה ${item.paid_tier === 'premium' ? 'פרימיום' : 'מודגשת'} - ${list.name}`,
    callbackUrl
  });

  if (!result.ok) {
    console.error(`שגיאה ביצירת עסקת נדרים פלוס עבור item #${item.id}:`, result.error);
    return res.status(502).json({ ok: false, error: result.error });
  }

  db.prepare('UPDATE items SET nedarim_transaction_id = ? WHERE id = ?').run(String(result.transactionId), item.id);
  res.json({ ok: true, transactionId: result.transactionId, mosad: nedarim.getMosad() });
});

// כתובת ה-CallBack שנדרים פלוס שולחים אליה POST כ-application/json בסיום
// עסקה (ראה "מערכת Callback / Webhook" + "אייפרם: אימות תשלום ואבטחה"
// בתיעוד). זו כתובת ציבורית ללא הזדהות - כל האימות מבוסס על שילוב
// כתובת ה-IP השולחת + הצלבת ה-Param הייחודי + הסכום שאנחנו כבר מכירים.
router.post('/payment/webhook', express.json(), async (req, res) => {
  // תמיד עונים 200 גם בשגיאה/דחייה - מונע שנדרים ינסה לשדר את אותו עדכון
  // שוב ושוב מיותר; השגיאה מתועדת ביומן וגם ב-webhook_log לבדיקה בממשק.
  const data = req.body || {};
  const sourceIp = (req.ip || '').replace('::ffff:', '');

  // זיהוי הפריט: קודם כל לפי שדה ה-ID (זה מה שבאמת חוזר במבנה
  // TransactionResponse בזרימה שלנו, ראה src/nedarim.js verifyCallback
  // להסבר המלא למה - לא TransactionId), עם Param1 (payment_token) כגיבוי
  // בלבד למקרה ש-ID חסר או לא תואם לשום פריט אצלנו.
  const nedarimId = data.ID != null ? String(data.ID) : null;
  const paymentToken = data.Param1 || null;

  let relatedItem = null;
  let matchedBy = null;
  if (nedarimId) {
    relatedItem = db.prepare('SELECT * FROM items WHERE nedarim_transaction_id = ?').get(nedarimId);
    if (relatedItem) matchedBy = 'ID';
  }
  if (!relatedItem && paymentToken) {
    relatedItem = db.prepare('SELECT * FROM items WHERE payment_token = ?').get(paymentToken);
    if (relatedItem) matchedBy = 'Param1';
  }

  const logEntry = (trusted, outcome) => {
    try {
      db.prepare(`
        INSERT INTO webhook_log (source_ip, trusted, item_id, payment_token, raw_body, outcome)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(sourceIp, trusted ? 1 : 0, relatedItem ? relatedItem.id : null, paymentToken, JSON.stringify(data), outcome);
    } catch (logErr) {
      console.error('שגיאה בשמירת webhook_log:', logErr);
    }
  };

  try {
    if (!relatedItem) {
      console.warn(`CallBack מנדרים פלוס - לא נמצא פריט תואם (ID=${nedarimId}, Param1=${paymentToken}):`, data);
      logEntry(false, 'rejected: no matching item');
      return res.status(200).send('ignored: unknown item');
    }
    if (relatedItem.payment_status === 'paid') {
      // כבר טופל בעבר (אולי שידור כפול) - לא עושים כלום.
      logEntry(true, 'ignored: already paid');
      return res.status(200).send('already processed');
    }

    // אימות אוטומטי מלא (IP מוכר / מזהה עסקה תואם / הצלבה חיה מול
    // ההסטוריה האמיתית) - ראה src/nedarim.js verifyCallback להסבר מלא.
    // אין כאן שום שלב ידני; זה קורה תמיד אוטומטית ומיידית.
    const verification = await nedarim.verifyCallback(req, data, relatedItem);

    if (!verification.verified) {
      console.warn(`CallBack נדחה עבור item #${relatedItem.id}: ${verification.reason}`);
      logEntry(false, `rejected: ${verification.reason}`);
      return res.status(200).send('rejected');
    }

    db.prepare(`
      UPDATE items
      SET payment_status = 'paid', status = 'pending', paid_at = datetime('now'),
          nedarim_transaction_id = ?
      WHERE id = ?
    `).run(nedarimId || relatedItem.nedarim_transaction_id || '', relatedItem.id);

    console.log(`תשלום אושר אוטומטית עבור item #${relatedItem.id} (${relatedItem.payment_amount} ש"ח) - זוהה לפי ${matchedBy} - ${verification.reason} - נכנס לתור אישור.`);
    logEntry(true, `auto-confirmed (matched by ${matchedBy}): ${verification.reason}`);
    res.status(200).send('ok');
  } catch (err) {
    console.error('שגיאה בטיפול ב-CallBack מנדרים פלוס:', err);
    logEntry(false, 'error: ' + (err.message || 'unknown'));
    res.status(200).send('error logged');
  }
});

module.exports = router;
