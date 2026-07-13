const db = require('./db');
const { renderIssue, collectImageAttachments } = require('./templates');
const { getOrderedApprovedEntries } = require('./issueBuilder');
const fetch = require('node-fetch');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_ADDRESS = process.env.FROM_ADDRESS || 'newsletter@example.com';
const BRAND_NAME = process.env.BRAND_NAME || 'הרשימות שלנו';

// attachments (אופציונלי): תמונות מוטמעות inline עם content_id, ראה
// templates.js collectImageAttachments - זו הדרך שנתמכת כמעט בכל תוכנת
// מייל (כולל Outlook), בניגוד ל-data URI שחלקן לא מציגות בכלל.
async function sendViaSendGrid(to, subject, html, attachments = []) {
  if (!SENDGRID_API_KEY) {
    console.log(`[DRY RUN - אין מפתח SendGrid מוגדר] היה נשלח מייל אל ${to}: ${subject} (${attachments.length} תמונות מצורפות)`);
    return { dryRun: true };
  }

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_ADDRESS, name: BRAND_NAME },
    subject,
    content: [{ type: 'text/html', value: html }]
  };
  if (attachments.length) payload.attachments = attachments;

  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) throw new Error(`SendGrid error: ${resp.status} ${await resp.text()}`);
  return { ok: true };
}

// בונה את הגיליון השבועי לרשימה אחת: אוסף את כל הפריטים המאושרים שעדיין
// לא נשלחו, מרכיב שאלה+תשובה יחד, ממיין מודעות לפי רמת תשלום (פרימיום קודם),
// ושולח לכל מנוי פעיל ברשימה. הכל בלי מגע יד אדם מעבר לאישור שכבר ניתן.
async function compileAndSendIssue(list) {
  // סדר גמיש לחלוטין - כל הפריטים (שאלות, מודעות, נושאים, תגובות המשך)
  // כבר ממוינים יחד באובייקט אחד לפי manual_order, שאפשר לשנות בגרירה
  // בתצוגה המקדימה (ראה issueBuilder.js).
  const entries = getOrderedApprovedEntries(list.id);
  const ads = entries.filter(e => e.kind === 'ad').map(e => e.item);

  if (entries.length === 0) {
    console.log(`אין תוכן מאושר לרשימת "${list.name}" - מדלגים על שליחה השבוע.`);
    return null;
  }

  const subscribers = db.prepare(`
    SELECT * FROM subscribers WHERE list_id = ? AND unsubscribed = 0
  `).all(list.id);

  const issueRow = db.prepare(`INSERT INTO issues (list_id, status) VALUES (?, 'draft')`).run(list.id);
  const issueId = issueRow.lastInsertRowid;

  // שומרים עותק ארכיוני עם data URI (לא cid) - כי הארכיון נצפה בדפדפן,
  // לא בתוכנת מייל, ואין שם "מצורפים" בכלל.
  const archiveHtml = renderIssue({ list, entries, unsubscribeToken: 'archive', useCid: false });
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

  // המייל שבאמת יוצא ללקוחות: תמונות כ-cid מצורף, לא data URI - נתמך
  // בהרבה יותר תוכנות מייל (כולל Outlook).
  const attachments = collectImageAttachments(ads);

  let sentCount = 0;
  for (const sub of subscribers) {
    const html = renderIssue({ list, entries, unsubscribeToken: sub.token, useCid: true });
    await sendViaSendGrid(sub.email, `${list.name} - עדכון שבועי`, html, attachments);
    sentCount++;
  }

  const allItemIds = entries.flatMap(e => {
    if (e.kind === 'qa') return e.answer ? [e.question.id, e.answer.id] : [e.question.id];
    if (e.kind === 'followup') return [e.answer.id];
    return [e.item.id];
  });
  const markSent = db.prepare(`UPDATE items SET status = 'sent', issue_id = ? WHERE id = ? AND status = 'approved'`);
  for (const id of allItemIds) markSent.run(issueId, id);

  db.prepare(`UPDATE issues SET status = 'sent', sent_at = datetime('now'), recipient_count = ? WHERE id = ?`)
    .run(sentCount, issueId);

  console.log(`נשלח גיליון לרשימת "${list.name}" ל-${sentCount} מנויים (${attachments.length} תמונות מצורפות).`);
  return issueId;
}

// שולפת מחדש את התוכן של גיליון שכבר נשלח (לפי issue_id ששמור על כל
// פריט ששויך אליו), כדי לאפשר שליחה חוזרת עם תמונות תקינות (cid), ולא
// רק את ה-HTML הארכיוני (data URI) שלא תמיד מוצג נכון בתוכנת מייל.
function rebuildIssueForResend(issue) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(issue.list_id);
  const items = db.prepare('SELECT * FROM items WHERE issue_id = ?').all(issue.id);

  const questions = items.filter(i => i.type === 'question');
  const answersById = {};
  items.filter(i => i.type === 'answer').forEach(a => { answersById[a.parent_id] = a; });
  const ads = items.filter(i => i.type === 'ad');
  const topics = items.filter(i => i.type === 'article');

  // משחזרים את אותו הסדר הגמיש ששויך לכל פריט בזמן השליחה המקורית
  // (manual_order נשמר על כל שורה, לא רק ברגע השליחה).
  const entries = [
    ...questions.map(q => ({ kind: 'qa', order: q.manual_order ?? 0, question: q, answer: answersById[q.id] || null })),
    ...ads.map(item => ({ kind: 'ad', order: item.manual_order ?? 0, item })),
    ...topics.map(item => ({ kind: 'topic', order: item.manual_order ?? 0, item }))
  ].sort((a, b) => a.order - b.order);

  const html = renderIssue({ list, entries, unsubscribeToken: 'resend', useCid: true });
  const attachments = collectImageAttachments(ads);
  return { html, attachments };
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

// נקראת כל דקה (ראה server.js) עם הזמן הנוכחי לפי שעון ישראל - שולחת רק את
// הרשימות שהגיע הרגע המדויק שהוגדר להן (יום+שעה+דקה), ורק פעם אחת ביום
// (last_auto_send_date מונע שליחה כפולה אם הבדיקה רצה כמה פעמים).
async function checkAndRunDueSends() {
  const { nowIsraelParts } = require('./timeUtil');
  const { dow, hour, minute, dateStr } = nowIsraelParts();

  const due = db.prepare(`
    SELECT * FROM lists
    WHERE active = 1 AND send_day = ? AND send_hour = ? AND send_minute = ?
      AND (last_auto_send_date IS NULL OR last_auto_send_date != ?)
  `).all(dow, hour, minute, dateStr);

  for (const list of due) {
    try {
      console.log(`הגיע זמן השליחה האוטומטית של "${list.name}" (${dateStr} ${hour}:${String(minute).padStart(2, '0')} שעון ישראל).`);
      await compileAndSendIssue(list);
    } catch (err) {
      console.error(`שגיאה בשליחה האוטומטית של רשימת "${list.name}":`, err.message);
    } finally {
      // מסמנים שנשלח היום גם אם compileAndSendIssue דילג (אין תוכן) או נכשל -
      // כדי שלא ננסה שוב ושוב באותו יום ברגע שהדקה כבר חלפה.
      db.prepare('UPDATE lists SET last_auto_send_date = ? WHERE id = ?').run(dateStr, list.id);
    }
  }
}

// "שליחת ניסיון" - בונה ושולח את הגיליון הנוכחי (בדיוק כמו שהוא ייראה
// ללקוחות) לכתובת מייל אחת בלבד, בלי ליצור issue, בלי לסמן פריטים כ"נשלח",
// ובלי לגעת בהיסטוריה בכלל - כדי שאפשר יהיה לבדוק איך זה מגיע לפני שמאשרים
// שליחה אמיתית ללקוחות.
async function sendTestIssue(list, toEmail) {
  const entries = getOrderedApprovedEntries(list.id);
  if (entries.length === 0) {
    throw new Error('אין עדיין תוכן מאושר לגיליון הבא - אין מה לשלוח לבדיקה.');
  }
  const ads = entries.filter(e => e.kind === 'ad').map(e => e.item);
  const html = renderIssue({ list, entries, unsubscribeToken: 'test-send', useCid: true });
  const attachments = collectImageAttachments(ads);
  await sendViaSendGrid(toEmail, `[בדיקה] ${list.name} - עדכון שבועי`, html, attachments);
  return { entriesCount: entries.length };
}

module.exports = { runWeeklyCompiler, compileAndSendIssue, sendViaSendGrid, rebuildIssueForResend, checkAndRunDueSends, sendTestIssue };
