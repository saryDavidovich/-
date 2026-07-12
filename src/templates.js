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
// המוטמעת ישירות בתוך ה-HTML (data URI). שימושי לתצוגה בדפדפן (תצוגה
// מקדימה/ארכיון/היסטוריה) - שם זה תמיד עובד כי דפדפנים תומכים ב-data URI
// בלי יוצא מן הכלל.
function embedImageAsDataUri(relativePath) {
  try {
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

// למייל בפועל שנשלח (useCid=true) לא משתמשים ב-data URI, כי חלק ניכר
// מתוכנות המייל - הבולטת שבהן Outlook - פשוט לא מציגות תמונות data URI
// בכלל. הפתרון הסטנדרטי שכל שירותי הניוזלטרים משתמשים בו הוא הטמעת
// התמונה כקובץ מצורף עם Content-ID (cid), ואז הפניה אליה מתוך ה-HTML
// דרך src="cid:...". זה עדיין חלק מאותה הודעה (לא קובץ נפרד שנטען
// מבחוץ), אבל נתמך כמעט בכל תוכנת מייל שקיימת.
function imageCid(itemId, index) {
  return `img-${itemId}-${index}`;
}

// גוף מייל מוכן-מראש לכל כפתור, כדי שגם מי שלא לוחץ על ריבוע ההסבר (למשל
// כי תוכנת המייל שלו לא מריצה את ה-onclick למטה) עדיין יראה הסבר ברור
// ברגע שהמייל נפתח לכתיבה, לפני ששולח.
function mailto(action, slug, subjectText, bodyText = '') {
  const params = new URLSearchParams({ subject: subjectText });
  if (bodyText) params.set('body', bodyText);
  return `mailto:${action}+${slug}@${INBOUND_DOMAIN}?${params.toString().replace(/\+/g, '%20')}`;
}

// ריבוע הסבר קטן בצבע הרשימה, שמופיע מתחת לכפתור מיד עם הלחיצה עליו (רק
// בדפדפן - בתוכנת מייל שחוסמת JS, ה-onclick פשוט מתעלם ולא שובר כלום; שם
// ההסבר עדיין קיים בגוף המייל שנפתח, ראה mailto() למעלה).
function clickHint(hintId, accent, text) {
  return `
    <div id="${hintId}" style="display:none;margin-top:8px;font-size:12px;line-height:1.6;color:${accent};background:${accent}14;border:1px solid ${accent}55;border-radius:8px;padding:8px 12px;">
      ${escapeHtml(text)}
    </div>`;
}

function showHintOnClick(hintId) {
  return `var h=document.getElementById('${hintId}');if(h)h.style.display='block';`;
}

function wordLimitBadge(item) {
  const tierLabel = { free: '', plus: 'מודעה מודגשת', premium: 'מודעה פרימיום' }[item.paid_tier] || '';
  if (!tierLabel) return '';
  return `<span style="font-size:11px;background:#f1efe8;color:#5f5e5a;padding:2px 8px;border-radius:10px;margin-inline-start:6px;">${tierLabel}</span>`;
}

// מסגרת אחידה ומעוצבת בצבע הרשימה - כל תוכן בגיליון (שאלה+תשובה, נושא,
// מודעה) יושב בתוך "כרטיס" עם גבול וגוון רקע עדין בצבע ההדגשה של הרשימה,
// כך שהגיליון מרגיש כמו מוצר אחד מעוצב, לא רשימת טקסט עם קווי הפרדה.
function cardWrapper(accent, innerHtml, { bg, border } = {}) {
  const background = bg || `${accent}0d`;
  const borderColor = border || `${accent}40`;
  return `
  <tr><td style="padding:8px 0;">
    <div style="border:1px solid ${borderColor};border-radius:12px;background:${background};padding:16px 18px;">
      ${innerHtml}
    </div>
  </td></tr>`;
}

function renderAd(item, useCid, accent) {
  const images = JSON.parse(item.images_json || '[]');
  const links = JSON.parse(item.links_json || '[]');
  const body = formatBody(item.body_edited ?? item.body_raw);

  const fg = item.text_color || '#2c2c2a';
  const linkColor = item.bg_color ? fg : '#185fa5';

  // במייל בפועל (useCid=true): src="cid:..." - הקובץ מצורף להודעה עם
  // אותו מזהה, ראה compiler.js. בתצוגה בדפדפן (preview/history/archive):
  // data URI, כי שם אין "מצורפים" בכלל, רק HTML גולמי.
  const imagesHtml = images.map((src, index) => {
    if (useCid) {
      return `<img src="cid:${imageCid(item.id, index)}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:8px;display:block;" />`;
    }
    const dataUri = embedImageAsDataUri(src);
    if (dataUri) {
      return `<img src="${dataUri}" alt="" style="max-width:100%;border-radius:8px;margin-bottom:8px;display:block;" />`;
    }
    return `<a href="${escapeHtml(absoluteUrl(src))}" style="display:inline-block;font-size:13px;color:${linkColor};text-decoration:underline;margin-bottom:8px;">לצפייה בתמונה &#8599;</a>`;
  }).join('');

  const linksHtml = links.length
    ? `<div style="margin-top:8px;">${links.map(l => `<a href="${escapeHtml(l)}" style="color:${linkColor};">${escapeHtml(l)}</a>`).join('<br>')}</div>`
    : '';

  const inner = `
    <div style="font-size:15px;line-height:1.6;color:${fg};">
      ${imagesHtml}
      ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>${wordLimitBadge(item)}<br>` : wordLimitBadge(item)}
      ${body}
      ${linksHtml}
    </div>`;

  // מודעות עם צבע רקע מותאם אישית (מודגשת/פרימיום שהאדמין צבע): הצבע
  // עצמו הופך למסגרת. אחרת (חינם, או מודגשת/פרימיום בלי צבע שנבחר) -
  // המסגרת האחידה בצבע הרשימה, כמו כל שאר התוכן בגיליון.
  return cardWrapper(accent, inner, item.bg_color ? { bg: item.bg_color, border: 'rgba(0,0,0,0.08)' } : {});
}

// אוספת את כל התמונות של המודעות בגיליון כדי לצרף אותן בפועל להודעה
// (attachments עם content_id תואם למה ש-renderAd ייצר ב-cid:...).
// נקראת מ-compiler.js רק כשבונים את המייל שבאמת יישלח.
function collectImageAttachments(ads) {
  const attachments = [];
  ads.forEach(item => {
    const images = JSON.parse(item.images_json || '[]');
    images.forEach((src, index) => {
      if (/^https?:\/\//i.test(src)) return; // תמיכה רק בתמונות שהועלו למערכת עצמה
      const ext = path.extname(src).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) return;
      const filePath = path.join(UPLOAD_DIR, path.basename(src));
      if (!fs.existsSync(filePath)) return;

      attachments.push({
        content: fs.readFileSync(filePath).toString('base64'),
        filename: path.basename(src),
        type: mime,
        disposition: 'inline',
        content_id: imageCid(item.id, index)
      });
    });
  });
  return attachments;
}

function renderTopic(item, accent) {
  const body = formatBody(item.body_edited ?? item.body_raw);
  const inner = `
    ${item.subject ? `<div style="font-size:15px;font-weight:700;color:${accent};margin-bottom:4px;">${escapeHtml(item.subject)}</div>` : ''}
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${body}</div>`;
  return cardWrapper(accent, inner);
}

function renderQA(question, answer, accent) {
  const qBody = formatBody(question.body_edited ?? question.body_raw);
  const aBody = answer ? formatBody(answer.body_edited ?? answer.body_raw) : '';
  const replyBody = 'כתבו כאן את התגובה שלכם ולחצו שליחה - היא תצורף לשאלה הזו בגיליון הבא, אחרי אישור.';
  const replyUrl = mailto('reply', question.id, 'תגובה: ' + (question.subject || ''), replyBody);
  const hintId = `hint-reply-${question.id}`;

  const inner = `
    <div style="font-size:14px;color:${accent};font-weight:600;margin-bottom:4px;">שאלה</div>
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${qBody}</div>
    ${answer ? `
    <div style="font-size:14px;color:${accent};font-weight:600;margin:10px 0 4px;">תשובה</div>
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">${aBody}</div>
    ` : ''}
    <div style="margin-top:10px;">
      <a href="${replyUrl}" onclick="${showHintOnClick(hintId)}" style="font-size:13px;color:${accent};text-decoration:none;border:1px solid ${accent};padding:4px 10px;border-radius:14px;">להגיב לשאלה הזו במייל &larr;</a>
      ${clickHint(hintId, accent, 'נפתחה עבורכם הודעת מייל מוכנה - כתבו את התגובה ולחצו שליחה.')}
    </div>`;

  return cardWrapper(accent, inner);
}

// כפתורי הצטרפות/הסרה בולטים בראש הגיליון - שניהם דרך מייל, לפי כתובת
// השולח בפועל (from), בלי צורך בקישור אישי או טוקן.
function renderTopButtons(list) {
  const accent = list.accent_color || '#1D9E75';
  const joinUrl = mailto('join', list.slug, 'הצטרפות', 'לחיצה על "שליחה" מצרפת אתכם באופן אוטומטי לרשימה - אין צורך לכתוב שום דבר בגוף ההודעה.');
  const leaveUrl = mailto('leave', list.slug, 'הסרה', 'לחיצה על "שליחה" מסירה אתכם באופן אוטומטי מהרשימה - אין צורך לכתוב שום דבר בגוף ההודעה.');
  const joinHint = 'hint-join-' + list.id;
  const leaveHint = 'hint-leave-' + list.id;
  return `
  <tr><td style="padding:14px 24px;text-align:center;background:#faf9f6;">
    <a href="${joinUrl}" onclick="${showHintOnClick(joinHint)}" style="display:inline-block;font-size:13px;color:#fff;background:#1D9E75;text-decoration:none;padding:8px 16px;border-radius:16px;margin:3px;font-weight:600;">הצטרפות לרשימה</a>
    <a href="${leaveUrl}" onclick="${showHintOnClick(leaveHint)}" style="display:inline-block;font-size:13px;color:#c04828;background:transparent;border:1px solid #c04828;text-decoration:none;padding:7px 16px;border-radius:16px;margin:3px;font-weight:600;">הסרה מהרשימה</a>
    ${clickHint(joinHint, accent, 'נפתחה הודעת מייל מוכנה - לחיצה על שליחה מצרפת אתכם אוטומטית, בלי לכתוב כלום.')}
    ${clickHint(leaveHint, accent, 'נפתחה הודעת מייל מוכנה - לחיצה על שליחה מסירה אתכם אוטומטית, בלי לכתוב כלום.')}
  </td></tr>`;
}

// שורת כפתורים: שליחת שאלה + פרסום מודעה בשלוש הרמות - כל הכפתורים
// פותחים mailto מוכן מראש, כדי שכל הפעולות יעבדו גם דרך תוכנת מייל בלבד.
function renderActionButtons(list, accent) {
  const buttons = [];
  const hints = [];

  const askBody = 'כתבו כאן את השאלה שלכם ולחצו שליחה - היא תיכנס לתור אישור ותתפרסם בגיליון הקרוב.';

  if (list.show_ask_button) {
    const hintId = 'hint-ask-' + list.id;
    buttons.push(`<a href="${mailto('ask', list.slug, 'שאלה חדשה', askBody)}" onclick="${showHintOnClick(hintId)}" style="${btnStyle(accent, true)}">לשליחת שאלה חדשה</a>`);
    hints.push(clickHint(hintId, accent, 'נפתחה הודעת מייל מוכנה - כתבו את השאלה שלכם ולחצו שליחה.'));
  }

  if (list.show_ad_buttons) {
    const hintFree = 'hint-ads-' + list.id;
    const hintPlus = 'hint-adsplus-' + list.id;
    const hintPremium = 'hint-adspremium-' + list.id;

    const freeBody = 'כתבו כאן את תוכן המודעה ולחצו שליחה - זו מודעת שורה פשוטה (טקסט בלבד), תיכנס לתור אישור ותתפרסם בגיליון הקרוב.';
    const plusBody = 'כתבו כאן את תוכן המודעה. רוצים לבחור צבע רקע? הוסיפו שורה בנוסח "צבע: כחול" (אפשר גם ורוד/ירוק/צהוב/אפור ועוד, או קוד כמו #A7D8F0). לחצו שליחה - המודעה תיכנס לתור אישור.';
    const premiumBody = 'כתבו כאן את תוכן המודעה, אפשר לצרף תמונה או גיף כקובץ מצורף למייל הזה. רוצים לבחור צבע רקע? הוסיפו שורה בנוסח "צבע: כחול" (או קוד כמו #A7D8F0). לחצו שליחה - המודעה תיכנס לתור אישור.';

    buttons.push(`<a href="${mailto('ads', list.slug, 'מודעת שורה', freeBody)}" onclick="${showHintOnClick(hintFree)}" style="${btnStyle(accent, false)}">פרסום מודעת שורה (חינם)</a>`);
    buttons.push(`<a href="${mailto('adsplus', list.slug, 'מודעה מודגשת', plusBody)}" onclick="${showHintOnClick(hintPlus)}" style="${btnStyle(accent, false)}">פרסום מודעה מודגשת</a>`);
    buttons.push(`<a href="${mailto('adspremium', list.slug, 'מודעה פרימיום', premiumBody)}" onclick="${showHintOnClick(hintPremium)}" style="${btnStyle(accent, false)}">פרסום מודעה פרימיום</a>`);

    hints.push(clickHint(hintFree, accent, 'נפתחה הודעת מייל מוכנה - מודעת שורה פשוטה, טקסט בלבד. כתבו את התוכן ולחצו שליחה.'));
    hints.push(clickHint(hintPlus, accent, 'נפתחה הודעת מייל מוכנה - כתבו את התוכן, ואם תרצו גם צבע רקע כתבו שורה כמו "צבע: כחול".'));
    hints.push(clickHint(hintPremium, accent, 'נפתחה הודעת מייל מוכנה - אפשר לצרף תמונה למייל ולבקש צבע רקע בשורה כמו "צבע: כחול".'));
  }

  if (buttons.length === 0) return '';

  return `
  <tr><td style="padding:18px 24px;text-align:center;">
    <div>
      ${buttons.join('')}
    </div>
    ${hints.join('')}
  </td></tr>`;
}

function btnStyle(accent, filled) {
  return filled
    ? `display:inline-block;font-size:13px;color:#fff;background:${accent};text-decoration:none;padding:8px 14px;border-radius:16px;margin:3px;`
    : `display:inline-block;font-size:13px;color:${accent};background:transparent;border:1px solid ${accent};text-decoration:none;padding:7px 14px;border-radius:16px;margin:3px;`;
}

// entries = מערך שטוח, כבר בסדר התצוגה הרצוי (ראה issueBuilder.js) - כל
// איבר הוא שאלה+תשובה, תגובת המשך, מודעה, או נושא - בכל סדר אפשרי, כולל
// מעורב. הוחלף ה-H2/section הישן (שאלות/נושאים/מודעות בקבוצות נפרדות)
// בזרימה חופשית אחת, כדי לאפשר גרירה חופשית לגמרי בתצוגה המקדימה.
function renderEntry(entry, accent, useCid) {
  if (entry.kind === 'qa' || entry.kind === 'followup') {
    return renderQA(entry.question, entry.answer, accent);
  }
  if (entry.kind === 'ad') {
    return renderAd(entry.item, useCid, accent);
  }
  if (entry.kind === 'topic') {
    return renderTopic(entry.item, accent);
  }
  return '';
}

function renderIssue({ list, entries = [], unsubscribeToken, useCid = false }) {
  const accent = list.accent_color || '#1D9E75';
  const bodyHtml = entries.map(entry => renderEntry(entry, accent, useCid)).join('');
  const unsubUrl = `${BASE_URL}/unsubscribe/${unsubscribeToken}`;

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
      <table role="presentation" width="100%">${bodyHtml}</table>
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

module.exports = { renderIssue, escapeHtml, collectImageAttachments };
