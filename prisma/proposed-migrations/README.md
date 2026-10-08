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
| `AI_WORKFORCE_PHASE_2/` | أربعة جداول دورة حياة المهمة: `ai_missions`, `ai_tasks`, `ai_execution_records`, `ai_task_reviews` | مقترحة — غير مطبَّقة |
| `AI_WORKFORCE_PHASE_3/` | جدول واحد لسجل تكرار الأوامر: `ai_command_intents` | مقترحة — غير مطبَّقة |
| `AI_WORKFORCE_PHASE_4/` | جدول واحد لسجل ملكية محاولة التنفيذ: `ai_execution_claims` (Step 5A-2) | مقترحة — غير مطبَّقة |

تُطبَّق بالترتيب: `1A` ثم `1B` ثم `PHASE_2`. ملف `1B` يستخدم
`IF NOT EXISTS` / `IF EXISTS` في كل جملة، فإعادة تطبيقه لا تُغيّر شيئًا.

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

### مراجعة Phase 2

`AI_WORKFORCE_PHASE_2/migration.sql` مولّد من Prisma نفسه، ويمثّل **الفرق
الدقيق** بين مخطط ما قبل Phase 2 والمخطط الجديد — ولذلك لا يحتوي أي شيء من
جداول Phase 1 (تلك في ملفاتها):

```bash
git show HEAD:prisma/schema.prisma > .tmp-schema-old.prisma
npx prisma migrate diff --from-schema=.tmp-schema-old.prisma \
                        --to-schema=prisma/schema.prisma --script
```

**فحص آلي للسلامة** (`scripts/verify-proposed-migration.mjs`):

```bash
node scripts/verify-proposed-migration.mjs \
  prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql
```

يفشل السكربت على أي `DROP` / `DELETE` / `TRUNCATE` / `RENAME`، وعلى أي
`ALTER TABLE` يخصّ جدولًا لا يُنشئه الملف نفسه. النتيجة على ملف Phase 2:

```
4×  CREATE TABLE      (ai_missions, ai_tasks, ai_execution_records, ai_task_reviews)
23× CREATE INDEX      2× CREATE UNIQUE INDEX
6×  ALTER TABLE … ADD CONSTRAINT (مفاتيح أجنبية بين الجداول الأربعة نفسها فقط)
```

- **لا** تغيير على أي جدول من النظام القديم: المخطط القديم يبقى بايت-ببايت.
- **لا** مفاتيح أجنبية إلى `users` / `businesses` / `clients` / `projects`،
  فمعرّفات actor/business/workspace/project/client تبقى أعمدة مفهرسة عادية
  ولا تحتاج النماذج القديمة أي حقول عكسية.
- حالة دورة الحياة (`state`) مخزَّنة `TEXT` وتحقّقها آلات الحالة في TypeScript،
  فإضافة حالة تصبح تغييرًا في الكود لا `ALTER TYPE`.

> ملاحظة عن `1B`: يحتوي على `DROP` **مقصود ومراجَع** لجدول مقترح لم يوجد في أي
> قاعدة (`ai_tool_invocations`). لذلك يفشل فحص السلامة عليه عمدًا. القاعدة:
> كل `DROP` يمرّ بمراجعة بشرية صريحة، والفحص الآلي موجود ليجعل ذلك مستحيلًا
> أن يحدث بصمت.

**حالة الإنتاج: لم يُطبَّق أي شيء.** لا `prisma migrate deploy` على قاعدة
Supabase الحالية، ولا `db push`. تطبيق Phase 2 (أو 1A/1B) ينتظر موافقة صريحة
من صاحب النظام على قاعدة تطوير منفصلة.

### مراجعة Phase 4 (Step 5A-2)

`AI_WORKFORCE_PHASE_4/migration.sql` مولّد من Prisma نفسه، ويمثّل الفرق الدقيق
بين مخطط ما قبل Step 5A-2 والمخطط الجديد — **جدول واحد فقط** وبلا أي `ALTER`:

```bash
git show HEAD:prisma/schema.prisma > .tmp-schema-old.prisma
npx prisma migrate diff --from-schema=.tmp-schema-old.prisma \
                        --to-schema=prisma/schema.prisma --script
```

**فحص آلي للسلامة:**

```bash
node scripts/verify-proposed-migration.mjs \
  prisma/proposed-migrations/AI_WORKFORCE_PHASE_4/migration.sql
```

```
ok   additive-only: …/AI_WORKFORCE_PHASE_4/migration.sql
ok   no DROP / DELETE / TRUNCATE / RENAME
ok   every ALTER TABLE targets a table this file creates (ai_execution_claims)
     tables created : ai_execution_claims
     statement kinds: 1× CREATE TABLE, 2× CREATE UNIQUE INDEX, 3× CREATE INDEX
```

- **لا** تغيير على أي جدول قائم: `ai_missions` / `ai_tasks` /
  `ai_execution_records` / `ai_task_reviews` / `ai_command_intents` تبقى بايت-ببايت.
- **لا** مفاتيح أجنبية على الإطلاق: سجل الملكية (lease) يجب ألّا يمنع كتابة
  دورة حياة المهمة ولا أن يرفض مُدخلات يقبلها التنفيذ في الذاكرة.
- قيدان فريدان يحميان **محاولة واحدة**:
  `UNIQUE("idempotencyKey")` يجعل إعادة الطلب بنفس المفتاح تصل إلى نفس الصف،
  و`UNIQUE("taskId", "attempt")` يجعل `taskId + attempt` — وهو الهوية الدلالية
  لمحاولة التنفيذ — غير قابل للتكرار حتى لو أنتج مُستدعٍ مستقبلي مفتاحًا بصياغة
  مختلفة. الفهارس الفريدة المركّبة تغنّي عن فهرس `taskId` منفصل.
- **لا** خطأ تفرد خام يخرج من المحوّل: كلا التعارضين يُترجَم إلى نتيجة مطالبة
  مُصنّفة (typed outcome)، لا إلى `P2002`.
- أزمنة الـlease تُكتب وتُقارن بـ`now() AT TIME ZONE 'UTC'`، أي بساعة قاعدة
  البيانات، فلا يمكن لساعة تطبيق منحرفة أن تُنهي lease سليمة.
