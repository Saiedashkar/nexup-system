# 🚀 دليل الرفع على Hostinger

## المتطلبات
- خطة Hostinger تدعم Node.js 18+ و PostgreSQL
- وصول SSH أو Terminal على السيرفر

## الخطوة 1: رفع الملفات
ارفع مجلد `nexup-business-system` بالكامل على السيرفر (عبر Git أو SFTP).

## الخطوة 2: تثبيت التبعيات
```bash
cd nexup-business-system
npm install
```

## الخطوة 3: إعداد قاعدة البيانات
1. أنشئ قاعدة بيانات PostgreSQL من لوحة تحكم Hostinger
2. انسخ رابط الاتصال (Database URL)
3. أنشئ ملف `.env.production`:

```bash
cp .env.production.example .env.production
```

4. عدّل `.env.production`:
   - `DATABASE_URL` ← رابط قاعدة البيانات من Hostinger
   - `AUTH_SECRET` ← شفرة عشوائية جديدة (استخدم الأمر التالي):
     ```bash
     node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
     ```

## الخطوة 4: تجهيز قاعدة البيانات
```bash
# تطبيق الهجرة
npx prisma migrate deploy

# إنشاء المستخدمين والشركاء والبيانات الأولية
node prisma/seed.js
```

## الخطوة 5: بناء المشروع
```bash
npm run build
```

## الخطوة 6: التشغيل
```bash
npm start
```

## المستخدمون الافتراضيون
كلمة المرور الافتراضية لجميع الحسابات: `Admin@12345`

| الحساب | الإيميل | الصلاحيات |
|--------|---------|-----------|
| SAIED | saied@nexup.local | SUPER_ADMIN — وصول كامل |
| ADEL | adel@nexup.local | SUPER_ADMIN — وصول كامل |
| MOATASEM | moatasem@nexup.local | REBOUND + ABOMAZEN + المكتب |
| MOUSSA | moussa@nexup.local | REBOUND + ABOMAZEN + المكتب |

**مهم:** غيّر كلمة المرور لكل مستخدم فور أول تسجيل دخول!

## إدارة المستخدمين من داخل النظام
يمكن من صفحة "إدارة المستخدمين" في الإدارة المكتبية:
- ✅ إنشاء مستخدم جديد مع تحديد صلاحياته
- ✅ تعديل الصلاحيات والأدوار
- ✅ تغيير كلمة المرور لأي مستخدم
- ✅ حذف مستخدم
- ✅ إجبار المستخدم على تغيير كلمة المرور عند أول دخول

## ملاحظات أمان للإنتاج
1. **غيّر `AUTH_SECRET`** — لا تستخدم القيمة الافتراضية
2. **غيّر كلمة المرور الافتراضية** لجميع المستخدمين
3. **فعّل HTTPS** على السيرفر
4. **احفظ `.env.production`** خارج مجلد المشروع (لا ترفعه على Git)
