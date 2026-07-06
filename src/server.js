require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

const adminRoutes = require('./routes/admin');
const inboundRoutes = require('./routes/inbound');
const publicRoutes = require('./routes/public');
const { runWeeklyCompiler } = require('./compiler');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

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
