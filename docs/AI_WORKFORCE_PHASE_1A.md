# NEXUP AI WORKFORCE — PHASE 1A REPORT (CONTROL CORE)

> **الفرع:** `feature/ai-workforce-foundation`
> **Baseline:** `bf701fac705cfbb2672cf931dda3962e7fafc617` (= `origin/master`)
> **التاريخ:** 2026-09-30
> **الحالة:** لم يُنفَّذ أي commit — العمل موجود في working tree على الفرع فقط.

---

## 1. Files created (39)

### 1.1 Control core — `src/modules/ai-workforce/` (30 ملفًا، 3,330 سطرًا)

| المجلد | الملف | الغرض |
|--------|-------|-------|
| `core/` | `types.ts` | الأنواع الأساسية: `RiskLevel`، `ReadWriteMode`، `TriggerType`، `AutonomyLevel`، `BusinessScope`، `ToolDomain` |
| | `ids.ts` | `IdFactory` (UUID للـruntime + `createSequentialIdFactory` للاختبارات) و`Clock` |
| | `errors.ts` | `AiWorkforceError` + 26 كود خطأ مُرقّم |
| | `execution-context.ts` | `ServiceIdentity` + `ActorContext` + `ExecutionContext` + `PERMISSION_TOKENS` |
| | `schema.ts` | DSL صغير للـinput/output schema + `validateValue` (بلا تبعيات) |
| | `ports.ts` | منافذ القراءة (`ClientReadPort`/`ProjectReadPort`/`CapitalReadPort`) + `ToolHandler` |
| | `create-core.ts` | **Composition root** بلا Prisma — هو ما تستخدمه الاختبارات |
| `registry/` | `tool-definition.ts` | `ToolDefinition` بالحقول الـ16 المطلوبة + السياسات + `defineTool` |
| | `tool-registry.ts` | التسجيل + حرّاس (تكرار id، صدق مستوى الخطر، أمان المال) |
| | `capability-lookup.ts` | `findCapabilities` + `resolveCapability` (مع منع الالتباس) |
| `policies/` | `permission-policy.ts` | اشتقاق التوكنز من الجلسة القديمة + قرار الصلاحية + فحص النطاق |
| | `risk-classification.ts` | `classifyRisk` + `assertRiskDeclaration` (LOW/MEDIUM/HIGH/CRITICAL) |
| | `money-safety.ts` | منع كتابة مالية بلا HIGH + موافقة + حساب القروش الصحيح |
| `approvals/` | `approval-policy.ts` | قواعد الموافقة بالترتيب (CRITICAL لا يعمل autonomous أبدًا) |
| | `approval-gate.ts` | `ApprovalStore` + `InMemoryApprovalStore` + `ApprovalGate` |
| `audit/` | `run-recorder.ts` | `RunRecorder` + `InMemoryRunRecorder` + 13 نوع حدث تدقيق |
| `jobs/` | `job-contracts.ts` | `Job`، `JOB_STATUSES`، `TRIGGER_TYPES`، `JobRequest`، `JobOutcome` |
| | `job-state-machine.ts` | جدول الانتقالات + `assertTransition` + `applyTransition` (دالة نقية) |
| | `job-runner.ts` | دورة حياة الـJob + الاستئناف + الإلغاء + تسجيل كل انتقال |
| `runtime/` | `runtime-adapter.ts` | **عقد الـRuntime** (`preflight` + `execute` + `describe`) |
| | `local-runtime-adapter.ts` | التنفيذ الكامل بالمسار المطلوب (بدون AI) |
| `tools/adapters/` | `client.tools.ts` | `client.search` (LOW/READ) |
| | `project.tools.ts` | `project.list` (LOW/READ) |
| | `capital.tools.ts` | `capital.summary` (LOW/READ) |
| `tools/read/` | `index.ts` | حزمة أدوات القراءة |
| `tools/` | `index.ts` | `workforceToolAdapters` + `registerWorkforceTools` |
| `adapters/` | `prisma-read-ports.ts` | تنفيذ المنافذ على Prisma (قراءة فقط) + `resolveBusinessScope` |
| | `session-actor.ts` | تحويل `Session` القديمة → `ActorContext` |
| | `api-guard.ts` | حراسة الـAPI (جلسة + بوابة الموديول) |
| الجذر | `index.ts` | الواجهة العامة + `getControlCore()` (singleton لكل عملية) |

### 1.2 API + UI

| الملف | الغرض |
|-------|-------|
| `src/app/api/ai-workforce/health/route.ts` | حالة الموديول والـRuntime والعزل |
| `src/app/api/ai-workforce/tools/route.ts` | جرد الأدوات (definitions فقط، بلا handlers) |
| `src/app/api/ai-workforce/jobs/route.ts` | **نقطة الدخول الوحيدة** لإنشاء/تشغيل Manual Job (+ سرد الـJobs) |
| `src/app/api/ai-workforce/runs/route.ts` | الـRuns + أحداث التدقيق + الموافقات |
| `src/app/office/ai-workforce/page.tsx` | Skeleton page (Server Component، بلا client state) |

### 1.3 البيانات المقترحة (غير مطبَّقة)

| الملف | الغرض |
|-------|-------|
| `prisma/proposed-migrations/AI_WORKFORCE_PHASE_1A/migration.sql` | DDL مُولَّد من Prisma (209 سطرًا) |
| `prisma/proposed-migrations/README.md` | سبب وجوده خارج `prisma/migrations/` |

### 1.4 الاختبارات والتقارير

| الملف | الأسطر |
|-------|--------|
| `tests/ai-workforce.test.ts` | 810 |
| `docs/AI_WORKFORCE_PHASE_0.md` | تقرير Phase 0 |
| `docs/AI_WORKFORCE_PHASE_1A.md` | هذا التقرير |

---

## 2. Files modified (2)

| الملف | التعديل | الأثر |
|-------|---------|-------|
| `prisma/schema.prisma` | **إضافة** 8 enums + 5 موديلات `Ai*` في نهاية الملف (`@@map` إلى `ai_*`) | صفري على الموجود — لا تعديل/حذف/إعادة تسمية لأي موديل أو حقل |
| `src/middleware.ts` | **إضافة** بندين إلى `officeFinanceRoutes`: `/office/ai-workforce`, `/api/ai-workforce` | يمسّ فقط بادئات جديدة لم تكن موجودة |

**لم يُمَس:** `src/lib/*`، كل الصفحات والـAPIs القديمة، `prisma/migrations/`، `prisma/seed.js`، `tests/*` القائمة، `next.config.ts`، `package.json`، `tsconfig.json`.

> ملاحظة مقصودة: **لم تُضف أي حزمة** — لا AI SDK، ولا MCP، ولا scheduler، ولا validation library.

---

## 3. Architecture implemented

```
Human / UI / API  ──►  JobRunner          (jobs/)
                          │  Job (CREATED→PLANNED→READY→RUNNING→…)
                          ▼
                     RuntimeAdapter        (runtime/runtime-adapter.ts = العقد)
                     LocalRuntimeAdapter   (runtime/local-runtime-adapter.ts)
                          │
         ┌────────────────┼─────────────────────────────┐
         ▼                ▼                             ▼
  Capability Lookup   Input Validation          (registry/ + core/schema.ts)
         ▼
   Permission Policy  (policies/permission-policy.ts)
         ▼
     Approval Gate    (approvals/approval-gate.ts + approval-policy.ts)
         ▼
    Tool Execution    (tools/adapters/* → core/ports.ts → خدمات NEXUP)
         ▼
       Result
         ▼
   Audit / Run Record (audit/run-recorder.ts)
```

### القرارات المعمارية المُنفَّذة

| القرار (مُلزم من المراجعة) | التنفيذ |
|---------------------------|---------|
| **Service Identity + Delegated Actor Context** | `ServiceIdentity` (منفصل عن الصلاحيات) + `ActorContext` (من الجلسة)؛ `ExecutionContext` يحمل `serviceIdentity, actor, business, workspace, jobId, runId, approvalId, source, autonomy, correlationId` |
| **لا مزوّد AI** | `RuntimeAdapter` عقد مجرّد + `LocalRuntimeAdapter` فقط؛ `aiProvider: "NONE"`، `externalCalls: false` |
| **Job Engine جاهز للمستقبل** | `TRIGGER_TYPES = MANUAL \| AGENT \| EVENT \| SCHEDULE \| WEBHOOK \| SYSTEM` في العقد، لكن التنفيذ Manual فقط؛ لا Scheduler ولا Queue |
| **Tool Contract موحّد** | 16 حقلًا: `id, version, name, description, domain, action, riskLevel, readWriteMode, inputSchema, outputSchema, requiredPermissions, requiresApproval, estimatedCostPolicy, timeoutPolicy, retryPolicy, enabled` (+ `businessScoped`) |
| **لا ربط Tool بوكيل** | السجل مستقل تمامًا؛ لا يوجد أي Agent في هذه المرحلة |
| **Risk Levels** | `LOW/MEDIUM/HIGH/CRITICAL` + حارس يرفض تعريفًا يُقلّل خطورته + CRITICAL ممنوع تمامًا تحت autonomy = AGENT |
| **State Machine** | انتقالات صريحة في جدول واحد + `assertTransition` + تسجيل كل انتقال في التدقيق |
| **WRAP لا إعادة كتابة** | `capital.summary` ينادي `getCapitalSummary()` الموجودة؛ لا إعادة حساب؛ لا HTTP bridge |
| **DB Safety** | لا كتابة، لا migration مطبَّقة، لا `migrate deploy`، لا `migrate dev` |

### العزل عن النظام القديم

- الموديول لا يُستورد من أي صفحة أو API قديم.
- النظام القديم يعمل كاملًا حتى لو حُذف مجلد `src/modules/ai-workforce` بالكامل (المساران المضافان في الـmiddleware يشيران إلى مسارات غير موجودة ⇒ 404 فقط).
- لا FKs إلى `User`/`Business` في الجداول المقترحة (تجنّبًا لأي تعديل على الموديلات القائمة).

---

## 4. Tests added

`tests/ai-workforce.test.ts` — **31 اختبارًا** في 12 مجموعة مطابقة للمتطلبات:

| # | المطلوب | مُغطّى |
|---|---------|-------|
| 1 | Tool registration | ✅ + حارسا الخطر والمالية |
| 2 | duplicate Tool ID rejected | ✅ `DUPLICATE_TOOL_ID` |
| 3 | disabled Tool cannot execute | ✅ عبر lookup + عبر runtime (وبلا أي Run) |
| 4 | permission denied | ✅ 5 حالات: توكن ناقص، نطاق خارج الـBusiness، input يحاول توسيع النطاق، بلا وصول، + الحالة المسموحة |
| 5 | approval required blocks execution | ✅ AGENT محجوب، MANUAL يمرّ (HUMAN_PRESENT)، والـJob يُعلَّق في WAITING_APPROVAL مع طلب موافقة |
| 6 | LOW read tool executes | ✅ client.search + capital.summary + تطبيق defaults |
| 7 | invalid input rejected | ✅ مخالفة schema + حقل غير معروف + capability غير موجودة |
| 8 | invalid job transition rejected | ✅ من حالة نهائية + تخطّي المراحل + Job منتهٍ |
| 9 | failed tool creates failed Run | ✅ RUN FAILED + `tool.failed` |
| 10 | completed tool creates completed Run | ✅ RUN SUCCEEDED + كل الأحداث |
| 11 | CRITICAL cannot run autonomously | ✅ AGENT ممنوع، HUMAN بلا موافقة ممنوع، ومع موافقة يعمل، والموافقة تُستهلك مرة واحدة |
| 12 | existing application tests remain passing | ✅ 81/81 |

---

## 5. Test result

```
Test Files  4 passed (4)
     Tests  81 passed (81)
  Duration  41.48s
```

- 31 اختبارًا جديدًا (AI Workforce) + **50 اختبارًا قديمًا** (capital) — كلها ناجحة.
- تم تشغيل قاعدة الاختبار على **Postgres محلي مؤقت** (منفذ 5436، datadir داخل Temp) تم إنشاؤه ثم إيقافه وحذفه بعد الاختبار.
- ملفات `ECONNRESET` / `Connection terminated unexpectedly` في المخرجات تحدث **بعد** انتهاء الاختبارات (تدمير قاعدة الفحص) وهي متوقعة وموثّقة مسبقًا.

## 6. TypeScript result

```
npx tsc --noEmit   →   لا أخطاء (0)
npx eslint <الملفات الجديدة>   →   لا أخطاء ولا تحذيرات (0)
```

> ملاحظة: كُتب الكود بـ**string discriminants** بدل boolean في `ValidationResult` و`GuardResult` لأن المشروع يُصرّف بـ`strict: false` حيث لا يعمل narrowing على boolean literals.

## 7. Build result

```
npm run build  →  ✅ نجح
✔ Generated Prisma Client (v7.9.1)
✓ Compiled successfully (35.7s)
✓ BUILD_ID = tBBfhuXSLQg-xG5WcPJtv
```

المسارات الجديدة ظهرت في مخرجات البناء:

```
ƒ /api/ai-workforce/health
ƒ /api/ai-workforce/jobs
ƒ /api/ai-workforce/runs
ƒ /api/ai-workforce/tools
ƒ /office/ai-workforce          ← server-rendered on demand
```

> ⚠️ محاولة البناء **الأولى** فشلت بـ`ENOSPC` (القرص C: ممتلئ 100%)، وليست بسبب الكود. بعد تحرير مساحة نجح البناء. التحذيرات الظاهرة أثناء البناء (`process.cwd` في Edge Runtime عبر `src/lib/auth.ts`) **موجودة قبل هذا العمل** ولم تُضف في هذه المرحلة.

## 8. DB changes = NONE APPLIED

| البند | الحالة |
|-------|--------|
| migrations مطبَّقة | **لا شيء** |
| `prisma migrate deploy` | **لم يُنفَّذ** |
| `prisma migrate dev` | **لم يُنفَّذ** |
| كتابة في Supabase | **لا شيء** (المستخدم الوحيد لقاعدة البيانات كان Postgres محليًا مؤقتًا في الاختبارات) |
| جداول/أعمدة قائمة مُعدَّلة | **لا شيء** |
| الجداول المقترحة | في `prisma/proposed-migrations/` خارج مسار Prisma — لا يمكن تطبيقها بالخطأ |

## 9. Production changes = NONE

لا deploy، لا `vercel`, لا push، لا لمس `app.hymanna.com`، ولا أي متغير بيئة.

## 10. master changes = NONE

`HEAD = bf701fa = origin/master`. كل العمل في working tree الفرع `feature/ai-workforce-foundation` (غير مُودَع في commit).

## 11. External calls = NONE

لا HTTP خارجي، لا مزوّد AI، لا Hermes، لا MCP، لا webhook، لا WhatsApp/X، لا إرسال بريد. R2 لم يُستخدم. كل ما تم هو استدعاءات داخلية للمنافذ (وفي الاختبارات: منافذ وهمية في الذاكرة).

---

## 12. Known limitations

1. **بلا Persistence:** الـJobs والـRuns والأحداث والموافقات في الذاكرة (`IN_MEMORY`) ⇒ تُفقد عند كل cold start، وكل instance على Vercel له حالته. الجداول المقترحة تحلّ ذلك في Phase 1B.
2. **لا كتابة:** كل الأدوات الثلاث قراءة فقط. لا توجد أي أداة كتابة (بالتصميم).
3. **لا موافقات عبر API:** `ApprovalGate` كامل ومختبَر، لكن لا يوجد endpoint لاتخاذ القرار ⇒ Job في `WAITING_APPROVAL` لا يمكن استئنافه من الواجهة بعد (يحتاج Phase 1B). لا يمنع شيئًا الآن لأن كل الأدوات LOW.
4. **`outputSchema` للتوثيق:** التحقق من المخرجات permissive ويُسجَّل كملاحظة تدقيق لا كفشل — لأن DSL الحالي لا يعبّر عن مصفوفات الكائنات المتداخلة.
5. **اشتقاق التوكنز مؤقّت:** `derivePermissionTokens` تعكس قواعد الجلسة الحالية (SUPER_ADMIN / officeFinance / ADMIN / EMPLOYEE). يجب توحيدها لاحقًا قرب `src/lib/auth.ts` (بلا تعديل auth الآن).
6. **البوابة على مستوى الـmiddleware:** مسارات الموديول مضافة إلى `officeFinanceRoutes` ⇒ الوصول للأدمن فقط حاليًّا (دفاع في العمق، مع فحص ثانٍ لكل أداة).
7. **`control core` singleton لكل عملية**، وليس مخزنًا مركزيًّا.
8. **إعادة تشغيل Job في حالة BLOCKED** يعيد التخطيط تلقائيًّا — لم تُصمَّم بعد واجهة "فك الحجب" مع سبب مطلوب.
9. **القرص:** التطوير على قرص ممتلئ 100% (163MB حر، وفي المجلد الأب 3.8GB ملفات مهملة من Phase 0) — البناء يحتاج مساحة حرة أكبر.
10. **لا commit:** كل الملفات غير مُودَعة (untracked/modified) — يمكن مراجعتها بالكامل قبل الالتزام.

---

## 13. END-TO-END TRACE (تشغيل حقيقي)

تشغيل حقيقي للـ`LocalRuntimeAdapter` عبر `JobRunner` على منافذ وهمية (بلا قاعدة بيانات، بلا شبكة، بلا AI) — نفس الكود المُشغَّل في `POST /api/ai-workforce/jobs`:

```
════════ PHASE 1A — END-TO-END MANUAL JOB TRACE ════════
job        t_job_0001
capability client.search → client.search
trigger    MANUAL   autonomy=HUMAN
run        t_run_0001   status=SUCCEEDED
job status COMPLETED
history    CREATED→PLANNED  PLANNED→READY  READY→RUNNING  RUNNING→COMPLETED
──────── audit events ────────
00:00:01  job.created            run=-            tool=-
00:00:02  job.transitioned       run=-            tool=-
00:00:03  job.transitioned       run=-            tool=client.search
00:00:04  job.transitioned       run=-            tool=client.search
00:00:07  capability.resolved    run=t_run_0001   tool=client.search
00:00:08  run.started            run=t_run_0001   tool=client.search
00:00:09  policy.checked         run=t_run_0001   tool=client.search
00:00:10  approval.evaluated     run=t_run_0001   tool=client.search
00:00:11  tool.invoked           run=t_run_0001   tool=client.search
00:00:14  tool.succeeded         run=t_run_0001   tool=client.search
00:00:17  run.finished           run=t_run_0001   tool=client.search
00:00:19  job.transitioned       run=-            tool=client.search
result     {"businessId":"biz_nexup","count":1,
            "clients":[{"id":"cli_1","name":"شركة النور","tier":"VIP","phone":"01000000001"}],
            "searchedAt":"2026-01-01T00:00:12.000Z"}
═══════════════════════════════════════════════════════
```

**المسار المُثبت:** Human → Job → Runtime → Registry (capability lookup) → Policy → Approval Gate → Tool → Result → Audit/Run.

---

## 14. PHASE 1A EXIT GATE

| البند | النتيجة |
|-------|---------|
| files created | 39 |
| files modified | 2 (`prisma/schema.prisma` إضافة، `src/middleware.ts` إضافة) |
| architecture implemented | Job Engine + Tool Registry + Policies + Approvals + Audit + Runtime Adapter (Local) |
| tests added | 31 |
| tests result | ✅ 81/81 (4 ملفات) |
| TypeScript result | ✅ 0 أخطاء |
| Build result | ✅ نجح (`BUILD_ID tBBfhuXSLQg-xG5WcPJtv`) |
| DB changes | **NONE APPLIED** |
| Production changes | **NONE** |
| master changes | **NONE** (`bf701fa`) |
| external calls | **NONE** |
| الإضافات الممنوعة | لا AI provider، لا Hermes، لا MCP، لا Scheduler، لا Queue، لا Agents، لا Directors، لا تكاملات اجتماعية |
| new npm dependencies | **NONE** |

## 15. Proposed Phase 1B

1. **Approval API + UI** — `POST /api/ai-workforce/approvals/[id]` + شاشة قرارات، مع استئناف الـJob من `WAITING_APPROVAL` (البنية جاهزة، تحتاج الواجهة فقط).
2. **Persistence** — تنفيذ `PrismaRunRecorder` + `PrismaJobStore` + `PrismaApprovalStore` على الجداول المقترحة، **بعد** إنشاء Development Database منفصلة أو موافقة صريحة على التطبيق.
3. **أول أداة كتابة واحدة فقط** — `office.fixed_expenses.generate` (MEDIUM لأنها idempotent) لإثبات مسار الموافقة من البداية للنهاية قبل أي أداة مالية HIGH.
4. **توحيد اشتقاق الصلاحيات** مع `src/lib/auth.ts` بلا تغيير سلوك الـRBAC الحالي.
5. **Runtime Adapter ثانٍ (تجريبي)** — `HermesRuntimeAdapter` يطبّق نفس الواجهة، مع Service Identity مُتحقَّق منها (بدل `verified: false`).
6. **`AiAgent` + Tool Grants** — سجل الوكلاء وتفويض الأدوات، بعد أن يصبح الـControl Core مثبَتًا.
7. **Append-only guarantee للتدقيق** — قيود على مستوى قاعدة البيانات تمنع تحديث/حذف `ai_run_events`.
8. **Observability** — عرض الـRuns وربطها بـ`correlationId` عبر الطلبات.

## ⛔ STOP — Phase 1B لم تبدأ.
