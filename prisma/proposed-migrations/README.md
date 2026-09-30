# Proposed migrations (NOT applied)

هذا المجلد **ليس** مجلد هجرات Prisma. لا يقرأه `prisma migrate deploy` ولا
`prisma migrate dev`، ولذلك لا يمكن أن يُطبَّق بالخطأ على قاعدة بيانات
الإنتاج.

الهدف: مراجعة الـDDL قبل أي تطبيق فعلي.

## القاعدة

1. القاعدة الحالية (Supabase) تعتبر Production Data — لا يُطبَّق عليها أي شيء الآن.
2. كل ملف هنا ينتظر:
   - إنشاء قاعدة بيانات تطوير منفصلة (Development DB)، أو
   - موافقة صريحة من صاحب النظام.
3. عند الموافقة تُنقل الهجرة إلى `prisma/migrations/<timestamp>_<name>/migration.sql`
   ثم يُطبَّق `prisma migrate deploy` على قاعدة التطوير أولًا.

## المحتوى الحالي

| المجلد | الوصف | الحالة |
|--------|-------|--------|
| `AI_WORKFORCE_PHASE_1A/` | إنشاء 5 جداول + 8 enums للـAI Workforce | مقترحة — غير مطبَّقة |
| `AI_WORKFORCE_PHASE_1B/` | إضافة أعمدة الاستمرارية (`context`, `history`, `runId`, `input`, `output`, `requestedForUserId`, `correlationId`) وحذف الجدول المكرَّر `ai_tool_invocations` | مقترحة — غير مطبَّقة |

تُطبَّق بالترتيب: `1A` ثم `1B`. ملف `1B` يستخدم `IF NOT EXISTS` / `IF EXISTS`
في كل جملة، فإعادة تطبيقه لا تُغيّر شيئًا.

`AI_WORKFORCE_PHASE_1A/migration.sql` تولّدت من Prisma نفسه:

```bash
git show HEAD:prisma/schema.prisma > .tmp-schema-old.prisma
npx prisma migrate diff --from-schema=.tmp-schema-old.prisma \
                        --to-schema=prisma/schema.prisma --script
```

أي أنها الفرق الدقيق بين الـschema القديم والجديد، وليست SQL مكتوبة يدويًّا.

## ضمانات إضافية

- الجداول الجديدة فقط: `ai_jobs`, `ai_runs`, `ai_run_events`,
  `ai_approvals` (بعد مراجعة Phase 1B وحذف `ai_tool_invocations` المقترح).
- لا يوجد أي `ALTER TABLE` على جدول من النظام القديم — كل `ALTER` في ملف
  Phase 1B يخصّ جداول `ai_*` التي أنشأها ملف Phase 1A.
- لا توجد `DROP` ولا `RENAME` على أي جدول قائم أو حيّ.

### مراجعة Phase 1B

`ai_tool_invocations` المقترح في Phase 1A حُذف لأن الـRun في هذا المحرك **هو**
الـTool Invocation نفسه (قدرة واحدة لكل Run)، فكان الجدول سيُكرّر صفوف
`ai_runs` صفًّا بصف. نُقل `input` / `output` إلى `ai_runs` بدلًا منه.

حُذف الجدول من `schema.prisma` أيضًا، فلا يُنشئه `prisma db push` ولا
`prisma generate` في أي قاعدة جديدة.
