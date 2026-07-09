const db = require('./db');
const { renderIssue } = require('./templates');
const fetch = require('node-fetch');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_ADDRESS = process.env.FROM_ADDRESS || 'newsletter@example.com';
const BRAND_NAME = process.env.BRAND_NAME || 'הרשימות שלנו';

async function sendViaSendGrid(to, subject, html) {
  if (!SENDGRID_API_KEY) {
    console.log(`[DRY RUN - אין מפתח SendGrid מוגדר] היה נשלח מייל אל ${to}: ${subject}`);
    return { dryRun: true };
  }

  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_ADDRESS, name: BRAND_NAME },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  });

  if (!resp.ok) throw new Error(`SendGrid error: ${resp.status} ${await resp.text()}`);
  return { ok: true };
}

// בונה את הגיליון השבועי לרשימה אחת: אוסף את כל הפריטים המאושרים שעדיין
// לא נשלחו, מרכיב שאלה+תשובה יחד, ממיין מודעות לפי רמת תשלום (פרימיום קודם),
// ושולח לכל מנוי פעיל ברשימה. הכל בלי מגע יד אדם מעבר לאישור שכבר ניתן.
async function compileAndSendIssue(list) {
  const newQuestions = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND type = 'question' AND status = 'approved' ORDER BY approved_at ASC
  `).all(list.id);

  const qaPairsNew = newQuestions.map(question => {
    const answer = db.prepare(`
      SELECT * FROM items WHERE parent_id = ? AND type = 'answer' AND status = 'approved' ORDER BY approved_at ASC LIMIT 1
    `).get(question.id);
    return { question, answer: answer || null };
  });

  // תשובות חדשות שהגיעו לשאלות שכבר נשלחו בעבר (למשל לקוח הגיב אחרי
  // שהגיליון כבר יצא) - מכניסים אותן לגיליון הבא יחד עם השאלה המקורית,
  // כדי שיהיה הקשר, בלי לשלוח את השאלה כאילו היא חדשה.
  const followUpAnswers = db.prepare(`
    SELECT a.* FROM items a
    JOIN items q ON a.parent_id = q.id
    WHERE a.list_id = ? AND a.type = 'answer' AND a.status = 'approved' AND q.status = 'sent'
    ORDER BY a.approved_at ASC
  `).all(list.id);

  const qaPairsFollowUp = followUpAnswers.map(answer => {
    const question = db.prepare('SELECT * FROM items WHERE id = ?').get(answer.parent_id);
    return { question, answer };
  });

  const qaPairs = [...qaPairsNew, ...qaPairsFollowUp];

  const tierOrder = { premium: 0, plus: 1, free: 2 };
  const ads = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND type = 'ad' AND status = 'approved' ORDER BY approved_at ASC
  `).all(list.id).sort((a, b) => (tierOrder[a.paid_tier] ?? 9) - (tierOrder[b.paid_tier] ?? 9));

  const topics = db.prepare(`
    SELECT * FROM items WHERE list_id = ? AND type = 'article' AND status = 'approved' ORDER BY approved_at ASC
  `).all(list.id);

  if (qaPairs.length === 0 && ads.length === 0 && topics.length === 0) {
    console.log(`אין תוכן מאושר לרשימת "${list.name}" - מדלגים על שליחה השבוע.`);
    return null;
  }

  const subscribers = db.prepare(`
    SELECT * FROM subscribers WHERE list_id = ? AND unsubscribed = 0
  `).all(list.id);

  const issueRow = db.prepare(`INSERT INTO issues (list_id, status) VALUES (?, 'draft')`).run(list.id);
  const issueId = issueRow.lastInsertRowid;

  // שומרים גם עותק ארכיוני עם טוקן כללי (לא אישי) - לצפייה/שיתוף באתר
  const archiveHtml = renderIssue({ list, qaPairs, ads, topics, unsubscribeToken: 'archive' });
  db.prepare(`UPDATE issues SET html = ? WHERE id = ?`).run(archiveHtml, issueId);

  // Gmail וספקים אחרים חותכים מייל שעובר בערך 102KB ("[Message clipped]") -
  // ואז חלקים ממנו (כולל תמונות) פשוט לא מוצגים. מזהירים בלוג כדי שתדע
  // לצמצם תמונות/תוכן בגיליון הבא אם זה קורה.
  const sizeKB = Math.round(Buffer.byteLength(archiveHtml, 'utf8') / 1024);
  if (sizeKB > 90) {
    console.warn(`אזהרה: הגיליון של "${list.name}" גדול (${sizeKB}KB) - קרוב לגבול שבו Gmail חותך הודעות (~100KB). שקול פחות תמונות/מודעות בגיליון אחד.`);
  } else {
    console.log(`גודל הגיליון של "${list.name}": ${sizeKB}KB`);
  }

  let sentCount = 0;
  for (const sub of subscribers) {
    const html = renderIssue({ list, qaPairs, ads, topics, unsubscribeToken: sub.token });
    await sendViaSendGrid(sub.email, `${list.name} - עדכון שבועי`, html);
    sentCount++;
  }

  const allItemIds = [
    ...qaPairs.map(p => p.question.id),
    ...qaPairs.filter(p => p.answer).map(p => p.answer.id),
    ...ads.map(a => a.id),
    ...topics.map(t => t.id)
  ];
  const markSent = db.prepare(`UPDATE items SET status = 'sent', issue_id = ? WHERE id = ? AND status = 'approved'`);
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

module.exports = { runWeeklyCompiler, compileAndSendIssue, sendViaSendGrid };
