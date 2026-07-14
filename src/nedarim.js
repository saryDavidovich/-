// אינטגרציית סליקה מול נדרים פלוס - זרימת "הקמת עסקה בצד שרת" (ראה
// תיעוד ה-API: "אייפרם: הקמת עסקה בצד שרת" + "אייפרם: אימות תשלום ואבטחה").
//
// למה זרימה זו ולא "ביצוע עסקה מהדף" הרגילה: כאן הסכום נקבע ונשלח על ידי
// השרת שלנו בלבד (CreateTransaction), ולא ניתן לשינוי בצד הלקוח - חשוב
// כי מדובר בתשלום עבור מודעה במחיר קבוע שהוגדר בפאנל הניהול.
//
// אימות תשלום אמיתי קורה אך ורק דרך ה-CallBack שנדרים פלוס שולחים לשרת
// שלנו (verifyCallbackSource + הצלבת ה-Param/הסכום ב-payment.js) - לעולם
// לא סומכים על תגובת האייפרם בצד הלקוח (TransactionResponse) לבדה.

const fetch = require('node-fetch');

const NEDARIM_MOSAD = process.env.NEDARIM_MOSAD || '';
const NEDARIM_API_VALID = process.env.NEDARIM_API_VALID || '';

// כתובות ה-IP שמהן נדרים פלוס שולחים CallBack - ראה "אייפרם: אימות תשלום
// ואבטחה" בתיעוד. כל בקשה שלא מגיעה מאחת מהכתובות האלה נדחית.
const NEDARIM_CALLBACK_IPS = [
  '18.194.219.73',
  '3.70.117.239',
  '3.74.120.185',
  '18.196.146.117'
];

const CREATE_TRANSACTION_URL = 'https://matara.pro/nedarimplus/V6/Files/WebServices/DebitIframe.aspx?Action=CreateTransaction';

function isConfigured() {
  return Boolean(NEDARIM_MOSAD && NEDARIM_API_VALID);
}

// יוצרת עסקה מוכנה מראש בצד השרת מול נדרים פלוס. הדף שלנו ישלח לאייפרם
// רק את ה-ID שחוזר מכאן (FinishTransaction) - הסכום כבר "נעול" בצד נדרים.
// callbackUrl חייב להיות כתובת ציבורית מלאה (https) שמגיעה חזרה לשרת שלנו.
async function createServerTransaction({ amount, paymentToken, comment, callbackUrl }) {
  if (!isConfigured()) {
    return { ok: false, error: 'נדרים פלוס לא מוגדר (חסרים NEDARIM_MOSAD / NEDARIM_API_VALID ב-.env)' };
  }

  const params = new URLSearchParams({
    Mosad: NEDARIM_MOSAD,
    ApiValid: NEDARIM_API_VALID,
    PaymentType: 'Ragil',
    Amount: String(amount),
    Currency: '1',
    Tashlumim: '1',
    Comment: comment || '',
    Param1: paymentToken,
    CallBack: callbackUrl,
    AjaxId: String(Date.now())
  });

  const resp = await fetch(CREATE_TRANSACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, error: `תגובה לא תקינה מנדרים פלוס: ${text.slice(0, 200)}` };
  }

  if (data.Status !== 'OK') {
    return { ok: false, error: data.Message || 'שגיאה לא ידועה מנדרים פלוס' };
  }
  return { ok: true, transactionId: data.ID };
}

// req.ip תלוי ב-app.set('trust proxy', ...) שהוגדר ב-server.js - בלי זה
// תמיד תתקבל כתובת ה-proxy הפנימי של Railway ולא הכתובת האמיתית של הפונה.
function isFromNedarim(req) {
  const ip = (req.ip || '').replace('::ffff:', '');
  return NEDARIM_CALLBACK_IPS.includes(ip);
}

module.exports = { isConfigured, createServerTransaction, isFromNedarim, NEDARIM_CALLBACK_IPS };
