const db = require('./db');
const { renderIssue } = require('./templates');
const fetch = require('node-fetch');

const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const FROM_ADDRESS = process.env.FROM_ADDRESS || `newsletter@${MAILGUN_DOMAIN || 'example.com'}`;

async function sendViaMailgun(to, subject, html) {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.log(`[DRY RUN - אין מפתח Mailgun מוגדר] היה נשלח מייל אל ${to}: ${subject}`);
    return { dryRun: true };
  }
  const params = new URLSearchParams();
  params.append('from', `${process.env.BRAND_NAME || 'הרשימות שלנו'} <${FROM_ADDRESS}>`);
  params.append('to', to);
  params.append('subject', subject);
  params.append('html', html);

  const resp = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  if (!resp.ok) throw new Error(`Mailgun error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// בונה את הגיליון השבועי לרשימה אחת: אוסף את כל הפריטים המאושרים שעדיין
// לא נשלחו, מרכיב שאלה+תשובה יחד, ממיין מודעות לפי רמת תשלום (פרימיום קודם),
// ושולח לכל מנוי פעיל ברשימה. הכל בלי מגע יד אדם מעבר לאישור שכבר ניתן.
async function compileAndSendIssue(list) {
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

  if (qaPairs.length === 0 && ads.length === 0) {
    console.log(`אין תוכן מאושר לרשימת "${list.name}" - מדלגים על שליחה השבוע.`);
    return null;
  }

  const subscribers = db.prepare(`
    SELECT * FROM subscribers WHERE list_id = ? AND unsubscribed = 0
  `).all(list.id);

  const issueRow = db.prepare(`INSERT INTO issues (list_id, status) VALUES (?, 'draft')`).run(list.id);
  const issueId = issueRow.lastInsertRowid;

  // שומרים גם עותק ארכיוני עם טוקן כללי (לא אישי) - לצפייה/שיתוף באתר
  const archiveHtml = renderIssue({ list, qaPairs, ads, unsubscribeToken: 'archive' });
  db.prepare(`UPDATE issues SET html = ? WHERE id = ?`).run(archiveHtml, issueId);

  let sentCount = 0;
  for (const sub of subscribers) {
    const html = renderIssue({ list, qaPairs, ads, unsubscribeToken: sub.token });
    await sendViaMailgun(sub.email, `${list.name} - עדכון שבועי`, html);
    sentCount++;
  }

  const allItemIds = [
    ...qaPairs.map(p => p.question.id),
    ...qaPairs.filter(p => p.answer).map(p => p.answer.id),
    ...ads.map(a => a.id)
  ];
  const markSent = db.prepare(`UPDATE items SET status = 'sent', issue_id = ? WHERE id = ?`);
  for (const id of allItemIds) markSent.run(issueId, id);

  db.prepare(`UPDATE issues SET status = 'sent', sent_at = datetime('now'), recipient_count = ? WHERE id = ?`)
    .run(sentCount, issueId);

  console.log(`נשלח גיליון לרשימת "${list.name}" ל-${sentCount} מנויים.`);
  return issueId;
}

async function runWeeklyCompiler() {
  const lists = db.prepare(`SELECT * FROM lists WHERE active = 1`).all();
  for (const list of lists) {
    try {
      await compileAndSendIssue(list);
    } catch (err) {
      console.error(`שגיאה בשליחת רשימת "${list.name}":`, err.message);
    }
  }
}

module.exports = { runWeeklyCompiler, compileAndSendIssue };
