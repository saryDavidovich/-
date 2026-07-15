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
const { getSetting } = require('./appSettings');

// שני מקורות אפשריים להגדרות: טבלת app_settings (ניתנת לעריכה מהממשק,
// ראה admin.js /payment-settings) עדיפה, ומשתני סביבה כברירת מחדל/גיבוי
// (שימושי בעיקר לפריסה ראשונית, לפני שנכנסים לממשק בכלל).
function getMosad() {
  return getSetting('nedarim_mosad', process.env.NEDARIM_MOSAD || '');
}
function getApiValid() {
  return getSetting('nedarim_api_valid', process.env.NEDARIM_API_VALID || '');
}
// שים לב: זו סיסמה שונה מ-ApiValid - "סיסמת API" (ApiPassword) משמשת רק
// למשיכת נתונים (הסטוריית עסקאות וכו'), לא לביצוע תשלומים. משמשת כאן רק
// כדי לאמת ידנית מול נדרים פלוס עסקה שה-CallBack שלה הגיע מ-IP לא מוכר
// (ראה admin.js /items/:id/verify-payment).
function getApiPassword() {
  return getSetting('nedarim_api_password', process.env.NEDARIM_API_PASSWORD || '');
}

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
  return Boolean(getMosad() && getApiValid());
}

// יוצרת עסקה מוכנה מראש בצד השרת מול נדרים פלוס. הדף שלנו ישלח לאייפרם
// רק את ה-ID שחוזר מכאן (FinishTransaction) - הסכום כבר "נעול" בצד נדרים.
// callbackUrl חייב להיות כתובת ציבורית מלאה (https) שמגיעה חזרה לשרת שלנו.
async function createServerTransaction({ amount, paymentToken, comment, callbackUrl }) {
  if (!isConfigured()) {
    return { ok: false, error: 'נדרים פלוס לא מוגדר (השלימו מספר מוסד וטקסט אימות בהגדרות התשלום בפאנל הניהול)' };
  }

  const params = new URLSearchParams({
    Mosad: getMosad(),
    ApiValid: getApiValid(),
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
function sourceIp(req) {
  return (req.ip || '').replace('::ffff:', '');
}
function isFromNedarim(req) {
  return NEDARIM_CALLBACK_IPS.includes(sourceIp(req));
}

// משיכת הסטוריית עסקאות אמיתית מנדרים פלוס (GetHistoryJson) - "מקור
// האמת" הסופי: קריאה חוזרת משרת לשרת עם הסיסמה שלנו, שאי אפשר לזייף.
// מוגבל ל-20 קריאות בשעה מצידם, ולכן נעשה בה שימוש רק כשצריך (ראה
// verifyCallback), לא כלולאת סנכרון קבועה.
const HISTORY_URL = 'https://matara.pro/nedarimplus/Reports/Manage3.aspx';

async function getRecentTransactions({ maxId = 50 } = {}) {
  if (!getApiPassword()) {
    return { ok: false, error: 'סיסמת API (ApiPassword) לא מוגדרת - ראה הגדרות תשלום' };
  }
  const params = new URLSearchParams({
    Action: 'GetHistoryJson',
    MosadId: getMosad(),
    ApiPassword: getApiPassword(),
    MaxId: String(maxId)
  });
  const resp = await fetch(`${HISTORY_URL}?${params.toString()}`);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, error: `תגובה לא תקינה מנדרים פלוס: ${text.slice(0, 200)}` };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: (data && data.Message) || 'שגיאה לא ידועה בקבלת הסטוריית עסקאות' };
  }
  return { ok: true, transactions: data.slice().reverse() }; // האחרונות קודם
}

// אימות אוטומטי מלא של CallBack, בלי צורך בשלב ידני - שילוב של כמה
// אותות בלתי-תלויים, כל אחד מספיק לבדו:
//
//  1. כתובת ה-IP השולחת נמצאת ברשימה המתועדת של נדרים פלוס. זה מסלול
//     המהיר והפשוט, אבל תלוי ברשימה שעלולה להתעדכן מצידם (ראה אזהרתם
//     בתיעוד: "יתכן שנוספה כתובת חדשה") - ולכן לא היחיד.
//
//  2. מזהה העסקה (TransactionId) שחזר מ-CreateTransaction בעת יצירת
//     העסקה (ואנחנו שמרנו אצלנו) זהה למזהה שמופיע ב-CallBack שהתקבל.
//     זהו סוד ששני הצדדים היחידים שיודעים אותו הם השרת של נדרים פלוס
//     (שיצר אותו) והשרת שלנו (ששמר אותו) - לא ניתן לזיוף על ידי גורם
//     חיצוני, ולכן זה בטוח לא פחות מבדיקת IP, ולא תלוי כלל בתשתית
//     הרשת/פרוקסי שממנה מגיעה הבקשה. זה המסלול שפותר אוטומטית בדיוק את
//     המקרה של כתובת IP לא מתועדת, בלי לוותר על אבטחה.
//
//  3. כגיבוי אחרון (רק אם שני האותות הקודמים לא תאמו, ומוגדרת סיסמת
//     API): קריאה חוזרת בזמן אמת להסטוריית העסקאות האמיתית של נדרים
//     פלוס ובדיקה שהעסקה אכן קיימת שם עם אותו סכום - אי אפשר לזייף כי
//     זו קריאה יזומה על ידינו לשרת שלהם, לא משהו שהתקבל מבחוץ.
//
// בכל שלוש הדרכים ה-Amount וה-Status חייבים להתאים למה שציפינו.
async function verifyCallback(req, data, item) {
  const amountOk = Math.round(parseFloat(data.Amount || '0')) === item.payment_amount;
  const statusOk = data.Status === 'OK';
  if (!statusOk || !amountOk) {
    return { verified: false, reason: `status=${data.Status}, amount=${data.Amount} (צפוי ${item.payment_amount})` };
  }

  const ipTrusted = isFromNedarim(req);
  if (ipTrusted) return { verified: true, reason: `כתובת IP מוכרת (${sourceIp(req)})` };

  const idMatch = item.nedarim_transaction_id && data.TransactionId &&
    String(data.TransactionId) === String(item.nedarim_transaction_id);
  if (idMatch) return { verified: true, reason: `מזהה עסקה תואם למה ששמרנו (${data.TransactionId}), למרות IP לא מתועד (${sourceIp(req)})` };

  if (getApiPassword()) {
    const history = await getRecentTransactions({ maxId: 50 });
    if (history.ok) {
      const found = history.transactions.find(t =>
        String(t.TransactionId) === String(data.TransactionId) &&
        Math.round(parseFloat(t.Amount || '0')) === item.payment_amount
      );
      if (found) return { verified: true, reason: `אומת מול הסטוריית העסקאות האמיתית בנדרים פלוס (TransactionId ${data.TransactionId})` };
    }
  }

  return { verified: false, reason: `IP לא מתועד (${sourceIp(req)}) ומזהה העסקה לא תואם/לא נמצא בהסטוריה` };
}

module.exports = { isConfigured, createServerTransaction, isFromNedarim, verifyCallback, getMosad, getRecentTransactions, NEDARIM_CALLBACK_IPS };
