# Nexup Business System

واجهة عربية RTL مبنية بـ Next.js وPrisma وPostgreSQL.

## التشغيل المحلي

1. ثبّت PostgreSQL وأنشئ قاعدة باسم `nexup_business`.
2. انسخ `.env.example` إلى `.env` ثم اضبط `DATABASE_URL` و`AUTH_SECRET`.
3. نفّذ `npm run db:migrate -- --name init`.
4. نفّذ `npm run db:seed`.
5. شغّل `npm run dev` ثم افتح `http://localhost:3000`.

## بيانات الدخول التجريبية

- البريد الإلكتروني: `admin@nexup.local`
- كلمة المرور: `Admin@12345`
