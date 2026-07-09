require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

// רשת ביטחון: בלי זה, שגיאה לא-מטופלת בכל בקשה בודדת (כמו העלאת קובץ
// פגום) מפילה את כל השרת עבור כולם עד שRailway מפעיל אותו מחדש. עדיף
// לתעד את השגיאה ולהמשיך לרוץ, מאשר שכל המערכת תיפול בגלל בקשה אחת.
process.on('uncaughtException', (err) => {
  console.error('=== שגיאה לא מטופלת (uncaughtException) - השרת ממשיך לרוץ ===', err);
});
process.on('unhandledRejection', (err) => {
  console.error('=== Promise נדחה בלי טיפול (unhandledRejection) - השרת ממשיך לרוץ ===', err);
});

const adminRoutes = require('./routes/admin');
const inboundRoutes = require('./routes/inbound');
const publicRoutes = require('./routes/public');
const { runWeeklyCompiler } = require('./compiler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// תמונות/גיפים שהועלו (מודעות פרימיום/מודגשות) - מוגשות מהתיקייה המתמשכת
// data/uploads, כדי שלא יאבדו בדיפלוי חדש (בהנחה שיש Volume מחובר ב-Railway).
const fs = require('fs');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-env',
  resave: false,
  saveUninitialized: false
}));

app.get('/', (req, res) => res.redirect('/admin'));
app.use('/admin', adminRoutes);
app.use('/webhooks', inboundRoutes);
app.use('/', publicRoutes);

// שליחה אוטומטית שבועית - ברירת מחדל: כל יום חמישי ב-09:00.
// אפשר לשנות את התזמון דרך משתנה סביבה CRON_SCHEDULE (תחביר cron רגיל).
const schedule = process.env.CRON_SCHEDULE || '0 9 * * 4';
cron.schedule(schedule, () => {
  console.log('מריץ קומפילציה ושליחה שבועית אוטומטית...');
  runWeeklyCompiler();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`המערכת רצה על http://localhost:${PORT}`);
  console.log(`פאנל ניהול: http://localhost:${PORT}/admin`);
});

module.exports = app;
