# NEXUP COMMAND — AI WORKFORCE
## Phase 1B — Persistence + Approval Loop

**الفرع:** `feature/ai-workforce-foundation` · **الحالة:** مُنفَّذ ومُختبَر · **الـDB changes المطبَّقة:** صفر
**التاريخ:** 2026-09-30

> **NEXUP COMMAND** = المظلة / Control Plane بالكامل.
> **AI WORKFORCE** = الوحدة المسؤولة عن Workforce Engine داخل NEXUP COMMAND.
> تمت إعادة تسمية الواجهة والـinformation architecture فقط. `src/modules/ai-workforce`
> بقي كما هو لأنه صحيح وظيفيًّا (لا rename واسع).

---

## 1. ما كان مطلوبًا وما تحقّق

| المطلوب | الحالة | الدليل |
|---------|--------|--------|
| Persistent Job | ✅ | `PrismaJobRepository` + اختبار قاعدة بيانات حقيقية |
| Persistent Run | ✅ | `PrismaRunRepository` (input + output + duration) |
| Persistent Audit/Events | ✅ | `PrismaAuditEventRepository` (append-only) |
| Approval Request + Approve/Reject | ✅ | `ApprovalService` + 3 endpoints |
| Resume نفس الـJob بعد الموافقة | ✅ | trace كامل في §9 |
| منع التنفيذ المزدوج (idempotency) | ✅ | 3 طبقات compare-and-set في §6 |
| عدم لمس Production | ✅ | §8 |
| بدون AI Provider / Scheduler / MCP | ✅ | §11 |

---

## 2. الملفات المُنشأة (Phase 1B)

### Control Core — `src/modules/ai-workforce/` (43 ملفًا / 5,279 سطرًا)

**Repository Ports + In-Memory Implementations**

| الملف | المحتوى |
|------|---------|
| `jobs/job-repository.ts` | `JobRepository` + `InMemoryJobRepository` + `InMemoryJobStore` |
| `audit/run-repository.ts` | `RunRepository` + `InMemoryRunRepository` |
| `audit/audit-event-repository.ts` | `AuditEventRepository` (append-only) + in-memory |
| `approvals/approval-repository.ts` | `ApprovalRepository` + `InMemoryApprovalRepository` (CAS على `PENDING`) |
| `core/context-snapshot.ts` | تسلسل/استرجاع Execution Context (بدون تخزين Tokens) |
| `approvals/approval-service.ts` | منطق الموافقة/الرفض/الاستئناف + قواعد التفويض |
| `persistence/prisma-workforce-db.ts` | عقد الـDB البنيوي (4 جداول) |
| `persistence/prisma-repositories.ts` | `Prisma*Repository` × 4 + factory |
| `persistence/prisma-client.ts` | Prisma Client مخصص مربوط بـ`AI_WORKFORCE_DATABASE_URL` |
| `policies/persistence-safety.ts` | حارس العزل fail-closed |
| `adapters/api-response.ts` | تحويل أخطاء الـCore إلى HTTP |
| `tools/adapters/system.tools.ts` | `system.staging_write` (fixture الموافقة) |
| `tools/write/index.ts` | حزمة أدوات الكتابة |

**API (9 routes تحت `/api/ai-workforce`):** `jobs` · `jobs/[id]` · `jobs/[id]/resume` · `approvals` · `approvals/[id]/approve` · `approvals/[id]/reject` · `runs` · `tools` · `health`

**UI:** `src/app/office/ai-workforce/page.tsx` (NEXUP COMMAND) + `approval-actions.tsx` (client)

**Migration مقترحة:** `prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql`

**Tests:** `tests/ai-workforce-phase1b.test.ts` (31) · `tests/ai-workforce-persistence.test.ts` (3)

**Docs:** هذا الملف.

---

## 3. الملفات المُعدَّلة (Phase 1B)

| الملف | التعديل |
|------|---------|
| `src/modules/ai-workforce/jobs/job-runner.ts` | أصبح **stateless** بالكامل: كل قراءة/كتابة عبر `JobRepository`، مع CAS + منع تشغيل Job في حالة `RUNNING` + مسح `error` القديم عند التقدّم |
| `src/modules/ai-workforce/audit/run-recorder.ts` | `RepositoryRunRecorder` مبني على `RunRepository` + `AuditEventRepository`؛ الـ`RunRecorder` contract كما هو |
| `src/modules/ai-workforce/approvals/approval-gate.ts` | يقرأ/يكتب عبر `ApprovalRepository` + `find()`/`listPending()`/`listForJob()` |
| `src/modules/ai-workforce/core/create-core.ts` | حقن `repositories` + `persistence` + `approvalService` |
| `src/modules/ai-workforce/core/errors.ts` | 6 أكواد جديدة (`JOB_CONCURRENT_UPDATE`, `JOB_CONTEXT_MISSING`, `APPROVAL_FORBIDDEN`, `PERSISTENCE_UNSAFE`, `PERSISTENCE_UNAVAILABLE`…) |
| `src/modules/ai-workforce/core/execution-context.ts` | إضافة Token `system.write` |
| `src/modules/ai-workforce/jobs/job-contracts.ts` | `contextSnapshot` على الـJob |
| `src/modules/ai-workforce/runtime/local-runtime-adapter.ts` | `persistence` في `describe()` + تخزين input/output على الـRun |
| `src/modules/ai-workforce/tools/index.ts` | `controlPlaneToolAdapters` (قراءة + كتابة) دون تغيير حزمة Phase 1A |
| `src/modules/ai-workforce/index.ts` | Composition Root: حل الـpersistence + التحقق قبل الاتصال |
| 4 routes قائمة (`health`, `jobs`, `runs`, `tools`) | تقرأ الحالة الجديدة (`getWorkforceBootstrap`) |
| `src/app/office/ai-workforce/page.tsx` | هوية NEXUP COMMAND + Jobs + Pending Approvals + Runs |
| `prisma/schema.prisma` | **إضافي فقط: 200 سطرًا مضافًا، 0 محذوف** |
| `prisma/proposed-migrations/README.md` | توثيق ترتيب التطبيق + قرار المراجعة |

**لم يُعدَّل أي ملف من النظام القديم:** لا `src/lib/*`، لا صفحات، لا APIs، لا auth/RBAC.
`src/middleware.ts` (5 أسطر من Phase 1A) لم يُمَس في هذه المرحلة.

---

## 4. Repository Architecture

```
              JobRunner / ApprovalService / LocalRuntimeAdapter
                                  │
                                  ▼
                     ┌──── Repository Ports ────┐
                     │ JobRepository            │
                     │ RunRepository            │
                     │ AuditEventRepository     │
                     │ ApprovalRepository       │
                     └──────────┬───────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        ▼                                                ▼
InMemory*Repository                            Prisma*Repository
(افتراضي، معزول)                                (قاعدة معزولة فقط)
```

- الـCore **لا يستورد Prisma إطلاقًا** (تحقّق: لا import لـ`@prisma/client` داخل الملفات ما عدا `persistence/prisma-client.ts`).
- الـPorts تُترجم للـDB عبر **عقد بنيوي** (`prisma-workforce-db.ts`) وليس عبر الأنواع المولَّدة، ليبقى البناء صحيحًا حتى قبل `prisma generate`.
- كل كتابة تغيّر حالة هي **compare-and-set**، لا write أعمى.

| Port | العمليات | تنفيذ Prisma |
|------|----------|--------------|
| `JobRepository` | `insert` · `get` · `list` · `update(job, expected[])` (CAS) | `create` · `findUnique` · `findMany` · **`updateMany({where:{id,status:{in}}})`** |
| `RunRepository` | `insert` · `update` · `get` · `list` | `create` · `updateMany` · `findUnique` · `findMany` |
| `AuditEventRepository` | `append` · `list` · `listForJob` | `create` · `findMany` (بلا update/delete) |
| `ApprovalRepository` | `create` · `get` · `list` · `listPending` · `listForJob` · `decide` (CAS) | نفسه + **`updateMany({where:{id,status:"PENDING"}})`** |

---

## 5. Approval Architecture

**الطلب:**
```
Job → Preflight → Policy (HIGH+) → لا موافقة سارية
    → Job = WAITING_APPROVAL → ApprovalRecord(PENDING)
```
الطلب الواحد لكل Job: إعادة تشغيل Job مُعلَّق **لا** تُنشئ موافقة ثانية (كانت ثغرة في Phase 1A).

**قواعد من يحقّ له الموافقة (RBAC الحالي عبر Adapter، بدون إعادة كتابة `auth.ts`):**

1. `aiworkforce.access` مطلوب.
2. **الموافِق يجب أن يكون قادرًا على تنفيذ نفس القدرة**: كل `requiredPermissions` للأداة مطلوبة منه. الموافقة على ما لا تستطيع تنفيذه ليست ضابطًا بل ثغرة.
3. أدوات كتابة الأموال (`capital`/`finance` + `WRITE`) تتطلب `capital.approve` صراحةً.
4. **Separation of duties** متاح كخيار (`requireDistinctApprover`) — **معطَّل افتراضيًّا** لأن المكتب أحادي المالك ومتطلّب "موافِق ثانٍ إلزامي" كان سيقفل كل Job عالية الخطورة.
5. `SUPER_ADMIN` يملك كل التوكنز (نفس منطق middleware الحالي).

**APPROVE:** validate actor → CAS decision → audit → resume **نفس** الـJob → إعادة فحص السياسة → تنفيذ **مرة واحدة** → persist.
الـActor للتنفيذ هو **صاحب الطلب** (من الـsnapshot)، والـActor للقرار هو **الموافِق** (من الجلسة الحيّة) — الاثنان مُسجَّلان.

**REJECT:** validate actor → CAS decision → `approval.denied` → Job = `BLOCKED` → **الأداة لا تُنفَّذ**.
وحتى لو حاول أحد استئناف الـJob لاحقًا، فالـ`approvalId` المرتبط بالـJob يجعل السياسة ترفض (`APPROVAL_REJECTED → BLOCKED`).

---

## 6. Idempotency Mechanism (3 طبقات)

| الطبقة | الآلية | ما تمنعه |
|--------|--------|----------|
| 1. القرار | `ApprovalRepository.decide` = CAS على `status = PENDING` | نفس الموافقة تصدر قرارين |
| 2. التنفيذ | `JobRunner.run` يرفض Job في حالة `RUNNING`، وكل انتقال حالة CAS على الحالة المقروءة | تنفيذ متزامن مزدوج (double click / retry) |
| 3. الملكية | القرار يُسجَّل مرة واحدة، و**من يسجّل القرار فقط هو من يستأنف الـJob**؛ ومن يرى قرارًا قائمًا يراقب فقط | تنفيذ ثانٍ بسبب إعادة إرسال الطلب |

نتيجة عملية: نفس الـJob أو نفس الموافقة **لا** تُنتج تشغيلًا ثانيًا أبدًا، حتى مع الطلبات المتزامنة.

**الحالتان المكتشفتان أثناء الاختبار (وأُصلحتا):**
1. `run()` على Job في حالة `RUNNING` كان يعيد التنفيذ بصمت → أصبح يرمي `JOB_CONCURRENT_UPDATE`.
2. Job مكتمل كان يحمل `error: APPROVAL_REQUIRED` قديمًا من مرحلة التعليق → أصبح الخطأ يُمسح عند التقدّم.

---

## 7. Database Models المستخدمة فعلًا (4 فقط)

| الجدول | الاستخدام |
|--------|-----------|
| `ai_jobs` | الحالة + `context` (snapshot) + `history` + `runId` + `approvalId` |
| `ai_runs` | محاولة تنفيذ واحدة: `input` + `output` + المدة + الخطأ |
| `ai_run_events` | السجل غير القابل للتعديل (audit) |
| `ai_approvals` | قرار بشري كامل: من طلب، لمن، الخطورة، من قرّر، متى، لماذا |

**قرار مراجعة Phase 1B:** حُذف `AiToolInvocation` المقترح في Phase 1A.
في هذا المحرك **الـRun هو الـTool Invocation نفسه** (قدرة واحدة لكل Run)، فالجدول كان سيُكرِّر `ai_runs` صفًّا بصف. نُقل `input`/`output` إلى `ai_runs`.
كما لم تُضَف أي جداول "للمستقبل": لا Agents، لا Scheduler، لا Queue.

**قاعدة الـContext:** التوكنز **لا** تُخزَّن أبدًا. يُخزَّن `ActorSnapshot` (role + flags + businesses) فقط، وتُعاد اشتقاق التوكنز عند كل تحميل بنفس قواعد الجلسة الحيّة.

---

## 8. Data Safety — التطبيق محلي فقط

**الملف:** `prisma/proposed-migrations/AI_WORKFORCE_PHASE_1B/migration.sql` — **لم يُطبَّق على أي قاعدة بيانات إنتاجية.**

- الترتيب: Phase 1A ثم Phase 1B. كل الجمل `IF [NOT] EXISTS` فإعادة التطبيق no-op.
- كل `ALTER` يستهدف جداول `ai_*` فقط. **لا `ALTER` على أي جدول قائم**، ولا `DROP`/`RENAME` على شيء حيّ.
- الملف **ليس** داخل `prisma/migrations/` ⇒ `prisma migrate deploy` لا يمكنه التقاطه بالخطأ.

**دليل التطبيق المحلي (throwaway PostgreSQL على loopback، المنفَّذ فعليًا في الاختبار):**

```
              List of tables
 Schema |     Name      | Type  |  Owner
--------+---------------+-------+----------
 public | ai_approvals  | table | postgres
 public | ai_jobs       | table | postgres
 public | ai_run_events | table | postgres
 public | ai_runs       | table | postgres
```

**حارس العزل (fail-closed)** — `policies/persistence-safety.ts`:

1. الاستمرارية تستخدم متغيّرها الخاص `AI_WORKFORCE_DATABASE_URL`؛ **`DATABASE_URL` لا يُقرأ أصلًا** (تحقّق: كل ظهور لـ`DATABASE_URL` في الوحدة هو تعليق توضيحي، والكود يستخدم `AI_WORKFORCE_DATABASE_URL` فقط).
2. الـhost يجب أن يكون **loopback** — allowlist لا blocklist، فلا يمرّ host جديد بفحص "هل يحتوي supabase؟".
3. أي شيء آخر (Supabase pooler، host بعيد، URL غير صالح، لا URL) ⇒ `IN_MEMORY` مع تسجيل السبب، **بدون أي محاولة اتصال**، والسبب يظهر في الواجهة و`/health`.

**Production / master:**

| البند | الحالة |
|------|--------|
| اتصال بـProduction Supabase | **ZERO** |
| كتابة على قاعدة بيانات النظام | **ZERO** |
| `prisma migrate deploy` / `migrate dev` | **لم يُشغَّل إطلاقًا** |
| `prisma db push` على قاعدة حقيقية | لم يُشغَّل (فقط قاعدة الاختبار المؤقتة عبر اختبارات capital القائمة) |
| Deploy / Vercel | **لم يحدث** |
| `master` | **لم يُمَس** — آخر commit ما زال `bf701fa` |
| Merge إلى master | **لم يحدث** |

---

## 9. End-to-End Traces

### 9.1 APPROVE — تنفيذ مرة واحدة فقط

```
════════ PHASE 1B — PERSISTENT JOB → APPROVAL → EXECUTE ONCE ════════
job          t_job_0001   capability=system.staging_write   trigger=EVENT autonomy=AGENT
approval     t_approval_0001
requester    user_super_admin   requestedFor=user_super_admin
decision     APPROVED by user_super_admin at 2026-02-01T00:00:09.000Z
job status   COMPLETED
history      CREATED→PLANNED  PLANNED→WAITING_APPROVAL  WAITING_APPROVAL→READY  READY→RUNNING  RUNNING→COMPLETED
run          t_run_0001  status=SUCCEEDED  attempts=1
result       {"stagingId":"t_staging_0001","businessImpact":"NONE","persistedBy":"WORKFORCE_ONLY","approvalId":"t_approval_0001"}
──────── persisted audit trail (oldest first) ────────
job.created → job.transitioned(PLANNED) → job.transitioned(WAITING_APPROVAL) → approval.requested
→ job.transitioned(READY) → job.transitioned(RUNNING) → capability.resolved → run.started
→ policy.checked → approval.evaluated(APPROVAL_APPROVED) → tool.invoked → tool.succeeded
→ run.finished → job.transitioned(COMPLETED)
handler executions = 1   (must be exactly 1)
═══════════════════════════════════════════════════════════════════
```

ثم: إعادة تحميل الـrepositories (process جديد) ⇒ نفس الحالة النهائية تمامًا (`toEqual` مع الحالة الحيّة)، ومحاولة تشغيل أخرى ⇒ `JOB_ALREADY_FINISHED`.

### 9.2 قاعدة بيانات حقيقية، وعمليتان مختلفتان

```
════════ PHASE 1B — REAL DATABASE EVIDENCE ════════
database     ai_workforce_test@127.0.0.1 (loopback, throwaway)
migrations   1A + 1B applied from prisma/proposed-migrations
job          db1_job_0001   status=COMPLETED
history      CREATED→PLANNED  PLANNED→WAITING_APPROVAL  WAITING_APPROVAL→READY  READY→RUNNING  RUNNING→COMPLETED
approval     db1_approval_0001   approved by user_db_test (second process)
run          db2_run_0001  status=SUCCEEDED
result       {"note":"اختبار قاعدة بيانات معزولة","stagingId":"db2_staging_0001","approvalId":"db1_approval_0001","businessImpact":"NONE","persistedBy":"WORKFORCE_ONLY"}
handler executions = 1   (across two processes)
═══════════════════════════════════════════════════
```

العملية الأولى أنشأت الـJob وعلّقته، والعملية الثانية (client آخر + pool آخر) قرأت الحالة، وافقت، ونفّذت مرة واحدة، والعملية الأولى قرأت النتيجة النهائية من الصفوف.

### 9.3 REJECT — لا تنفيذ إطلاقًا

```
════════ PHASE 1B — PERSISTENT JOB → APPROVAL → REJECTION ════════
job          t_job_0001   capability=system.staging_write
approval     t_approval_0001   status=REJECTED   reason=غير مبرَّر
job status   BLOCKED
run          none — toolExecuted=false
handler executions = 0   (must be exactly 0)
audit        job.created → job.transitioned → job.transitioned → approval.requested → approval.denied
══════════════════════════════════════════════════════════════════
```

---

## 10. النتائج

| الفحص | النتيجة |
|------|--------|
| **Tests** | ✅ **115/115** عبر 6 ملفات |
| **TypeScript** (`tsc --noEmit`) | ✅ نظيف — صفر أخطاء |
| **Lint** (eslint) | ✅ صفر ملاحظات على كل ملفات هذه المرحلة (المشروع ككل يحمل 122 مشكلة سابقة في ملفات قديمة/tests) |
| **Build** (`next build`) | ⚠️ **لم يُشغَّل** — القرص C: ممتلئ: **134MB حرة من 140GB**، وبناء Next يحتاج مئات الميغابايت وكان سيملأ قرص النظام. خطوة البناء الأولى `prisma generate` شُغِّلت بنجاح ✅ |
| **Local DB evidence** | ✅ 4 جداول `ai_*` من الملفين المقترحين + مسار كامل بين عمليتين |
| **Production DB** | ✅ ZERO CONNECTION / ZERO WRITE |
| **master** | ✅ لم يُمَس (`bf701fa`) |
| **External calls** | ✅ لا شيء: لا Hermes، لا LLM، لا MCP، لا webhooks، لا Scheduler |

توزيع الاختبارات: `capital` 50 · `ai-workforce` (Phase 1A) 31 · `ai-workforce-phase1b` 31 · `ai-workforce-persistence` 3.

**متطلبات Phase 1B الـ16:** كلها مغطّاة — الاستمرارية (1،2،3،4،12)، الموافقات (5،6،7،8،9،10،11)، الحالات (13)، الحارس (14)، وPhase 1A + تطبيق النظام (15،16).

---

## 11. القيود المعروفة (Known Limitations)

1. **لا AI Provider** — Local Runtime فقط، بتصميم مقصود.
2. **بيانات Job/Core في الذاكرة افتراضيًّا** في التطبيق الحي: `AI_WORKFORCE_PERSISTENCE=database` + قاعدة معزولة مطلوبان صراحةً. في serverless يعني ذلك فقدانًا عند cold start — مقبول الآن لأن الهدف إثبات المحرك دون لمس بيانات الإنتاج.
3. **`ActorSnapshot` snapshot للحقوق**: التوكنز تُشتق من claims محفوظة وقت الإنشاء، وليست قراءة من صف المستخدم لحظة الاستئناف. (تقوية Phase 1C: قراءة المستخدم من الـDB.)
4. **`outputSchema` للتوثيق لا للفرض** (كما في Phase 1A).
5. **لا Queue/Worker**: إن انهارت العملية بعد تسجيل القرار وقبل التنفيذ، الـJob يبقى قابلًا للاستئناف عبر `POST /jobs/:id/resume` — لكن لا يوجد شيء يعيده تلقائيًّا.
6. **`approvalReason`** لا يُخزَّن كعمود (السبب الحقيقي في سجل الموافقة نفسه).
7. **وجود موافقة معلّقة + `MANUAL/HUMAN`**: سياسة Phase 1A "حضور الإنسان = الموافقة" ما زالت سارية؛ لفرض قرار مُسجَّل دائمًا استخدم `STRICT_APPROVAL_POLICY` (مُختبَرة).
8. **لا commit**: كل الملفات في الـworking tree على الفرع للمراجعة الكاملة.
9. **لا build كامل** بسبب حالة القرص المذكورة.

---

## 12. المقترح: Phase 1C

1. **قاعدة بيانات تطوير منفصلة ومعتمدة** ⇒ تطبيق الهجرة المقترحة فعليًّا + تشغيل persistence في بيئة Dev.
2. **أداة كتابة حقيقية واحدة** (`office.fixed_expenses.generate`, MEDIUM/idempotent) لتغليف خدمة قائمة بدلًا من fixture.
3. **استئناف تلقائي (Worker/Reaper)**: مسح Jobs عالقة بين القرار والتنفيذ + `retryPolicy` حقيقي.
4. **توحيد الصلاحيات** بنقل اشتقاق التوكنز إلى جوار `src/lib/auth.ts` كمرجع واحد.
5. **`HermesRuntimeAdapter`** بواجهة Service Identity مُتحقَّق منها فعلًا (`verified: true` بعد التحقق من الاعتماد).
6. **تقوية الأدلة**: قراءة المستخدم من الـDB عند الاستئناف + Tool Grants لكل وكيل لاحقًا.
7. **Command Center الكامل**: Sidebar + سجل Runs/Events قابل للتصفية + إعادة تشغيل آمنة.

---

## ✅ PHASE 1B EXIT GATE

- [x] files created — 43 ملف وحدة + 9 API routes + UI + tests + migration + docs
- [x] files modified — 13 ملف داخل الوحدة/الواجهة + `prisma/schema.prisma` (إضافي فقط) + README المقترحات
- [x] DB models actually used — `ai_jobs` · `ai_runs` · `ai_run_events` · `ai_approvals` (4 فقط)
- [x] migration used LOCALLY only — حُذفت `ai_tool_invocations` المقترحة (قرار مراجعة موثَّق)؛ أُضيفت 7 أعمدة + فهرسان
- [x] repository architecture — 4 Ports + تنفيذان (In-Memory / Prisma) والـCore بلا Prisma
- [x] approval architecture — قرار مُسجَّل كامل + تفويض مقيَّد بـRBAC + استئناف نفس الـJob
- [x] idempotency mechanism — 3 طبقات CAS (قرار / تنفيذ / ملكية الاستئناف)
- [x] tests result — **115/115** ✅
- [x] TypeScript result — **نظيف** ✅
- [x] build result — ⚠️ لم يُشغَّل: مساحة القرص (134MB حرة)؛ `prisma generate` نجح
- [x] local DB evidence — 4 جداول `ai_*` + مسار كامل بين عمليتين مختلفتين
- [x] Production DB evidence — **ZERO CONNECTION / ZERO WRITE** ✅
- [x] master untouched — `bf701fa` بدون أي تغيير ✅
- [x] Production untouched — لا deploy، لا migration، لا اتصال ✅
- [x] known limitations — §11
- [x] proposed Phase 1C — §12

**⛔ STOP — لم تبدأ Phase 1C.**
