// עיצוב אחיד לכל הרשימות - "בית" אחד עם מיתוג עקבי.
// ההבדל בין רשימה לרשימה הוא רק צבע ההדגשה (accent) ושם הרשימה בכותרת,
// לא לוגו/פריסה/גופן שונה. זה מה שגורם לזה להרגיש כמו גוף אחד ומקצועי,
// ולא כמו כמה אתרים חובבניים שונים.

const BRAND_NAME = process.env.BRAND_NAME || 'הרשימות שלנו';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  const imagesHtml = images.length
    ? images.map(src => `<img src="${escapeHtml(src)}" style="max-width:100%;border-radius:8px;margin-top:8px;" />`).join('')
    : '';
  const linksHtml = links.length
    ? `<div style="margin-top:8px;">${links.map(l => `<a href="${escapeHtml(l)}" style="color:#185fa5;">${escapeHtml(l)}</a>`).join('<br>')}</div>`
    : '';

  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #eceae3;">
    <div style="font-size:15px;line-height:1.6;color:#2c2c2a;">
      ${item.subject ? `<strong>${escapeHtml(item.subject)}</strong>${wordLimitBadge(item)}<br>` : wordLimitBadge(item)}
      ${body}
      ${imagesHtml}
      ${linksHtml}
    </div>
  </td></tr>`;
}

function renderQA(question, answer, accent) {
  const qBody = escapeHtml(question.body_edited ?? question.body_raw).replace(/\n/g, '<br>');
  const aBody = answer ? escapeHtml(answer.body_edited ?? answer.body_raw).replace(/\n/g, '<br>') : '';
  const replyUrl = `mailto:reply+${question.id}@REPLYDOMAIN?subject=${encodeURIComponent('תגובה: ' + (question.subject || ''))}`;

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

function renderIssue({ list, qaPairs, ads, unsubscribeToken }) {
  const accent = list.accent_color || '#1D9E75';
  const qaHtml = qaPairs.map(({ question, answer }) => renderQA(question, answer, accent)).join('');
  const adsHtml = ads.map(renderAd).join('');
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
    <tr><td style="padding:20px 24px;">
      ${qaPairs.length ? `<h2 style="font-size:16px;color:#2c2c2a;margin:0 0 6px;">שאלות ותשובות השבוע</h2>
      <table role="presentation" width="100%">${qaHtml}</table>` : ''}

      ${ads.length ? `<h2 style="font-size:16px;color:#2c2c2a;margin:22px 0 6px;">לוח מודעות</h2>
      <table role="presentation" width="100%">${adsHtml}</table>` : ''}
    </td></tr>
    <tr>
      <td style="padding:18px 24px;background:#f6f5f1;text-align:center;">
        <div style="font-size:12px;color:#888780;">
          קיבלת מייל זה כי אתה רשום לרשימת "${escapeHtml(list.name)}" של ${escapeHtml(BRAND_NAME)}.<br>
          <a href="${unsubUrl}" style="color:#888780;">להסרה מרשימה זו</a>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderIssue, escapeHtml };
