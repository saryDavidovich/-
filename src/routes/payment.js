const express = require('express');
const router = express.Router();
const db = require('../db');
const nedarim = require('../nedarim');

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

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
  const callbackUrl = `${BASE_URL}/payment/webhook`;

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
router.post('/payment/webhook', express.json(), (req, res) => {
  // תמיד עונים 200 גם בשגיאה/דחייה - מונע שנדרים ינסה לשדר את אותו עדכון
  // שוב ושוב מיותר; השגיאה מתועדת ביומן וגם ב-webhook_log לבדיקה בממשק.
  const data = req.body || {};
  const paymentToken = data.Param1 || null;
  const sourceIp = (req.ip || '').replace('::ffff:', '');
  const trusted = nedarim.isFromNedarim(req);
  const relatedItem = paymentToken
    ? db.prepare('SELECT * FROM items WHERE payment_token = ?').get(paymentToken)
    : null;

  const logEntry = (outcome) => {
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
    if (!trusted) {
      console.warn(`CallBack מנדרים פלוס התקבל מכתובת IP לא מוכרת: ${sourceIp}${relatedItem ? ` (item #${relatedItem.id})` : ''} - ניתן לאשר ידנית בממשק אם מדובר בכתובת אמיתית שלהם.`);
      logEntry('rejected: untrusted ip');
      return res.status(200).send('ignored: untrusted source');
    }

    const status = data.Status; // 'OK' | 'Error' - לפי מבנה TransactionResponse
    if (!paymentToken) {
      console.warn('CallBack מנדרים פלוס בלי Param1 (מזהה תשלום):', data);
      logEntry('rejected: no token');
      return res.status(200).send('ignored: no token');
    }

    if (!relatedItem) {
      console.warn('CallBack מנדרים פלוס עבור מזהה תשלום לא מוכר:', paymentToken);
      logEntry('rejected: unknown token');
      return res.status(200).send('ignored: unknown token');
    }
    if (relatedItem.payment_status === 'paid') {
      // כבר טופל בעבר (אולי שידור כפול) - לא עושים כלום.
      logEntry('ignored: already paid');
      return res.status(200).send('already processed');
    }

    // הסכום ב-webhook חייב להיות תואם למה שיצרנו את העסקה איתו - הגנה
    // נוספת מעבר לזיהוי ה-Param הייחודי בלבד.
    const receivedAmount = Math.round(parseFloat(data.Amount || '0'));
    if (status !== 'OK' || receivedAmount !== relatedItem.payment_amount) {
      console.warn(`CallBack נדחה עבור item #${relatedItem.id}: status=${status}, amount=${receivedAmount} (צפוי ${relatedItem.payment_amount})`);
      db.prepare(`UPDATE items SET payment_status = 'pending' WHERE id = ?`).run(relatedItem.id);
      logEntry('rejected: mismatch');
      return res.status(200).send('rejected: mismatch');
    }

    db.prepare(`
      UPDATE items
      SET payment_status = 'paid', status = 'pending', paid_at = datetime('now'),
          nedarim_transaction_id = ?
      WHERE id = ?
    `).run(String(data.TransactionId || relatedItem.nedarim_transaction_id || ''), relatedItem.id);

    console.log(`תשלום אושר עבור item #${relatedItem.id} (${relatedItem.payment_amount} ש"ח) - נכנס לתור אישור.`);
    logEntry('confirmed: paid');
    res.status(200).send('ok');
  } catch (err) {
    console.error('שגיאה בטיפול ב-CallBack מנדרים פלוס:', err);
    logEntry('error: ' + (err.message || 'unknown'));
    res.status(200).send('error logged');
  }
});

module.exports = router;
