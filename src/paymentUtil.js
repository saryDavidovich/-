const { v4: uuidv4 } = require('uuid');
const nedarim = require('./nedarim');

const PAID_FEATURES_ENABLED = process.env.PAID_FEATURES_ENABLED === 'true';

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
  return PAID_FEATURES_ENABLED && nedarim.isConfigured() && priceFor(list, tier) > 0;
}

function generatePaymentToken() {
  return uuidv4();
}

module.exports = { PAID_FEATURES_ENABLED, priceFor, requiresPayment, generatePaymentToken };
