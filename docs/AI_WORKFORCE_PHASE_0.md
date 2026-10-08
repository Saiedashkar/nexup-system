# NEXUP AI WORKFORCE — PHASE 0 REPORT (READ-ONLY INVENTORY)

> **Routing note (2026-10-08):** any reference here to `office/ai-workforce/` as
> the "Command Center (UI جديد)" is historical naming. The owner's current UI is
> **`/command`** (NEXUP COMMAND — Executive Command Center).

> **الحالة:** تقرير مخزون فقط. لم يتم تنفيذ أي بناء، ولا أي تعديل على الكود أو قاعدة البيانات.
>
> **الفرع:** `feature/ai-workforce-foundation`
> **Baseline:** `bf701fac705cfbb2672cf931dda3962e7fafc617` (= `origin/master` وقت إنشاء الفرع)
> **التاريخ:** 2026-09-29

---

## 0. منهجية المخزون

كل ما في هذا التقرير مستخرج من قراءة الملفات والاستعلامات النصية فقط:

- قراءة كاملة: `prisma/schema.prisma` (736 سطر)، `src/middleware.ts`، `src/lib/auth.ts`، `src/lib/soft-delete-models.ts`، `package.json`، `vitest.config.ts`، `AGENTS.md`، `CLAUDE.md`، `DESIGN.md`، `DEPLOY.md`.
- حصر آلي: 61 ملف `route.ts` تحت `src/app/api`، 35 ملف `page.tsx`، 12 مكوّن، 8 ملفات في `src/lib`، 4 ملفات اختبار.
- بحث نصي عن الـintegrations: `openai|anthropic|langchain|hermes|mcp|webhook|cron|scheduler|twitter|x.com|whatsapp|facebook|instagram|linkedin|n8n|zapier|axios|nodemailer|twilio|sendgrid|resend` → **لا توجد أي نتائج حقيقية** (التطابق الوحيد كان نصًّا عربيًّا لكلمة "هرمس" داخل ملف اختبار).
- **لم يُنفّذ:** أي migration، أي كتابة في قاعدة البيانات، أي deploy، أي تعديل على `master`.

---

## 1. Current Architecture Map

```
┌──────────────────────────────────────────────────────────────┐
│  Vercel Project: nexup-system → https://app.hymanna.com      │
└──────────────────────────────────────────────────────────────┘
                          │
  ┌───────────────────────▼────────────────────────────────┐
  │ L1 — Presentation                                      │
  │ Next.js 16.3.2 App Router (webpack) + React 19.2.8      │
  │ Tailwind v4 · RTL · 35 page.tsx · 12 مكوّن             │
  └───────────────────────┬────────────────────────────────┘
                          │  fetch() same-origin
  ┌───────────────────────▼────────────────────────────────┐
  │ L2 — HTTP Gate: src/middleware.ts                      │
  │ matcher: كل المسارات ما عدا _next/static|image        │
  │ publicPaths = /login, /api/auth/login, /api/auth/logout│
  │ ↳ غير مصادق + /api/*  → 401 JSON                       │
  │ ↳ غير مصادق + صفحة    → redirect /login?next=          │
  │ ↳ SUPER_ADMIN         → bypass كامل                    │
  │ ↳ businessRoutes      → 403 / redirect                 │
  │ ↳ officeFinanceRoutes → 403 / redirect                 │
  └───────────────────────┬────────────────────────────────┘
                          │
  ┌───────────────────────▼────────────────────────────────┐
  │ L3 — API Routes (61 × route.ts, runtime = "nodejs")    │
  │ 58 منها تستدعي getCurrentSession() داخليًّا            │
  └───────────────────────┬────────────────────────────────┘
                          │
  ┌───────────────────────▼────────────────────────────────┐
  │ L4 — Business Services (src/lib)                       │
  │ capital.ts (863) · soft-delete.ts (290) ·              │
  │ performance.ts (315, client-side) · auth.ts (126) ·    │
  │ r2.ts (114) · prisma.ts (81) · soft-delete-models (39) │
  └───────────────────────┬────────────────────────────────┘
                          │
  ┌───────────────────────▼────────────────────────────────┐
  │ L5 — Prisma 7.9.1 + @prisma/adapter-pg                 │
  │ Client Extension يفلتر deletedAt: null تلقائيًّا       │
  └───────────────────────┬────────────────────────────────┘
                          │
  ┌───────────────────────▼────────────────────────────────┐
  │ L6 — Supabase Postgres (pooler :6543) = Source of Truth│
  └────────────────────────────────────────────────────────┘

خارج المسار: Cloudflare R2 / S3 (src/lib/r2.ts) لرفع صور الإيصالات فقط.
```

**حقائق معمارية جوهرية:**

| # | الحقيقة | الأثر على AI Workforce |
|---|---------|------------------------|
| 1 | `middleware.ts` هو نقطة تحكّم واحدة لكل مسار | أي مسار جديد للـAI Workforce يُحمى من نفس المكان — لا حاجة لدخول نظام Auth الجديد |
| 2 | الجلسة JWT (HS256/jose) في كوكي `nexup_session`، صلاحية 8 ساعات | لا يوجد token للخدمات/الـmachine-to-machine ⇒ أي Runtime خارجي يحتاج آلية مصادقة خاصة (قرار Phase 1) |
| 3 | التصريح مبني على 3 أدوار + 4 أعلام صلاحية + `Business.slug` | أدوات الـAI يجب أن تحمل "هوية مُنفّذ" (impersonated session) لا أن تتفادى الـRBAC |
| 4 | `src/lib/prisma.ts` فيه Prisma Client Extension يفلتر `deletedAt: null` لكل موديل موجود في `SOFT_DELETE_MODELS` | أي جدول جديد **لا** يُضاف للقائمة تلقائيًّا ⇒ سلوك متوقّع ومحدود |
| 5 | طبقة الخدمات رقيقة (Business logic غالبًا داخل الـroutes) | جزء كبير من الـ"Atomic Tools" سيغلّف منطقًا موجودًا في الـroutes لا في `src/lib` |
| 6 | لا يوجد scheduler/cron ولا job queue ولا AI SDK | كل الـRuntime والجدولة والـAI providers ستكون **إضافة جديدة تمامًا** |
| 7 | Serverless على Vercel | لا يمكن الاعتماد على عمليات طويلة الأمد داخل العملية نفسها ⇒ Jobs تحتاج Runtime Adapter |

---

## 2. Existing Modules

| # | الموديول | الصفحات | الـAPIs | الموديلات | ملاحظات |
|---|----------|---------|---------|-----------|---------|
| M1 | **Auth / RBAC** | `/login` | `/api/auth/{login,logout,me}` | `User` | JWT، كوكي، 3 أدوار، 4 أعلام صلاحيات، `mustChangePassword` |
| M2 | **Users** | `/office/admin/users` | `/api/admin/users`, `/api/admin/users/[id]`, `/api/users` | `User` | إدارة كاملة + force logout/تغيير كلمة مرور |
| M3 | **Clients** | `/clients`, `/office/nexup/clients` | `/api/clients`, `/api/clients/[id]` | `Client` | `@@unique([businessId, phone])`، tier، soft-delete، روابط `wa.me` |
| M4 | **Projects** | `/clients` (تابلو)، `/office/nexup/*`، `/office/abomazen/clients` | `/api/projects`, `/api/projects/[id]`, `/api/nexup/projects`, `/api/abomazen/projects`, `/api/rebound/projects` | `ProjectRecord` | لكل Business مسار مختلف لنفس المفهوم |
| M5 | **Services** | داخل نماذج العملاء | `/api/services` | `ServiceType` | قائمة أنواع خدمات |
| M6 | **Finance Core** | `/finance` | `/api/pool`, `/api/withdrawals(/[id])`, `/api/expenses(/[id])`, `/api/client-payments(/[id])`, `/api/payment-receipts(/[id])` | `PoolTransaction`, `Withdrawal`, `Expense`, `ClientPayment`, `PaymentReceipt` | حسبة SAR→EGP مع عمولة 10% |
| M7 | **Nexup Profit Ledger** | `/office/nexup/profit-distribution` | `/api/nexup/profit-ledger(/[id])`, `/api/nexup/dashboard` | `NexupProfitLedger`, `ProfitTransfer` | توزيع أرباح |
| M8 | **Partners** | `/office/admin/partners`, `/office/admin/partner-ledger` | `/api/office/partners(/[id])`, `/api/office/partner-transactions(/[id])` | `Partner`, `BusinessOwnership`, `PartnerTransaction` | ملكية + أرصدة |
| M9 | **Capital** | `/office/admin/capital` | `/api/office/capital-ledger`, `/api/office/capital-contributions(/[id],/audit)`, `/api/office/capital-spends(/[id])` | `CapitalContribution`, `CapitalSpend` | **أكثر موديول مُهندَس** (863 سطر خدمة) |
| M10 | **Office Expenses** | `/office/admin/office-expenses` | `/api/office/office-expenses(/[id])`, `/api/office/fixed-expenses(/[id],/generate)` | `OfficeExpense`, `FixedExpense` | مولّد مصروفات دورية |
| M11 | **Profit Transfers / Allocation** | `/office/admin/profit-transfers`, `/office/admin/settings` | `/api/office/profit-transfers(/[id])`, `/api/office/allocation-settings(/[id])` | `ProfitTransfer`, `OfficeAllocationSetting` | نسب التوزيع |
| M12 | **Office Tools** | `/office/admin/tools` | `/api/office/tools(/[id])` | `OfficeTool`, `OfficeToolPayment` | ⚠️ **"Tools" هنا = اشتراكات/أدوات مدفوعة، ليست AI Tools** |
| M13 | **Rebound Subscriptions** | `/office/rebound/*` | `/api/rebound/subscriptions(/[id])`, `/api/rebound/subscription-invoices`, `/api/rebound/dashboard` | `Subscription`, `SubscriptionInvoice` | دورة فواتير |
| M14 | **Abomazen Deals / Properties** | `/office/abomazen/*` | `/api/abomazen/deals(/[id])`, `/api/abomazen/properties(/[id])`, `/api/abomazen/subscriptions`, `/api/abomazen/subscription-invoices`, `/api/abomazen/dashboard` | `Deal`, `Property`, `Subscription`, `SubscriptionInvoice` | أكبر مجموعة صفحات |
| M15 | **Recycle Bin** | `/office/admin/recycle-bin` | `/api/recycle-bin` | 20 موديل في `SOFT_DELETE_MODELS` | استرجاع/إتلاف نهائي |
| M16 | **Audit / Activity Log** | — (بدون صفحة) | — | `ActivityLog` | ⚠️ **جزئي**: يُكتب من 10 مواضع فقط (Abomazen + admin/users). لا تدقيق شامل |
| M17 | **Dashboards / Analytics** | `/office/*/dashboard`, `/office/nexup/analytics` | `/api/office/stats`, `/api/office/admin-stats`, `/api/*/dashboard` | (تجميعية) | قراءة فقط |
| M18 | **Tools / Admin utilities** | `/office/admin/tools` + `/office/admin/settings` | — | `OfficeTool` | إعدادات النظام |

**الأقسام الناقصة تمامًا (فرص AI Workforce):** Command Center, Agent Registry, Jobs/Scheduler, AI Tool Registry, Approvals, Run/Audit Trails, Runtime Adapter. **لا يوجد أي أثر لأي منها في الكود.**

---

## 3. Existing APIs — Inventory

**المجموع: 61 ملف `route.ts`.** 58 منها تستدعي `getCurrentSession()` داخليًّا. الثلاثة الاستثناءات:

| المسار | الحماية |
|--------|---------|
| `/api/auth/login` | عام (publicPath) |
| `/api/auth/logout` | عام (publicPath) |
| `/api/users` (GET) | **محمي بالـmiddleware فقط** — لا فحص جلسة ولا دور داخل الـhandler، وأي مستخدم مسجّل يستطيع قراءة `id/name/role` لكل المستخدمين ⚠️ |

الجدول التالي يُجمّع المسارات بحسب النطاق، وكل صف يمثّل مجموعة لها نفس خصائص المصادقة والوصول:

| # | Path(s) | Purpose | R/W | Auth | Business Scope | Models / Service |
|---|---------|---------|-----|------|----------------|------------------|
| 1 | `/api/auth/login` | تسجيل دخول وإصدار الجلسة | W (كوكي) | عام | — | `User`, `auth.ts`, bcryptjs |
| 2 | `/api/auth/logout` | إنهاء الجلسة | W (كوكي) | عام | — | `auth.ts` |
| 3 | `/api/auth/me` | بيانات الجلسة الحالية | R | جلسة | — | `auth.ts` |
| 4 | `/api/users` | قائمة المستخدمين المبسّطة | R | middleware فقط ⚠️ | عام داخليًّا | `User` |
| 5 | `/api/admin/users`, `/api/admin/users/[id]` | إدارة المستخدمين/الصلاحيات | R/W | `officeFinanceRoutes` + `canAccessOfficeFinanceFull` | المكتب | `User`, `ActivityLog` |
| 6 | `/api/clients`, `/api/clients/[id]` | عملاء (إضافة/تعديل/حذف ناعم) | R/W | جلسة (لا نطاق Business في middleware) | مشترك | `Client`, `soft-delete.ts` |
| 7 | `/api/projects`, `/api/projects/[id]` | مشاريع/صفقات عامة | R/W | `businessRoutes.nexup` | Nexup | `ProjectRecord`, `ClientPayment` |
| 8 | `/api/services` | أنواع الخدمات | R | `businessRoutes.nexup` | Nexup | `ServiceType` |
| 9 | `/api/pool` | حركات الصندوق (IN/OUT) | R/W | `businessRoutes.nexup` | Nexup | `PoolTransaction`, `capital.ts` |
| 10 | `/api/withdrawals`, `/api/withdrawals/[id]` | سحب SAR→EGP بعمولة | R/W | `businessRoutes.nexup` | Nexup | `Withdrawal`, `PoolTransaction`, `Expense` |
| 11 | `/api/expenses`, `/api/expenses/[id]` | مصروفات | R/W | `businessRoutes.nexup` (+rebound) | Nexup/Rebound | `Expense` |
| 12 | `/api/client-payments`, `/api/client-payments/[id]` | دفعات العملاء | R/W | `businessRoutes.nexup` | Nexup | `ClientPayment`, `ProjectRecord` |
| 13 | `/api/payment-receipts`, `/api/payment-receipts/[id]` | إيصالات (رفع/حذف) | R/W | جلسة | Nexup | `PaymentReceipt`, **`r2.ts`** |
| 14 | `/api/nexup/dashboard`, `/api/nexup/projects` | لوحة وبيانات Nexup | R | `businessRoutes.nexup` | Nexup | تجميعي |
| 15 | `/api/nexup/profit-ledger`, `/[id]` | دفتر الأرباح | R/W | `businessRoutes.nexup` | Nexup | `NexupProfitLedger` |
| 16 | `/api/rebound/dashboard` | لوحة Rebound | R | `businessRoutes.rebound` | Rebound | تجميعي |
| 17 | `/api/rebound/projects` | مشاريع Rebound | R | `businessRoutes.rebound` | Rebound | `ProjectRecord` |
| 18 | `/api/rebound/subscriptions`, `/[id]` | اشتراكات | R/W | `businessRoutes.rebound` | Rebound | `Subscription` |
| 19 | `/api/rebound/subscription-invoices` | فواتير اشتراك | R/W | `businessRoutes.rebound` | Rebound | `SubscriptionInvoice` |
| 20 | `/api/abomazen/dashboard` | لوحة Abomazen | R | `businessRoutes.abomazen` | Abomazen | تجميعي |
| 21 | `/api/abomazen/deals`, `/[id]` | صفقات | R/W | `businessRoutes.abomazen` | Abomazen | `Deal`, `ActivityLog` |
| 22 | `/api/abomazen/projects` | مشاريع | R/W | `businessRoutes.abomazen` | Abomazen | `ProjectRecord`, `ActivityLog` |
| 23 | `/api/abomazen/properties`, `/[id]` | عقارات | R/W | `businessRoutes.abomazen` | Abomazen | `Property`, `ActivityLog` |
| 24 | `/api/abomazen/subscriptions` | اشتراكات | R/W | `businessRoutes.abomazen` | Abomazen | `Subscription`, `ActivityLog` |
| 25 | `/api/abomazen/subscription-invoices` | فواتير | R/W | `businessRoutes.abomazen` | Abomazen | `SubscriptionInvoice`, `ActivityLog` |
| 26 | `/api/office/stats` | إحصاءات المكتب | R | جلسة | المكتب | تجميعي |
| 27 | `/api/office/admin-stats` | إحصاءات إدارية | R | `officeFinanceRoutes` | المكتب | تجميعي |
| 28 | `/api/office/capital-ledger` | دفتر رأس المال | R | `officeFinanceRoutes` | المكتب | `capital.ts::getCapitalLedger` |
| 29 | `/api/office/capital-contributions`, `/[id]`, `/audit` | مساهمات رأس المال + تدقيق | R/W | جلسة فقط ⚠️ | المكتب | `CapitalContribution`, `capital.ts` |
| 30 | `/api/office/capital-spends`, `/[id]` | مصروفات رأس المال | R/W | `officeFinanceRoutes` | المكتب | `CapitalSpend`, `capital.ts` |
| 31 | `/api/office/office-expenses`, `/[id]` | مصروفات مكتبية | R/W | `officeFinanceRoutes` | المكتب | `OfficeExpense` |
| 32 | `/api/office/fixed-expenses`, `/[id]`, `/generate` | مصروفات ثابتة + توليد | R/W | `officeFinanceRoutes` | المكتب | `FixedExpense`, `capital.ts::generateDueFixedExpenses` |
| 33 | `/api/office/partner-transactions`, `/[id]` | حركات الشركاء | R/W | جلسة فقط ⚠️ | المكتب | `PartnerTransaction` |
| 34 | `/api/office/partners`, `/[id]` | الشركاء | R/W | `officeFinanceRoutes` | المكتب | `Partner`, `BusinessOwnership` |
| 35 | `/api/office/profit-transfers`, `/[id]` | تحويلات الأرباح | R/W | `officeFinanceRoutes` | المكتب | `ProfitTransfer` |
| 36 | `/api/office/allocation-settings`, `/[id]` | إعدادات التوزيع | R/W | جلسة فقط ⚠️ | المكتب | `OfficeAllocationSetting` |
| 37 | `/api/office/tools`, `/[id]` | أدوات/اشتراكات المكتب | R/W | جلسة فقط | المكتب | `OfficeTool`, `OfficeToolPayment` |
| 38 | `/api/recycle-bin` | سلة المحذوفات (استرجاع/إتلاف) | R/W | جلسة | كل الأنظمة | `soft-delete.ts` |

> ⚠️ **ملاحظة RBAC موجودة مسبقًا (لا تُعدَّل الآن):** مسارات مثل `/api/office/capital-contributions` و`/api/office/partner-transactions` و`/api/office/allocation-settings` و`/api/office/tools` **غير مُدرجة** في `officeFinanceRoutes`، أي أن الحماية تقتصر على "مسجّل دخول" بلا فحص `canAccessOfficeFinanceFull`. هذا سلوك قائم ويُترك كما هو، لكنه **يمنع** تغليف هذه المسارات كأدوات AI بشكل أعمى.

---

## 4. Existing Services / Functions

### 4.1 `src/lib/capital.ts` (863 سطر) — الأغنى كمرشّح لأدوات

```ts
// Currency / parsing
toPiasters(amount) -> number          // تحويل إلى قروش (حساب صحيح)
toEGP(piasters) -> number
parseDateOrThrow(value, field) -> Date
parseMonthKey(value) -> Date          // "YYYY-MM"
MONTH_KEY_FORMAT = /^(\d{4})-(\d{2})$/

// Read
getCapitalSummary() -> { availablePaid, ... }        // الرصيد المتاح
getCapitalLedger() -> { entries: LedgerEntry[] }      // كل الحركات
getCapitalWithdrawalsByPerson() -> PersonWithdrawalTotal[]

// Write
createCapitalContribution(input)
updateCapitalContribution(input)
softDeleteCapitalContribution({ id, userId })
createCapitalSpend(input)                             // ⚠️ مال
updateCapitalSpend(input)                             // ⚠️ مال
softDeleteCapitalSpend({ id, userId, force? })        // ⚠️ مال
createFixedExpense(input)
deactivateFixedExpense(id, userId)
convertSpendToFixedExpense(input)                     // ⚠️ مال
generateDueFixedExpenses(until?) -> { created, skipped }
```

### 4.2 `src/lib/soft-delete.ts` (290 سطر) + `soft-delete-models.ts` (39)

```ts
SOFT_DELETE_MODELS            // 20 موديل
isSoftDeleteModel(model)
logActivity(...)              // التدقيق
getRecord(model, id)
softDeleteRecord(model, id, userId)
softDeleteMany(...)
restoreRecord(model, id, userId)
purgeRecord(model, id, userId)      // ⚠️ إتلاف نهائي
listDeletedRecords(limitPerModel?)
findOrReviveClient(...)             // إحياء عميل بدل تكراره
SOFT_DELETE_REGISTRY                // وصف لكل موديل
```

### 4.3 `src/lib/auth.ts` (126)

`SESSION_COOKIE`, `Session`, `createSessionToken`, `verifySessionToken`, `getCurrentSession`, `sessionCookieOptions`, `isAdmin`, `isSuperAdmin`, `canAccessBusiness`, `canAccessOfficeFinance`, `getAccessibleBusinesses`.

### 4.4 `src/lib/prisma.ts` (81)

`prisma` (client مع الامتدادات: فلترة soft-delete + منطق إضافي) و `prismaRaw` (client خام بدون امتدادات). **`prismaRaw` مهم للـAI**: لو احتاج Runtime قراءة متجاوزة للفلترة.

### 4.5 `src/lib/r2.ts` (114) — التكامل الخارجي الوحيد

`getR2Config`, `R2_ENV_KEYS`, `R2_NOT_CONFIGURED_MESSAGE`, `validateReceiptFile`, `uploadReceiptToR2`, `deleteReceiptFromR2`. يستخدم `@aws-sdk/client-s3`.

### 4.6 `src/lib/performance.ts` (315) + `use-mobile.ts` (18)

أدوات أداء/واجهة على الـclient (`debounce`, `throttle`, `raf`, `lazyLoadImages`, `measureWebVitals`, …) — **ليست منطق أعمال**، لا قيمة كأدوات AI.

### 4.7 خلاصة القيود المؤسسية

- **Business logic موزّع:** موجود جزئيًّا في `capital.ts` (الموديول الأكثر نضجًا) والباقي داخل `route.ts` handlers مباشرة.
- **لا توجد طبقة Service موحّدة** لكل موديول (لا `clients.ts`, `projects.ts`, `finance.ts`).
- **لا يوجد Repository pattern ولا DTO layer ولا validation مركزي** (لا zod في التبعيات).

---

## 5. Existing Integrations

| الفئة | الحالة | التفاصيل |
|-------|--------|----------|
| **التخزين السحابي** | ✅ موجود | Cloudflare R2 / S3 عبر `@aws-sdk/client-s3 ^3.1136.0` — صور الإيصالات؛ متغيرات R2 عبر `getR2Config()` |
| **WhatsApp** | ⚠️ شبه موجود | روابط deep link `wa.me` فقط داخل صفحات Nexup clients — **لا WhatsApp Business API ولا إرسال آلي** |
| **X / Twitter** | ❌ غير موجود | لا SDK ولا مفاتيح ولا كود |
| **Social publishing** | ❌ غير موجود | — |
| **MCP** | ❌ غير موجود | لا حزم `@modelcontextprotocol/*` ولا أي server/client |
| **Hermes** | ❌ غير موجود | التطابق الوحيد كان نصًّا عربيًّا في ملف اختبار (`"صرف Hermes"`) |
| **Webhooks** | ❌ غير موجود | لا endpoints ولا توقيعات تحقق |
| **Cron / Scheduling** | ❌ غير موجود | لا `node-cron`, لا `bullmq`, لا `inngest`, لا Vercel Cron. المولّد `/api/office/fixed-expenses/generate` **يُستدعى يدويًّا/عند الطلب** |
| **AI Providers** | ❌ غير موجود | لا `openai`, لا `@anthropic-ai/sdk`, لا `ai`, لا `@ai-sdk/*` |
| **البريد / SMS** | ❌ غير موجود | لا `nodemailer`, لا `resend`, لا `twilio`, لا `sendgrid` |
| **Externos HTTP** | ✅ أبسط صورة | `fetch()` للـinternal APIs فقط من مكوّنات الـclient |
| **Deployment** | ✅ Vercel | مشروع `nexup-system` → `app.hymanna.com` (خارج الكود) |

**النتيجة:** AI Workforce سيضيف **أول تكاملات AI فعلية** في هذا المشروع. لا يوجد ما يُعاد استخدامه في هذه الطبقة، ولا يوجد ما يمكن كسره.

---

## 6. Database / Prisma — خريطة read-only

**الموديلات: 27** — **الـEnums: 15**. لا توجد أي موديلات للـAI/Agents/Jobs/Tool-Registry/Approvals/Runs.

### 6.1 الموديلات الأكثر صلة بـWorkforce

| الموديل | الحقول المفتاحية | ملاحظات للـTools |
|---------|------------------|-------------------|
| `Business` | `name`, `slug @unique`, `currencyMode` | سلَغز: `nexup`, `rebound`, `abomazen` — أساس النطاق |
| `User` | `role`, `businessId?`, 4 أعلام، `mustChangePassword` | هوية المُنفّذ لكل أداة |
| `Client` | `businessId`, `phone`, `name`, `tier`, `@@unique([businessId, phone])` | الحذف الناعم + `findOrReviveClient` |
| `ProjectRecord` | `clientId`, `projectName`, `totalPrice`, `deposit`, `remaining`, `workStatus`, `paymentStatus`, `designerId`, `clientType` | أدوات المشاريع |
| `ServiceType` | أنواع الخدمات | قراءة بحتة |
| `ClientPayment` | مرتبط بالمشروع | ⚠️ مال |
| `PaymentReceipt` | `imageUrl` → R2 | أدوات الملفات |
| `Expense` | مصروفات | ⚠️ مال |
| `PoolTransaction` | `amountSAR`, `type IN/OUT`, `withdrawalId @unique` | طرفا الصندوق |
| `Withdrawal` | `amountSAR`, `exchangeRate`, `commissionPct = 10`, `netEGP`, `month`, `year` | ⚠️ مال + سياسات تحويل |
| `CapitalContribution` | `partnerId`, `amount`, `type`, `fundFlow`, `linkedExpenseId`, `currency EGP` | ⚠️ مال |
| `CapitalSpend` | `amount`, `category`, `description`, `spendType`, `recipient*`, `convertedAt`, soft-delete | ⚠️ مال — `EXPENSE / PERSON_WITHDRAWAL / CUSTODY` |
| `FixedExpense` | `amount`, `frequency MONTHLY`, `startDate`, `lastGeneratedMonth`, `active` | + `OfficeExpense.@@unique([fixedExpenseId, year, month])` = **idempotency موجودة** |
| `OfficeExpense` | مصروفات مكتبية | ⚠️ مال |
| `Partner` / `PartnerTransaction` / `BusinessOwnership` | الشركاء والملكية والأرصدة | ⚠️ مال |
| `ProfitTransfer` / `OfficeAllocationSetting` / `NexupProfitLedger` | التوزيع والدخل | ⚠️ مال |
| `Subscription` / `SubscriptionInvoice` | اشتراكات وفواتير | `InvoiceStatus`, `SubscriptionStatus` |
| `Deal` / `Property` | Abomazen | — |
| `OfficeTool` / `OfficeToolPayment` | أدوات مدفوعة | ⚠️ تعارض تسمية مع "AI Tools" |
| `ActivityLog` | تدقيق جزئي | **لا يُغني** عن Runs/Audit للـAI |

### 6.2 الـEnums

`Role`, `CurrencyMode`, `ClientTier`, `WorkStatus`, `PaymentStatus`, `PoolTransactionType`, `ExpenseCategory`, `ClientType`, `SubscriptionStatus`, `InvoiceStatus`, `PartnerTransactionType`, `CapitalType`, `FundFlow`, `ExpenseCat`, `CapitalSpendType`, `ToolType`, `ToolStatus`.

### 6.3 نمط الحذف الناعم

`deletedAt` + `deletedByUserId` + index على 20 موديل، مع فلترة تلقائية عبر Prisma Extension. **قاعدة تصميم:** جداول AI Workforce الجديدة تُنشأ **بدون** هذه الأعمدة في Phase 1، **ولا** تُضاف إلى `SOFT_DELETE_MODELS` — لتجنّب أي أثر على الحسابات والمجاميع الحالية.

### 6.4 قاعدة إلزامية

> **NEXUP/Supabase = Source of Truth للبيانات. لا جداول موازية للبيانات التجارية، ولا cache دائم في الـAI Workforce.**

---

## 7. Candidates for first Atomic Tools

معايير الاختيار: (أ) منطق موجود بالكامل داخل خدمة لا داخل route، (ب) قابل للقراءة/الكتابة بأمان، (ج) لا يمسّ مالًا في المرحلة الأولى، (د) له اختبارات أو يمكن اختباره.

### Tier A — قراءة فقط (آمنة، المرحلة الأولى)

| Tool | يغلّف | المدخلات | المخرجات |
|------|-------|----------|----------|
| `business.list` | `prisma.business.findMany` | — | السلَغز والأسماء |
| `client.search` | `prisma.client.findMany` + `Client.tier` | `businessId`, `query` | قائمة عملاء |
| `client.get` | `getRecord("Client", id)` | `id` | عميل واحد |
| `project.list` | `prisma.projectRecord.findMany` | `businessId`, فلاتر | مشاريع |
| `project.get` | `prisma.projectRecord.findUnique` | `id` | مشروع |
| `project.financials` | حسابات `totalPrice/deposit/remaining` | `id` | ملخّص مالي |
| `capital.summary` | `getCapitalSummary()` | — | الرصيد المتاح |
| `capital.ledger` | `getCapitalLedger()` | فلاتر تاريخ | قيود |
| `capital.withdrawals_by_person` | `getCapitalWithdrawalsByPerson()` | — | مجاميع |
| `office.fixed_expenses.list` | `prisma.fixedExpense.findMany` | — | مصروفات ثابتة |
| `recycle.list` | `listDeletedRecords()` | `limitPerModel` | محذوفات |
| `receipt.validate` | `validateReceiptFile()` | `{size,type,name}` | خطأ/نجاح |

### Tier B — كتابة مقيدة بموافقة (Phase 2، بعد نظام Approvals)

| Tool | يغلّف | مستوى الخطر |
|------|-------|-------------|
| `capital.create_spend` | `createCapitalSpend()` | 🔴 عالٍ |
| `capital.update_spend` | `updateCapitalSpend()` | 🔴 عالٍ |
| `capital.create_contribution` | `createCapitalContribution()` | 🔴 عالٍ |
| `office.fixed_expenses.generate` | `generateDueFixedExpenses()` | 🟠 متوسط (idempotent) |
| `expense.create` | منطق `/api/expenses` | 🟠 متوسط |
| `client.soft_delete` / `client.restore` | `softDeleteRecord` / `restoreRecord` | 🟠 متوسط |
| `payment.record` | `/api/client-payments` | 🔴 عالٍ |

### Tier C — مرفوضة الآن

`purgeRecord` (إتلاف نهائي)، `deleteReceiptFromR2`، أي شيء يمسّ `AUTH_SECRET` أو كلمات المرور أو `capital-historical-settlement.ts`.

---

## 8. KEEP / WRAP / EXTEND / REPLACE LATER / RETIRE LATER

| العنصر | التصنيف | السبب |
|--------|---------|-------|
| Auth / RBAC / middleware | **KEEP** + EXTEND لاحقًا | أساس أمني سليم؛ الإضافة = مسار حماية للـAI routes فقط |
| Prisma schema الحالي (27 موديل) | **KEEP** | Production sacred |
| Prisma soft-delete extension | **KEEP** | يعمل؛ الجداول الجديدة لا تُضاف إليه |
| `capital.ts` (كل الدوال المالية) | **WRAP** | أغنى منطق جاهز؛ يُغلّف كأدوات لا يُعاد كتابته |
| `soft-delete.ts` + `findOrReviveClient` | **WRAP** | قابل للاستخدام المباشر كأدوات |
| `auth.ts` | **KEEP** | تُستخدم كما هي للتحقق من هوية المُنفّذ |
| `prisma.ts` / `prismaRaw` | **KEEP** | نقطة الوصول الوحيدة للبيانات |
| `r2.ts` | **WRAP** لاحقًا | أداة ملفات مستقبلية |
| `/api/*` الحالية (61) | **KEEP** | عقد داخلي؛ لا تعديل |
| صفحات النظام الحالية (35) | **KEEP** | لا لمس |
| `ActivityLog` | **KEEP** + **EXTEND** | التدقيق الجزئي يُستكمل بأثر AI منفصل (Runs) بلا تعديل الموديل |
| `/api/users` (GET بلا فحص) | **KEEP** الآن / **REPLACE LATER** | ثغرة RBAC قائمة — تُصلح بعد إقرار منفصل، لا كجزء من AI Workforce |
| `performance.ts` | **KEEP** | client-only، خارج نطاق الـAI |
| منطق داخل الـroutes | **KEEP** + **WRAP** تدريجيًّا | لا refactor واسع؛ التغليف عبر استدعاء الخدمة/الـAPI |
| `scripts/capital-historical-settlement.ts` | **KEEP** (خارج النطاق) | أداة تاريخية محروسة |
| `OfficeTool*` (الاسم) | **KEEP** | تعارض تسمية ⇒ تسمية الـAI تكون `AiTool*` |
| `nexup-business-system - Copy/` + ملفات `.zip` | **RETIRE LATER** | نسخ مهملة خارج الـgit — تنظيف يدوي منفصل |
| بناء Agents/UI/DB الآن | **مؤجّل** | ممنوع في Phase 0 |

---

## 9. Risks / Coupling Points

| # | الخطر | الشدة | التخفيف المقترح |
|---|-------|-------|------------------|
| R1 | `middleware.ts` نقطة اختناق واحدة | 🟠 | إضافة مسارات `ai-workforce` كقائمة مستقلة **بيضة واحدة** + مراجعة diff يدويًّا قبل أي دمج |
| R2 | لا آلية مصادقة machine-to-machine (كوكي 8 ساعات فقط) | 🔴 | قرار Phase 1: كيف يثبت الـRuntime الخارجي هويته؟ (service token جديد مستقل عن `AUTH_SECRET`) |
| R3 | الجلسة تحمل `businessId` + 4 أعلام | 🔴 | كل أداة تنفّذ **بهوية المستخدم** لا بحساب خدمة كامل الصلاحيات |
| R4 | ثغرة RBAC قائمة في بعض مسارات `/api/office/*` | 🟠 | لا تغليف أعمى لهذه المسارات؛ فحص داخلي في طبقة الأدوات |
| R5 | `/api/users` GET بلا فحص | 🟠 | لا تُبنى عليه أداة؛ استخدم `prisma.user` مع فحص صريح |
| R6 | زمن التشغيل Serverless (لا عمليات طويلة) | 🔴 | Runtime Adapter + Jobs خارج العملية |
| R7 | غياب scheduler ⇒ سلوك "مجدول" غير موجود | 🟠 | الـJobs تُشغَّل عند الطلب؛ الجدولة الحقيقية قرار لاحق |
| R8 | أخطاء كتابة مالية غير قابلة للتراجع بسهولة | 🔴 | Approvals إلزامية + idempotency + audit كامل قبل أي أداة كتابة |
| R9 | Prisma Extension يغيّر سلوك كل قراءة | 🟠 | جداول AI بلا `deletedAt`؛ الوعي بـ`prismaRaw` |
| R10 | حسبة القروش (`toPiasters`) | 🔴 | أي أداة مالية تستخدم نفس الدوال وتمنع الـfloat |
| R11 | `AUTH_SECRET` إلزامي ≥32 حرفًا | 🟠 | لا توليد أسرار جديد داخل نفس المتغير |
| R12 | Business logic داخل routes (غير قابل للاستيراد) | 🟠 | التغليف عبر استدعاء HTTP داخلي أو نقل تدريجي — بلا refactor واسع |
| R13 | غياب طبقة validation/DTO | 🟠 | الأدوات يجب أن تتحقق من المدخلات بنفسها (لا zod مثبّتة) |
| R14 | تعارض تسمية `OfficeTool` / "AI Tools" | 🟡 | بادئة `Ai` لكل جداول/أنواع الـWorkforce |
| R15 | نسخ مهملة على القرص (`- Copy`, `.zip`) | 🟡 | خطر تحرير ملف خاطئ — تأكيد المسار دائمًا |

---

## 10. Proposed Folder Structure (للـAI Workforce — مقترح فقط)

```
src/
├── modules/
│   └── ai-workforce/                    ← جذر الموديول (لا يلمس أي شيء قائم)
│       ├── core/
│       │   ├── runtime/
│       │   │   ├── runtime-adapter.ts    ← الواجهة (Interface) — Hermes أحد تطبيقاتها
│       │   │   ├── local-runtime.ts      ← تنفيذ مبدئي بلا أي مزوّد AI
│       │   │   └── hermes-adapter.ts     ← يُضاف لاحقًا
│       │   ├── registry/
│       │   │   ├── tool-registry.ts
│       │   │   ├── agent-registry.ts
│       │   │   └── director-registry.ts
│       │   └── types.ts                  ← Tool, Agent, Job, Run, Approval
│       ├── tools/
│       │   ├── index.ts                  ← تسجيل كل الأدوات
│       │   ├── read/                     ← Tier A
│       │   │   ├── client.tools.ts
│       │   │   ├── project.tools.ts
│       │   │   └── capital.tools.ts
│       │   └── write/                    ← Tier B (تُفعّل لاحقًا فقط)
│       ├── agents/
│       │   ├── executive/
│       │   └── directors/
│       ├── jobs/
│       │   ├── job-runner.ts
│       │   └── job-store.ts
│       ├── approvals/
│       │   └── approval-gate.ts          ← إلزامية قبل أي أداة كتابة
│       ├── audit/
│       │   └── run-recorder.ts           ← سجل مستقل عن ActivityLog
│       └── policies/
│           ├── permissions.ts            ← يعيد استخدام canAccess* من auth.ts
│           └── money-safety.ts
│
├── app/
│   ├── api/ai-workforce/                 ← مسارات جديدة فقط
│   │   ├── health/route.ts
│   │   ├── tools/route.ts
│   │   ├── agents/route.ts
│   │   ├── jobs/route.ts
│   │   ├── approvals/route.ts
│   │   └── runs/route.ts
│   └── office/ai-workforce/              ← Command Center (UI جديد)
│       ├── page.tsx
│       ├── agents/page.tsx
│       ├── jobs/page.tsx
│       ├── tools/page.tsx
│       ├── approvals/page.tsx
│       └── runs/page.tsx
│
└── components/ai-workforce/              ← مكوّنات خاصة بالموديول
    ├── ai-workforce-sidebar.tsx
    └── ...
```

**قاعدة العزل (Architecture Boundary):**

```
            Existing NEXUP (كما هو تمامًا)
                     │
        ┌────────────┴────────────┐
        │                         │
  Existing Modules          AI Workforce Module
  (لا لمس)                  (new, isolated)
                                  ├── Command Center
UI / Command Center ──────────────├── Agent Registry
        │                         ├── Jobs
        ▼                         ├── Tool Registry
  Executive Agent                 ├── Approvals
        ▼                         ├── Audit / Runs
  Directors / Workers             └── Runtime Adapter  ← Hermes قابل للاستبدال
        ▼
   Tool Registry
        ▼
  Existing NEXUP services/APIs + External systems
```

**الاتجاه الإلزامي للتنفيذ:** `UI → Executive Agent → Directors/Workers → Tool Registry → Existing Services`. الـAgent **لا يكتب في قاعدة البيانات مباشرة** إذا وُجدت خدمة/API قائمة. Hermes = Runtime قابل للاستبدال، وليس قلب النظام. NEXUP/Supabase = Source of Truth.

---

## 11. Files to Modify in Phase 1

| # | الملف | التعديل | الأثر على النظام القديم |
|---|-------|---------|--------------------------|
| 1 | `prisma/schema.prisma` | **إضافة** موديلات `Ai*` في نهاية الملف فقط — بلا تعديل أو حذف أو renaming لأي موديل/حقل قائم | صفري (إضافة فقط) |
| 2 | `src/middleware.ts` | **إضافة** قائمة `aiWorkforceRoutes` + بند واحد داخل المصفوفة/الفحص | منخفض — تجب مراجعته سطرًا بسطر |
| 3 | `src/components/admin-sidebar.tsx` | **إضافة** رابط واحد للـCommand Center | منخفض (بند تنقّل فقط) |
| 4 | `package.json` | **إضافة** تبعيات الـruntime (عند الحاجة فقط) | منخفض |
| 5 | `prisma/migrations/` | migration **جديد** إضافي (CREATE فقط) — يُطبَّق لاحقًا بعد موافقة | لا يُطبَّق في Phase 1 على أي بيئة إنتاجية |

**ملفّات لن تُلمس إطلاقًا:** `src/app/(كل الصفحات الحالية)`، `src/app/api/(كل المسارات الحالية)`، `src/lib/capital.ts`, `prisma.ts`, `soft-delete*.ts`, `auth.ts`, `r2.ts`، `tests/*` القائمة، `prisma/seed.js`.

---

## 12. New Files Proposed in Phase 1

| # | الملف | الغرض |
|---|-------|-------|
| 1 | `src/modules/ai-workforce/core/types.ts` | عقود الأنواع: `Tool`, `Agent`, `Job`, `Run`, `Approval` |
| 2 | `src/modules/ai-workforce/core/runtime/runtime-adapter.ts` | الواجهة المجرّدة للـRuntime |
| 3 | `src/modules/ai-workforce/core/runtime/local-runtime.ts` | تنفيذ مبدئي بلا مزوّد AI (يضمن أن النظام يعمل بدون AI) |
| 4 | `src/modules/ai-workforce/core/registry/tool-registry.ts` | سجل الأدوات + تسجيل/جرد |
| 5 | `src/modules/ai-workforce/core/registry/agent-registry.ts` | سجل الوكلاء |
| 6 | `src/modules/ai-workforce/tools/read/client.tools.ts` | `client.get` / `client.search` |
| 7 | `src/modules/ai-workforce/tools/read/project.tools.ts` | `project.list` / `project.get` / `project.financials` |
| 8 | `src/modules/ai-workforce/tools/read/capital.tools.ts` | `capital.summary` / `capital.ledger` |
| 9 | `src/modules/ai-workforce/tools/index.ts` | تجميع وتسجيل كل الأدوات |
| 10 | `src/modules/ai-workforce/policies/permissions.ts` | إسقاط هوية المُنفّذ على صلاحيات `auth.ts` |
| 11 | `src/modules/ai-workforce/policies/money-safety.ts` | حماية القروش/الكتابة المالية |
| 12 | `src/modules/ai-workforce/approvals/approval-gate.ts` | بوابة الموافقات |
| 13 | `src/modules/ai-workforce/audit/run-recorder.ts` | تسجيل Runs مستقلة |
| 14 | `src/modules/ai-workforce/jobs/job-runner.ts` + `job-store.ts` | تشغيل Jobs على الطلب |
| 15 | `src/app/api/ai-workforce/health/route.ts` | فحص صحة الموديول |
| 16 | `src/app/api/ai-workforce/tools/route.ts` | جرد الأدوات (قراءة) |
| 17 | `src/app/api/ai-workforce/runs/route.ts` | جرد التشغيلات (قراءة) |
| 18 | `src/app/office/ai-workforce/page.tsx` | Command Center (shell أولي) |
| 19 | `src/app/office/ai-workforce/tools/page.tsx` | عرض الأدوات |
| 20 | `tests/ai-workforce.test.ts` | اختبارات العزل + إغلاق الأدوات للقراءة |
| 21 | `docs/AI_WORKFORCE_PHASE_1.md` | خطة Phase 1 التفصيلية |

**مبدأ التنفيذ في Phase 1:** الموديول يعمل بالكامل بـ"Runtime محلي بلا AI" أولًا. إيقاف/حذف مجلد `ai-workforce` يجب ألّا يكسر النظام القديم إطلاقًا.

---

# PHASE 0 EXIT GATE

| # | البند | الحالة | الدليل |
|---|-------|--------|--------|
| 1 | **Production untouched** | ✅ | لا deploy، لا Vercel، لا لمس `app.hymanna.com` |
| 2 | **master untouched** | ✅ | HEAD = `bf701fa` = `origin/master`؛ لم يُنفَّذ أي commit |
| 3 | **no DB writes** | ✅ | لا `prisma` mutation، لا SQL كتابة، لا seed |
| 4 | **no migration** | ✅ | لا `migrate dev` ولا `migrate deploy`؛ لا ملف في `prisma/migrations/` |
| 5 | **no deployment** | ✅ | لا `vercel` ولا push لأي remote |
| 6 | **feature branch isolated** | ✅ | `feature/ai-workforce-foundation` منشأ من `bf701fa` ومحفوظ عليه فقط |
| 7 | **existing code unmodified** | ✅ | كل قراءة/بحث فقط؛ لا تعديل على أي ملف قائم |
| 8 | **architecture inventory complete** | ✅ | 12 قسمًا + 61 API + 27 موديل + 18 موديول + تصنيف كامل |
| 9 | **atomic tool candidates identified** | ✅ | Tier A/B/C بلا تنفيذ |
| 10 | **KEEP/WRAP/EXTEND/REPLACE/RETIRE applied** | ✅ | جدول القسم 8 |
| 11 | **architecture boundary defined** | ✅ | القسم 10 — عزل كامل، Hermes قابل للاستبدال، NEXUP = Source of Truth |
| 12 | **Phase 1 scope defined** | ✅ | القسمان 11 و12 |

## ⛔ STOP

**لم يبدأ Phase 1.** التنفيذ لا يبدأ قبل موافقة صريحة من سعيد.

## القرارات المطلوبة من سعيد قبل Phase 1

1. **هوية الـRuntime:** هل يثبت الـRuntime الخارجي هويته بـ service token جديد مستقل، أم يمرّ كل شيء عبر جلسة مستخدم؟
2. **أول شريحة تنفيذ:** Command Center + Tool Registry فقط (بلا AI provider)، أم إضافة Runtime فعلي في Phase 1؟
3. **الجدولة:** Jobs عند الطلب فقط في Phase 1 (بلا scheduler)، أم إعلان الحاجة لـscheduler مبكرًا؟
4. **جداول جديدة:** الإضافة إلى `prisma/schema.prisma` نفسه (بتوصية)، أم ملف schema منفصل؟
