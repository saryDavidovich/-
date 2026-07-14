const { v4: uuidv4 } = require('uuid');
const { getSetting } = require('./appSettings');
const nedarim = require('./nedarim');

// שני מקורות אפשריים להפעלה: משתנה הסביבה (ברירת מחדל/גיבוי, כמו שהיה עד
// עכשיו) או המתג בהגדרות התשלום בפאנל הניהול (ניתן לשינוי בלי redeploy).
// כל אחד מהם לבד מספיק כדי להפעיל.
function paidFeaturesEnabled() {
  return process.env.PAID_FEATURES_ENABLED === 'true' || getSetting('paid_features_enabled', '') === '1';
}

// מחזירה את המחיר (בשקלים) שהוגדר לרשימה הזו לרמה הנתונה, או 0 אם אין
// מחיר/הרמה חינמית. משמש גם את טופס האתר וגם את הקליטה במייל, כדי
// ששתי הדרכים יתנהגו זהה.
function priceFor(list, tier) {
  if (tier === 'plus') return Number(list.plus_price) || 0;
  if (tier === 'premium') return Number(list.premium_price) || 0;
  return 0;
}

// האם מודעה ברמה הזו ברשימה הזו צריכה לעבור דרך תשלום לפני שהיא נכנסת
// לתור האישור הרגיל - רק אם התכונה המשולמת פעילה בכלל (.env), נדרים פלוס
// מוגדר, והמחיר לרמה הזו גדול מ-0.
function requiresPayment(list, tier) {
  return paidFeaturesEnabled() && nedarim.isConfigured() && priceFor(list, tier) > 0;
}

function generatePaymentToken() {
  return uuidv4();
}

module.exports = { paidFeaturesEnabled, priceFor, requiresPayment, generatePaymentToken };
