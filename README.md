# מערכת ניוזלטרים אוטומטית

מערכת מלאה: רשימות תפוצה לפי נושא, שו"ת דו-כיווני במייל, לוח מודעות חינמי
(עם שכבת תשלום עתידית מוכנה אך כבויה), ותהליך אישור-ושליחה שבועי אוטומטי כמעט
לגמרי. **אין שום תלות ב-AI/LLM בשום מקום במערכת - אפס עלות מהצד הזה.**

## מה כבר עובד (נבדק בפועל)
- יצירת רשימה/נושא חדש דרך הפאנל (טופס אחד, 30 שניות).
- קליטת מייל נכנס (שאלה / מודעה) ומיון אוטומטי לרשימה הנכונה, דרך SendGrid Inbound Parse.
- תור אישור: עריכה קלה + אישור בלחיצה אחת.
- מנגנון תשובה במייל (reply-to ממוען לפי מזהה השאלה).
- הרכבת גיליון שבועי מעוצב (HTML) ושליחה לכל מנוי דרך SendGrid - נבדק end-to-end.
- מיתוג אחיד ("בית" אחד) עם גוון הדגשה שונה לכל רשימה בלבד - לא לוגו/תבנית שונים.
- הרשמה והסרה מרשימה בקישור אחד.

## מה זה עדיין לא כולל (ומה לעשות בהמשך)
- **תשלום בפועל** על תמונות/גיפים/קישורים - השדות קיימים במסד הנתונים
  ובטופס (`PAID_FEATURES_ENABLED=true`), אבל חיבור סליקה (Stripe/טרנזילה)
  צריך להתווסף כשתהיה מוכן.
- אחסון קבצים (תמונות/גיפים) בפועל - כרגע קבצים מצורפים ממייל נספרים בלבד;
  להעלאה אמיתית לאחסון קבוע צריך לחבר S3/Cloudinary.

## הרצה מקומית
```bash
npm install
cp .env.example .env
# ערכו את .env: הגדירו ADMIN_PASSWORD, SESSION_SECRET
npm start
```
פתחו http://localhost:3000/admin והתחברו עם הסיסמה שהגדרתם.

## חיבור מייל אמיתי דרך SendGrid + דומיין מ-GoDaddy

### א. אימות הדומיין (Domain Authentication) לשליחה
1. ב-SendGrid: **Settings -> Sender Authentication -> Authenticate Your Domain**
2. בחרו את GoDaddy כספק ה-DNS (או "Other Host" אם לא ברשימה) והזינו את הדומיין שלכם.
3. SendGrid ייתן לכם כמה רשומות **CNAME** להוסיף.
4. תתחברו ל-GoDaddy -> **My Products -> הדומיין שלכם -> DNS -> Add Record**, והוסיפו כל רשומת CNAME בדיוק כפי שSendGrid נתן (Host + Value/Points to).
5. חזרו ל-SendGrid ולחצו **Verify** - יכול לקחת בין כמה דקות לכמה שעות עד שה-DNS מתעדכן.

### ב. קליטת מיילים נכנסים (Inbound Parse)
1. ב-SendGrid: **Settings -> Inbound Parse -> Add Host & URL**
2. **Subdomain**: לדוגמה `mail` (כדי שהכתובות יהיו כמו `ask+parenting@mail.yourdomain.com`)
3. **Domain**: הדומיין שלכם מ-GoDaddy
4. **Destination URL**: `https://הדומיין-שלכם-בראילוואי/webhooks/inbound`
5. SendGrid יבקש רשומת **MX** להוספה ב-GoDaddy עבור אותו תת-דומיין - תוסיפו אותה שם.

### ג. משתני סביבה
מלאו ב-`.env` (או ב-Variables ב-Railway):
```
SENDGRID_API_KEY=  (מ-Settings -> API Keys ב-SendGrid, ה-Private key)
FROM_ADDRESS=newsletter@yourdomain.com  (כתובת בדומיין שאימתתם בסעיף א)
```

כתובות המייל לכל רשימה נבנות אוטומטית מה-slug שהגדרתם, לדוגמה:
- `ask+parenting@mail.yourdomain.com` - שאלה חדשה
- `ads+parenting@mail.yourdomain.com` - מודעה חדשה
- `reply+123@mail.yourdomain.com` - תגובה לשאלה מספר 123 (נוצר אוטומטית בקישור שבמייל)

## פריסה (deployment)
המערכת היא Node.js/Express רגילה עם קובץ SQLite - מתאימה מצוין לפריסה על
Railway. ודאו שהתיקייה `data/` נשמרת בין דיפלוימנטים (Volume מחובר),
אחרת מסד הנתונים יימחק בכל עדכון.

## מבנה הפרויקט
```
src/
  db.js              - סכמת מסד הנתונים (SQLite)
  templates.js        - העיצוב האחיד של המייל (מותג "בית" אחד + גוון לכל רשימה)
  compiler.js          - מרכיב ושולח את הגיליון השבועי דרך SendGrid, כולל תזמון cron
  routes/
    admin.js             - פאנל ניהול (login, dashboard, תור אישור)
    inbound.js             - webhook לקליטת מיילים נכנסים מ-SendGrid Inbound Parse
    public.js                - טופס מודעה ציבורי, הרשמה, הסרה
  views/                    - תבניות EJS לפאנל ולטופס המודעה
```

## דוגמת גיליון
מצורף `newsletter_preview.html` - כך בדיוק ייראה המייל שיקבל מנוי, על בסיס
הנתונים שנוצרו בבדיקה.
