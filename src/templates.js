// עיצוב אחיד לכל הרשימות - "בית" אחד עם מיתוג עקבי.
// ההבדל בין רשימה לרשימה הוא רק צבע ההדגשה (accent) ושם הרשימה בכותרת,
// לא לוגו/פריסה/גופן שונה. זה מה שגורם לזה להרגיש כמו גוף אחד ומקצועי,
// ולא כמו כמה אתרים חובבניים שונים.
//
// עיקרון מנחה: כל פעולה (שאלה, מודעה, הצטרפות, הסרה, תגובה) ניתנת לביצוע
// כ-mailto בלבד, כדי שגם לקוחות עם גישה מוגבלת לדפדפן (כמו "נטו מייל")
// יוכלו להשתמש בכל התכונות בלי לצאת מתוכנת המייל שלהם.

const fs = require('fs');
const path = require('path');

const BRAND_NAME = process.env.BRAND_NAME || 'הרשימות שלנו';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN || 'yourdomain.com';
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp'
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// עיצוב טקסט בסיסי: **מודגש**, *נטוי*, __קו תחתון__ - מיושם אחרי ה-escape,
// כך שאין שום סיכון של הזרקת HTML - התווים המיוחדים היחידים שמזוהים הם
// אלה, שום תג HTML גולמי לא עובר.
function applyBasicFormatting(escapedText) {
  return escapedText
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function formatBody(raw) {
  return applyBasicFormatting(escapeHtml(raw)).replace(/\n/g, '<br>');
}

function absoluteUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

// הופך תמונה שהועלתה למערכת (נתיב כמו /uploads/xxx.png) למחרוזת base64
// המוטמעת ישירות בתוך ה-HTML של המייל עצמו (data URI). כך אין שום קובץ
// נפרד שהמייל "מצביע" עליו מבחוץ - התמונה היא חלק מהטקסט של המייל,
// ולכן אין לשום מסנן (כמו נטפרי) מה לסרוק או לעכב בנפרד, והיא מוצגת מיד.
function embedImageAsDataUri(relativePath) {
  try {
    // תומך רק בתמונות שהועלו למערכת שלנו עצמה (לא ב-URL חיצוני), כי רק
    // אותן אפשר לקרוא ישירות מהדיסק בזמן בניית הגיליון.
    if (/^https?:\/\//i.test(relativePath)) return null;
    const ext = path.extname(relativePath).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;

    const filename = path.basename(relativePath);
    const filePath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filePath)) return null;

    const buffer = fs.readFileSync(filePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('שגיאה בהטמעת תמונה כ-base64:', err.message);
    return null;
  }
}

function mailto(action, slug, subjectText) {
  return `mailto:${action}+${slug}@${INBOUND_DOMAIN}?subject=${encodeURIComponent(subjectText)}`;
}

function wordLimitBadge(item) {
  const tierLabel = { free: '', plus: 'מודעה מודגשת', premium: 'מודעה פרימיום' }[item.paid_tier] || '';
  if (!tierLabel) return '';
  return `<span style="font-size:11px;background:#f1efe8;color:#5f5e5a;padding:2px 8px;border-radius:10px;margin-inline-start:6px;">${tierLabel}</span>`;
}

function renderAd(item) {
  const images = JSON.parse(item.images_json || '[]');
  const links = JSON.parse(item.links_json || '[]');
  const body = formatBody(item.body_edited ?? item.body_raw);

  const bg = item.bg_color || 'transparent';
  const fg = item.text_color || '#2c2c2a';
  const boxStyle = item.bg_color
    ? `background:${bg};color:${fg};padding:14px;border-radius:8px;`
    : `color:${fg};padding:14px 0;`;

  // התמונה מוטמעת ישירות בתוך ה-HTML (base64) - היא חלק מגוף המייל עצמו,
  // לא קובץ נפרד שנטען מבחוץ. היא מוצגת מיד בראש המודעה, בדיוק כמו
  // בפרסומת רגילה. אם ההטמעה נכשלת מסיבה כלשהי (למשל קובץ לא נמצא),
  // נופלים בחזרה לקישור טקסט רגיל במקום להשאיר את המודעה בלי תמונה בשקט.
  const imagesHtml = images.map(src => {
    const dataUri = embedImageAsDataUri(src);
    if (dataUri) {
      return `<img src="${dataUri}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:8px;display:block;" />`;
    }
    return `<a href="${escapeHtml(absoluteUrl(src))}" style="display:inline-block;font-size:13px;color:${item.bg_color ? fg : '#185fa5'};text-decoration:underline;margin-bottom:8px;">לצפייה בתמונה &#8599;</a>`;
  }).join('');

  const linksHtml = links.length
    ? `<div style="margin-top:8px;">${links.map(l => `<a href="${escapeHtml(l)}" style="color:${item.bg_color ? fg : '#185fa5'};">${escapeHtml(l)}</a>`).join('<br>')}</div>`
    : '';

  return `
  <tr><td style="border-bottom:1px solid #eceae3;">
    <div style="font-size:15px;line-height:1.6;${boxStyle}">
      ${imagesHtml}
      ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>${wordLimitBadge(item)}<br>` : wordLimitBadge(item)}
      ${body}
      ${linksHtml}
    </div>
  </td></tr>`;
}

function renderTopic(item, accent) {
  const body = formatBody(item.body_edited ?? item.body_raw);
  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #eceae3;">
    ${item.subject ? `<div style="font-size:15px;font-weight:700;color:${accent};margin-bottom:4px;">${escapeHtml(item.subject)}</div>` : ''}
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${body}</div>
  </td></tr>`;
}

function renderQA(question, answer, accent) {
  const qBody = formatBody(question.body_edited ?? question.body_raw);
  const aBody = answer ? formatBody(answer.body_edited ?? answer.body_raw) : '';
  const replyUrl = mailto('reply', question.id, 'תגובה: ' + (question.subject || ''));

  return `
  <tr><td style="padding:16px 0;border-bottom:1px solid #eceae3;">
    <div style="font-size:14px;color:${accent};font-weight:600;margin-bottom:4px;">שאלה</div>
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${qBody}</div>
    ${answer ? `
    <div style="font-size:14px;color:${accent};font-weight:600;margin:10px 0 4px;">תשובה</div>
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${aBody}</div>
    ` : ''}
    <div style="margin-top:10px;">
      <a href="${replyUrl}" style="font-size:13px;color:${accent};text-decoration:none;border:1px solid ${accent};padding:4px 10px;border-radius:14px;">להגיב לשאלה הזו במייל &larr;</a>
    </div>
  </td></tr>`;
}

// כפתורי הצטרפות/הסרה בולטים בראש הגיליון - שניהם דרך מייל, לפי כתובת
// השולח בפועל (from), בלי צורך בקישור אישי או טוקן.
function renderTopButtons(list) {
  const joinUrl = mailto('join', list.slug, 'הצטרפות');
  const leaveUrl = mailto('leave', list.slug, 'הסרה');
  return `
  <tr><td style="padding:14px 24px;text-align:center;background:#faf9f6;">
    <a href="${joinUrl}" style="display:inline-block;font-size:13px;color:#fff;background:#1D9E75;text-decoration:none;padding:8px 16px;border-radius:16px;margin:3px;font-weight:600;">הצטרפות לרשימה</a>
    <a href="${leaveUrl}" style="display:inline-block;font-size:13px;color:#c04828;background:transparent;border:1px solid #c04828;text-decoration:none;padding:7px 16px;border-radius:16px;margin:3px;font-weight:600;">הסרה מהרשימה</a>
  </td></tr>`;
}

// שורת כפתורים: שליחת שאלה + פרסום מודעה בשלוש הרמות - כל הכפתורים
// פותחים mailto מוכן מראש, כדי שכל הפעולות יעבדו גם דרך תוכנת מייל בלבד.
function renderActionButtons(list, accent) {
  const buttons = [];

  if (list.show_ask_button) {
    buttons.push(`<a href="${mailto('ask', list.slug, 'שאלה חדשה')}" style="${btnStyle(accent, true)}">לשליחת שאלה חדשה</a>`);
  }

  if (list.show_ad_buttons) {
    buttons.push(`<a href="${mailto('ads', list.slug, 'מודעת שורה')}" style="${btnStyle(accent, false)}">פרסום מודעת שורה (חינם)</a>`);
    buttons.push(`<a href="${mailto('adsplus', list.slug, 'מודעה מודגשת')}" style="${btnStyle(accent, false)}">פרסום מודעה מודגשת</a>`);
    buttons.push(`<a href="${mailto('adspremium', list.slug, 'מודעה פרימיום')}" style="${btnStyle(accent, false)}">פרסום מודעה פרימיום</a>`);
  }

  if (buttons.length === 0) return '';

  return `
  <tr><td style="padding:18px 24px;text-align:center;">
    <div>
      ${buttons.join('')}
    </div>
  </td></tr>`;
}

function btnStyle(accent, filled) {
  return filled
    ? `display:inline-block;font-size:13px;color:#fff;background:${accent};text-decoration:none;padding:8px 14px;border-radius:16px;margin:3px;`
    : `display:inline-block;font-size:13px;color:${accent};background:transparent;border:1px solid ${accent};text-decoration:none;padding:7px 14px;border-radius:16px;margin:3px;`;
}

function renderInstructions(list, hasQA) {
  const lines = [];
  if (hasQA) lines.push('להגיב לשאלה - לחצו על הכפתור "להגיב לשאלה הזו במייל" ליד השאלה הרלוונטית.');
  if (list.show_ask_button) lines.push('לשאול שאלה חדשה - לחצו על הכפתור "לשליחת שאלה חדשה" למטה.');
  if (list.show_ad_buttons) lines.push('לפרסם מודעה - לחצו על אחד מכפתורי הפרסום למטה, לפי הסוג הרצוי.');
  lines.push('כל הכפתורים פותחים מייל מוכן מראש - רק כתבו את התוכן ולחצו שליחה.');

  return `
  <tr><td style="padding:10px 24px;background:#fbfaf6;border-bottom:1px solid #eceae3;">
    <div style="font-size:12px;color:#7a7970;line-height:1.7;">
      <strong>איך משתמשים בגיליון הזה:</strong><br>
      ${lines.map(l => `&bull; ${l}`).join('<br>')}
    </div>
  </td></tr>`;
}

function renderIssue({ list, qaPairs, ads, topics = [], unsubscribeToken }) {
  const accent = list.accent_color || '#1D9E75';
  const qaHtml = qaPairs.map(({ question, answer }) => renderQA(question, answer, accent)).join('');
  const adsHtml = ads.map(renderAd).join('');
  const topicsHtml = topics.map(t => renderTopic(t, accent)).join('');
  const unsubUrl = `${BASE_URL}/unsubscribe/${unsubscribeToken}`;

  const sections = {
    qa: qaPairs.length ? `<h2 style="font-size:16px;color:#2c2c2a;margin:22px 0 6px;">שאלות ותשובות השבוע</h2><table role="presentation" width="100%">${qaHtml}</table>` : '',
    topics: topics.length ? `<h2 style="font-size:16px;color:#2c2c2a;margin:22px 0 6px;">נושאים השבוע</h2><table role="presentation" width="100%">${topicsHtml}</table>` : '',
    ads: ads.length ? `<h2 style="font-size:16px;color:#2c2c2a;margin:22px 0 6px;">לוח מודעות</h2><table role="presentation" width="100%">${adsHtml}</table>` : ''
  };

  const order = (list.section_order || 'qa,topics,ads').split(',').map(s => s.trim());
  const orderedSectionsHtml = order.map(key => sections[key] || '').join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="background:${accent};padding:22px 24px;">
        <div style="color:#ffffff;font-size:13px;opacity:0.9;">${escapeHtml(BRAND_NAME)}</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:2px;">${escapeHtml(list.name)}</div>
      </td>
    </tr>
    ${renderTopButtons(list)}
    ${renderInstructions(list, qaPairs.length > 0)}
    <tr><td style="padding:0 24px;">
      ${orderedSectionsHtml}
    </td></tr>
    ${renderActionButtons(list, accent)}
    <tr>
      <td style="padding:18px 24px;background:#f6f5f1;text-align:center;">
        <div style="font-size:12px;color:#888780;">
          קיבלת מייל זה כי אתה רשום לרשימת "${escapeHtml(list.name)}" של ${escapeHtml(BRAND_NAME)}.<br>
          <a href="${unsubUrl}" style="color:#888780;">להסרה מרשימה זו</a> ·
          <a href="${BASE_URL}/archive/${list.slug}" style="color:#888780;">גיליונות קודמים</a>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderIssue, escapeHtml };
