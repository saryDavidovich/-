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
// טקסטי ההסבר המדויקים שהמערכת עצמה מזינה מראש לתוך גוף המיילים (mailto
// body) - שמורים כאן במקום אחד כדי ש-inbound.js יוכל להסיר אותם אוטומטית
// אם לקוח שולח בחזרה בלי למחוק אותם (ראה getKnownInstructionStrings למטה).
const INSTR_ASK = 'כתבו כאן את השאלה שלכם ולחצו שליחה - היא תיכנס לתור אישור ותתפרסם בגיליון הקרוב.';
const INSTR_FREE_AD = 'כתבו כאן את תוכן המודעה ולחצו שליחה - זו מודעת שורה פשוטה (טקסט בלבד), תיכנס לתור אישור ותתפרסם בגיליון הקרוב.';
const INSTR_REPLY = 'כתבו כאן את התגובה שלכם ולחצו שליחה - היא תצורף לשאלה הזו בגיליון הבא, אחרי אישור.';
const INSTR_CONTACT = 'כתבו כאן את ההודעה שלכם למנהל הרשימה ולחצו שליחה - זו פנייה פרטית, היא לא מתפרסמת בגיליון.';

function colorNamesList(list) {
  try {
    const palette = JSON.parse(list.ad_color_palette_json || '[]');
    return palette.map(c => c.name).filter(Boolean);
  } catch (e) { return []; }
}

// רשימת שמות הצבעים מוטמעת ישירות בטיוטת המייל (טקסט בלבד, לא ניתן להראות
// עיגולי צבע אמיתיים בתוך תוכנת מייל חיצונית) - כך שהלקוח רואה בדיוק אילו
// שמות אפשר לבקש, בלי צורך לחפש את זה במקום אחר.
function instrPlusAd(list) {
  const names = colorNamesList(list);
  const example = names[0] || 'כחול';
  const namesText = names.length ? ` הצבעים הזמינים: ${names.join(', ')}.` : '';
  return `כתבו כאן את תוכן המודעה. רוצים לבחור צבע רקע? הוסיפו שורה בנוסח "צבע: ${example}".${namesText} לחצו שליחה - המודעה תיכנס לתור אישור.`;
}
function instrPremiumAd(list) {
  const names = colorNamesList(list);
  const example = names[0] || 'כחול';
  const namesText = names.length ? ` הצבעים הזמינים: ${names.join(', ')}.` : '';
  return `כתבו כאן את תוכן המודעה, אפשר לצרף תמונה או גיף כקובץ מצורף למייל הזה. רוצים לבחור צבע רקע? הוסיפו שורה בנוסח "צבע: ${example}".${namesText} לחצו שליחה - המודעה תיכנס לתור אישור.`;
}

// כל טקסטי ההוראה שהמערכת עצמה מכניסה, עבור רשימה מסוימת - inbound.js
// מסיר כל הופעה מדויקת שלהם מהתוכן שנשמר, כדי שלא "ידביקו" לתוך המודעה/
// תשובה/נושא בפועל אם לקוח שולח בחזרה בלי למחוק את הטיוטה המקורית.
function getKnownInstructionStrings(list) {
  return [INSTR_ASK, INSTR_FREE_AD, INSTR_REPLY, INSTR_CONTACT, instrPlusAd(list), instrPremiumAd(list)];
}

function clickHint(hintId, accent, text) {
  return `
    <div id="${hintId}" style="display:none;margin-top:10px;font-size:12px;line-height:1.7;color:${accent};background:${accent}12;border:1px solid ${accent}45;border-radius:10px;padding:10px 14px;text-align:right;">
      <span style="margin-inline-end:4px;">💡</span>${escapeHtml(text)}
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
  const replyUrl = mailto('reply', question.id, 'תגובה: ' + (question.subject || ''), INSTR_REPLY);
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

// שורת כפתורים: שליחת שאלה + פרסום מודעה (כל רמה עם מתג הצגה נפרד) +
// יצירת קשר - כל הכפתורים פותחים mailto מוכן מראש.
function renderActionButtons(list, accent) {
  const buttons = [];
  const hints = [];

  if (list.show_ask_button) {
    const hintId = 'hint-ask-' + list.id;
    buttons.push(`<a href="${mailto('ask', list.slug, 'שאלה חדשה', INSTR_ASK)}" onclick="${showHintOnClick(hintId)}" style="${btnStyle(accent, true)}">לשליחת שאלה חדשה</a>`);
    hints.push(clickHint(hintId, accent, 'נפתחה הודעת מייל מוכנה - כתבו את השאלה שלכם ולחצו שליחה.'));
  }

  if (list.show_ads_free) {
    const hintFree = 'hint-ads-' + list.id;
    buttons.push(`<a href="${mailto('ads', list.slug, 'מודעת שורה', INSTR_FREE_AD)}" onclick="${showHintOnClick(hintFree)}" style="${btnStyle(accent, false)}">פרסום מודעת שורה (חינם)</a>`);
    hints.push(clickHint(hintFree, accent, 'נפתחה הודעת מייל מוכנה - מודעת שורה פשוטה, טקסט בלבד. כתבו את התוכן ולחצו שליחה.'));
  }
  if (list.show_ads_plus) {
    const hintPlus = 'hint-adsplus-' + list.id;
    buttons.push(`<a href="${mailto('adsplus', list.slug, 'מודעה מודגשת', instrPlusAd(list))}" onclick="${showHintOnClick(hintPlus)}" style="${btnStyle(accent, false)}">פרסום מודעה מודגשת</a>`);
    hints.push(clickHint(hintPlus, accent, 'נפתחה הודעת מייל מוכנה - כתבו את התוכן. רשימת הצבעים הזמינים כתובה בטיוטה עצמה.'));
    buttons.push(renderExpandableTest(list, accent));
  }
  if (list.show_ads_premium) {
    const hintPremium = 'hint-adspremium-' + list.id;
    buttons.push(`<a href="${mailto('adspremium', list.slug, 'מודעה פרימיום', instrPremiumAd(list))}" onclick="${showHintOnClick(hintPremium)}" style="${btnStyle(accent, false)}">פרסום מודעה פרימיום</a>`);
    hints.push(clickHint(hintPremium, accent, 'נפתחה הודעת מייל מוכנה - אפשר לצרף תמונה. רשימת הצבעים הזמינים כתובה בטיוטה עצמה.'));
  }

  const hintContact = 'hint-contact-' + list.id;
  buttons.push(`<a href="${mailto('contact', list.slug, 'פנייה למנהל הרשימה', INSTR_CONTACT)}" onclick="${showHintOnClick(hintContact)}" style="${btnStyle(accent, false)}">צור קשר</a>`);
  hints.push(clickHint(hintContact, accent, 'נפתחה הודעת מייל מוכנה - זו פנייה פרטית למנהל, לא מתפרסמת בגיליון.'));

  if (buttons.length === 0) return '';

  return `
  <tr><td style="padding:18px 24px;text-align:center;">
    <div>
      ${buttons.join('')}
    </div>
    ${hints.join('')}
  </td></tr>`;
}

// ניסיון: פאנל שנפתח בלחיצה בלי JavaScript בכלל (checkbox hack - CSS
// טהור). נוסף כרגע רק לכפתור "מודעה מודגשת", בנוסף לכפתור הרגיל שכבר
// עובד (לא במקומו) - כדי לבדוק אם זה בפועל נתמך אצל הלקוחות שלך לפני
// שמחליטים אם להרחיב את זה לשאר הכפתורים.
function renderExpandableTest(list, accent) {
  const names = colorNamesList(list);
  const swatchesText = names.length ? names.join(', ') : '(לא הוגדרו צבעים)';
  const mailtoUrl = mailto('adsplus', list.slug, 'מודעה מודגשת', instrPlusAd(list));

  return `
    <label style="cursor:pointer;display:inline-block;margin:3px;vertical-align:top;">
      <input type="checkbox" class="cbhack-toggle" style="display:none;" />
      <span style="display:inline-block;font-size:13px;color:#fff;background:${accent};text-decoration:none;padding:8px 14px;border-radius:16px;">🧪 מודעה מודגשת - לחצו לפרטים (ניסיון)</span>
      <label class="cbhack-box" style="display:none;text-align:right;margin-top:10px;max-width:280px;border:1px solid ${accent}55;background:${accent}12;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.7;color:#2c2c2a;cursor:default;">
        <strong>מודעה מודגשת</strong> - המודעה תפורסם בתוך מסגרת צבעונית בולטת בגיליון.<br><br>
        צבעים שאפשר לבקש: ${escapeHtml(swatchesText)}
        <br><br>
        <a href="${mailtoUrl}" style="display:inline-block;margin-top:4px;font-size:13px;color:#fff;background:${accent};padding:8px 14px;border-radius:16px;text-decoration:none;">לפתיחת המייל ולכתיבת המודעה &rarr;</a>
      </label>
    </label>`;
}

function btnStyle(accent, filled) {
  return filled
    ? `display:inline-block;font-size:13px;color:#fff;background:${accent};text-decoration:none;padding:8px 14px;border-radius:16px;margin:3px;`
    : `display:inline-block;font-size:13px;color:${accent};background:transparent;border:1px solid ${accent};text-decoration:none;padding:7px 14px;border-radius:16px;margin:3px;`;
}

// [renderColorLegend הוסרה] - רשימת הצבעים כבר לא מוצגת בגיליון שנשלח
// למנויים; היא מוטמעת ישירות בטיוטת המייל של הלקוח (ראה instrPlusAd /
// instrPremiumAd למעלה) - שם היא רלוונטית (כשהוא בוחר צבע), לא כאן.

// כפתורי הצטרפות לשאר הרשימות הפעילות + כפתור הצטרפות לכולן ביחד, בתחתית
// הגיליון - כדי שמנוי לרשימה אחת יגלה בקלות שיש עוד רשימות ויוכל להצטרף
// אליהן, הכל עדיין דרך מייל בלבד.
function renderOtherListsPromo(list) {
  const db = require('./db');
  const otherLists = db.prepare('SELECT * FROM lists WHERE active = 1 AND id != ? ORDER BY name ASC').all(list.id);
  if (otherLists.length === 0) return '';

  const joinAllUrl = mailto('joinall', 'all', 'הצטרפות לכל הרשימות', 'לחיצה על "שליחה" מצרפת אתכם אוטומטית לכל הרשימות הפעילות - אין צורך לכתוב שום דבר בגוף ההודעה.');
  const buttons = otherLists.map(l => {
    const url = mailto('join', l.slug, 'הצטרפות', `לחיצה על "שליחה" מצרפת אתכם באופן אוטומטי לרשימת "${l.name}" - אין צורך לכתוב שום דבר בגוף ההודעה.`);
    return `<a href="${url}" style="display:inline-block;font-size:12px;color:${l.accent_color || '#1D9E75'};background:transparent;border:1px solid ${l.accent_color || '#1D9E75'};text-decoration:none;padding:5px 12px;border-radius:14px;margin:3px;">${escapeHtml(l.name)}</a>`;
  }).join('');

  return `
  <tr><td style="padding:16px 24px;background:#faf9f6;text-align:center;">
    <div style="font-size:12px;color:#5f5e5a;margin-bottom:8px;">רשימות נוספות שאולי יעניינו אתכם:</div>
    <div>${buttons}</div>
    <div style="margin-top:10px;">
      <a href="${joinAllUrl}" style="display:inline-block;font-size:12px;color:#fff;background:#2c2c2a;text-decoration:none;padding:6px 14px;border-radius:14px;">הצטרפות לכל הרשימות בבת אחת</a>
    </div>
  </td></tr>`;
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
<head>
<meta charset="utf-8">
<style>
  /* ניסוי: פאנל שנפתח בלחיצה בלי שום JavaScript (checkbox hack) - ראה
     renderExpandableBoxTest ב-templates.js. אם זה לא נתמך, ה-checkbox
     פשוט לא יעשה כלום ויישאר מוסתר - שום דבר לא "נשבר". */
  .cbhack-box { display: none; }
  .cbhack-toggle:checked ~ .cbhack-box { display: block !important; }
</style>
</head>
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
    ${renderOtherListsPromo(list)}
    <tr>
      <td style="padding:18px 24px;background:#f6f5f1;text-align:center;">
        <div style="font-size:12px;color:#888780;margin-bottom:10px;">
          קיבלת מייל זה כי אתה רשום לרשימת "${escapeHtml(list.name)}" של ${escapeHtml(BRAND_NAME)}.
        </div>
        <a href="${BASE_URL}/archive/${list.slug}" style="display:inline-block;font-size:12px;color:${accent};background:transparent;border:1px solid ${accent};text-decoration:none;padding:6px 14px;border-radius:14px;margin:3px;">גיליונות קודמים</a>
        <a href="${unsubUrl}" style="display:inline-block;font-size:12px;color:#c04828;background:transparent;border:1px solid #c04828;text-decoration:none;padding:6px 14px;border-radius:14px;margin:3px;">להסרה מרשימה זו</a>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderIssue, escapeHtml, collectImageAttachments, getKnownInstructionStrings };
