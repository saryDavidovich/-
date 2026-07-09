// עיצוב אחיד לכל הרשימות - "בית" אחד עם מיתוג עקבי.
// ההבדל בין רשימה לרשימה הוא רק צבע ההדגשה (accent) ושם הרשימה בכותרת,
// לא לוגו/פריסה/גופן שונה. זה מה שגורם לזה להרגיש כמו גוף אחד ומקצועי,
// ולא כמו כמה אתרים חובבניים שונים.
//
// עיקרון מנחה: כל פעולה (שאלה, מודעה, הצטרפות, הסרה, תגובה) ניתנת לביצוע
// כ-mailto בלבד, כדי שגם לקוחות עם גישה מוגבלת לדפדפן (כמו "נטו מייל")
// יוכלו להשתמש בכל התכונות בלי לצאת מתוכנת המייל שלהם.

const BRAND_NAME = process.env.BRAND_NAME || 'הרשימות שלנו';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN || 'yourdomain.com';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function absoluteUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
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
  const body = escapeHtml(item.body_edited ?? item.body_raw).replace(/\n/g, '<br>');

  const bg = item.bg_color || 'transparent';
  const fg = item.text_color || '#2c2c2a';
  const boxStyle = item.bg_color
    ? `background:${bg};color:${fg};padding:14px;border-radius:8px;`
    : `color:${fg};padding:14px 0;`;

  // חשוב: לא מטמיעים את התמונה כ-<img> שנטען אוטומטית - זה גורם לחלק
  // מהמסננים (כמו נטפרי בצד הלקוח) לעכב את המייל שעות עד שהתמונה נסרקת.
  // במקום זה, קישור טקסט רגיל שנפתח רק בלחיצה יזומה של הלקוח.
  const imagesHtml = images.length
    ? `<div style="margin-top:8px;">${images.map(src => `<a href="${escapeHtml(absoluteUrl(src))}" style="display:inline-block;font-size:13px;color:${item.bg_color ? fg : '#185fa5'};text-decoration:underline;">לצפייה בתמונה &#8599;</a>`).join('<br>')}</div>`
    : '';
  const linksHtml = links.length
    ? `<div style="margin-top:8px;">${links.map(l => `<a href="${escapeHtml(l)}" style="color:${item.bg_color ? fg : '#185fa5'};">${escapeHtml(l)}</a>`).join('<br>')}</div>`
    : '';

  return `
  <tr><td style="border-bottom:1px solid #eceae3;">
    <div style="font-size:15px;line-height:1.6;${boxStyle}">
      ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>${wordLimitBadge(item)}<br>` : wordLimitBadge(item)}
      ${body}
      ${imagesHtml}
      ${linksHtml}
    </div>
  </td></tr>`;
}

function renderTopic(item, accent) {
  const body = escapeHtml(item.body_edited ?? item.body_raw).replace(/\n/g, '<br>');
  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #eceae3;">
    ${item.subject ? `<div style="font-size:15px;font-weight:700;color:${accent};margin-bottom:4px;">${escapeHtml(item.subject)}</div>` : ''}
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${body}</div>
  </td></tr>`;
}

function renderQA(question, answer, accent) {
  const qBody = escapeHtml(question.body_edited ?? question.body_raw).replace(/\n/g, '<br>');
  const aBody = answer ? escapeHtml(answer.body_edited ?? answer.body_raw).replace(/\n/g, '<br>') : '';
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
