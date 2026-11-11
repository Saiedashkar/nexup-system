# النسخة التجريبية الخاصة (موبايل) — خطة نشر قابلة للتنفيذ

**الحالة:** وثيقة تسليم. **لا شيء في هذا الملف نُفِّذ على الخادم**، ولا شيء فيه يعدّل
Hermes أو NEXPUBLISH أو Traefik أو خدمة PostgreSQL النظامية. الغرض أن يكون التنفيذ
لاحقًا ميكانيكيًا: كل خطوة لها أمر، ومخرَج متوقّع، وإشارة توقّف.

**تحديث 2026-11-09 — تجهيز النشر نُفِّذ محليًا:** حزمة `deploy/` (Dockerfile + compose +
Traefik file-provider + سكربتات) موجودة الآن، والبناء الإنتاجي نُفِّذ في شجرة معزولة،
والنسخة شُغِّلت ودُخل إليها وقُرِئت العملاء/المشاريع في وضعين (كتابة، وقيد قراءة 17/17)،
ونُسخت القاعدة واستُعيدت فعليًا. الدليل الكامل والقياسات في **§13**، والعوائق الباقية في §10.
Docker غير متاح على جهاز الإعداد، فالصورة وCompose وTraefik **لم تُختبر تشغيليًا**.

الفرع: `feature/data-binding-clients-projects-20261107` · آخر commit: `635961c`
· التطبيق: Next.js 16.3.2 + React 19.2.8 + Prisma 7.9.1 (`@prisma/adapter-pg` + `pg`)
· قاعدة البيانات: PostgreSQL · **14 هجرة** في `prisma/migrations` + `migration_lock.toml`
· تعريف الصورة الآن في `deploy/` (`Dockerfile`, `compose.yml`, `traefik/command.yml`, `scripts/*`) — وثيقة الحزمة: `deploy/README.md`.

---

## 1. الهدف والنطاق

نسخة **واحدة**، خاصة، تُفتح من الموبايل، ببيانات تجريبية (أو بيانات عمل حقيقية بحدود)،
على الخادم الموجود، **بمعزل تام** عن Hermes و NEXPUBLISH.

| داخل النطاق | خارج النطاق |
|---|---|
| بناء إنتاجي واحد للتطبيق + قاعدة خاصة + شهادة TLS + تشغيل مستمر | تسليم الصفقات إلى العميل (غير منفّذ — راجع `docs/DEAL_HANDOFF_SPEC.md`) |
| نسخ احتياطي مجدول واستعادة مُختبرة | idempotency للكتابات (مطلوبة قبل التسليم، §11.3 في `COMMAND_DIRECTORY_BINDING.md`) |
| تحديث/رجوع بإصدار مثبَّت | تفعيل Workforce/EXEC الحيّ (يحتاج bridge + Hermes) |
| فحص جاهزية الخادم **للقراءة فقط** | أي تغيير على Hermes، NEXPUBLISH، منفذ 4860، 9119، 9220، أو إعدادات Traefik الثابتة |

---

## 2. ما يعمل اليوم (مُثبت على هذه الشجرة) وما هو تجريبي

### 2.1 يعمل ومُختبر
- **الدخول والجلسة**: `/login` → `POST /api/auth/login` (كوكي `nexup_session`, HS256, 8 ساعات)
  → `/api/auth/me` (role + `scope`) → `POST /api/auth/logout`. بلا جلسة: `401` للـAPI و`307 /login?next=…` للصفحات.
- **`/command/clients` و`/command/projects`**: قراءة مربوطة بقاعدة حقيقية عبر `resolveReadScope`،
  مع بوّابة صلاحية للمشاريع (الموظف مرفوض قبل أي بحث)، وبناء/تعديل/حذف كل عملية في معاملة واحدة
  تشمل سجل النشاط، وتنظيف العملاء الجماعي في معاملة واحدة للطلب. **63/63 اختبار** على الـhandlers
  الحقيقية + `tsc` و`eslint` نظيفان. مراجعة الربط **أُغلقت رسميًا**: 63/63 بلا تخطٍّ، والمصدر المُراجَع
  `635961c` مطابق للشجرة — السجل `.demo/review/directory-db-tests-635961c.log` والحصيلة §11.7 في
  `docs/COMMAND_DIRECTORY_BINDING.md`.
- **الإحصاءات `/api/office/stats`**: قراءة لا تكتب شيئًا.
- **الحذف الناعم وسلّة المحذوفات** والاستعادة، مع اشتراكات ودفعات وحركات خزينة تابعة.
- **واجهات COMMAND** (home, finance, missions, activity, marketing room, sales, exec lab) تُبنى وتُقدَّم،
  لكن ما يعتمد على بيانات حقيقية هو العملاء/المشاريع/الإحصاءات فقط.

### 2.2 تجريبي — يُفتح بحدود أو يبقى مغلقًا
| الجزء | الحالة | القرار في النسخة التجريبية |
|---|---|---|
| Workforce / EXEC runtime الحيّ | يحتاج bridge على VPS + Hermes (`HERMES_RUNTIME_TRANSPORT`). يفشل مغلقًا إذا غابت المتغيرات، فتصبح الحالة "runtime disabled" | **يبقى غير مُهيّأ** في هذه النسخة |
| Marketing room / Sales journey | حالة عرض (demo state) لا تُنشر محتوى | تُعرض كما هي، بلا وعود نشر |
| إيصالات الدفع (رفع الملفات) | تحتاج مفاتيح R2 الخمسة؛ بدونها يرمي رسالة عربية واضحة | **معطّل** ما لم تُضبط `R2_*` |
| Company/role matrix الكامل | `SUPER_ADMIN` + `ADMIN` مُختبران؛ `EMPLOYEE` مرفوض من المشاريع بقرار صريح | مستخدم واحد `SUPER_ADMIN` للنسخة الخاصة |
| تعدد المؤسسات | شركتان في اختبارات القاعدة؛ الديمو فيه `nexup` واحدة | يكفي للتجربة |

---

## 3. متطلبات الخادم والقاعدة والأصول

| المورد | الحد الأدنى | المستحسن | لماذا |
|---|---|---|---|
| vCPU | 2 | 2–4 | Next.js + Postgres على نفس المضيف |
| RAM | 2 GB (+ swap 2 GB) | 4 GB | ذروة `next build` ~1–1.5 GB، والتشغيل ~400–600 MB |
| قرص | 20 GB | 40 GB | صورة/طبقات Docker + قاعدة + نسخ احتياطي محلي 7 أيام |
| نظام | Linux x86_64، Docker + Compose v2 (موجودان على الخادم) | نفسه | مطابق لما هو مُثبت في `NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md` §0 |
| PostgreSQL | 18 (مطابق لما استُخدم في الفحوص) كحاوية **مستقلة** | نفسه | `prisma migrate deploy` يحتاج تاريخ الهجرات نظيفًا |
| DNS/TLS | اسم فرعي واحد `command.<DOMAIN>` + شهادة عبر Traefik | نفسه | **إلزامي**: الكوكي `secure` في الإنتاج (`src/lib/auth.ts` §`secure: NODE_ENV === "production"`) — بالـHTTP العادي لن تُحفظ الجلسة على الموبايل |
| منافذ خارجية | `443` فقط للاسم الجديد (و`22` للإدارة) | نفسه | لا منفذ تطبيق ولا قاعدة منشور |

**الأصول:** `public/` = **1.8 MB** (منها `public/exec-lab` = 1.8 MB خطوط/صور). لا شيء منها يُحمَّل
خادميًا؛ تُقدَّم من حاوية التطبيق نفسه مع `Cache-Control: immutable` سنة (مضبوط في `next.config.ts`
للإنتاج فقط). `.next` المحلي (263 MB) **مخرَج تطوير لا يُنقل**.

**مخرَج البناء:** Next.js قياسي (`npm ci && prisma generate && next build`) → `next start`.
لا يوجد `output: "standalone"` في `next.config.ts`؛ لذلك صورة الحاوية يجب أن تحمل `node_modules`
(أو نضيف `standalone` لاحقًا كتحسين منفصل، لا في نافذة النشر).

---

## 4. جاهزية الخادم الموجود — ما نعرفه وما يجب قياسه قبل أي خطوة

**معلوم من وثائق المستودع** (`docs/NEXUP_VPS_BRIDGE.md` §6، و`NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md` §0):

| الحقيقة | الأثر على COMMAND |
|---|---|
| Traefik يملك `:80` و`:443` على المضيف | لا نُثبّت Caddy/nginx ولا نأخذ 80/443؛ نضيف **router label** على حاوية COMMAND فقط |
| **لا Node ولا npm على المضيف** (بقرار موثّق) | COMMAND يعمل كحاوية Docker؛ لا نُثبّت Node على المضيف ولا نلمس هذا القرار |
| Hermes داخل حاوية، `127.0.0.1:9119`، والـbridge يشاركها الشبكة على `9220` | COMMAND لا يدخل شبكة Hermes ولا يقرأ `/etc/nexup-bridge/` |
| لوحة على `4860` موجودة | خارج نطاقنا تمامًا: لا restart، لا ports، لا env |
| خارجيًا: `443` و`22` فقط | نفس القاعدة للاسم الجديد |

**غير معلوم ويُقاس للقراءة فقط قبل الموافقة** (لا تغيير، لا كتابة):

```bash
# 1) موارد ومساحة
nproc; free -m; df -h /; swapon --show
# 2) Docker و Compose
docker version --format '{{.Server.Version}}'; docker compose version
# 3) ما يعمل الآن ومن أي شبكة (توثيق الوضع القائم)
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker network ls
# 4) من يستمع خارجيًا (يجب ألا يظهر 9119/9220/4860 على المضيف)
ss -ltnp | grep -E ':(80|443|9119|9220|4860)\b'
# 5) هل توجد قاعدة باسمنا؟ (لا نُنشئ شيئًا الآن)
docker exec <HERMES_OR_DB_CONTAINER> psql -U postgres -tAc "select datname from pg_database" 2>/dev/null || echo "no psql path here — leave it"
# 6) DNS: هل الاسم الفرعي يشير إلى هذا الخادم؟
dig +short command.<DOMAIN>
```

**إشارات توقف:** مساحة حرة < 10 GB · ذاكرة متاحة < 800 MB بلا swap · اسم DNS لا يشير للخادم ·
وجود مستمع على 80/443 خارج Traefik · أي محاولة لقياس شيء تتطلب إعادة تشغيل حاوية قائمة.

> **ملاحظة صدق:** جاهزية القرص/الذاكرة/DNS **غير مقيسة** في هذه الوثيقة — لا وصول للخادم من هنا.
> لذلك الخطوة 0 في §9 ليست شكلية؛ هي بوّابة.

---

## 5. العزل عن Hermes و NEXPUBLISH (التصميم المقترح)

المبدأ: **لا شيء مشترك** مع الجيران — لا شبكة، لا مجلد، لا ملف أسرار، لا مستخدم، لا منفذ.

```
        Traefik (يوجد — لا نعدّله)
              │  router: Host(`command.<DOMAIN>`)  (labels على الحاوية الجديدة فقط)
              ▼
   docker network: nexup-command      (شبكة خاصة جديدة، غير nexup-bridge/hermes)
   ┌──────────────────────────────────────────────┐
   │  nexup-command-app   127.0.0.1:3000 داخليًا  │  ← لا ports: على المضيف
   │        │                                     │
   │        ▼                                     │
   │  nexup-command-db    postgres:18، volume     │  ← لا منفذ منشور، لا شبكة مشتركة
   └──────────────────────────────────────────────┘
```

| البند | القرار | لماذا يمنع التصادم |
|---|---|---|
| الشبكة | شبكة Docker جديدة `nexup-command` | لا يرى COMMAND حاويات Hermes ولا الـbridge، ولا يراها |
| المنافذ | لا `ports:` إطلاقًا؛ Traefik يصل عبر الشبكة | لا تنافس على 4860/9119/9220 |
| الاسم/الشهادة | اسم فرعي جديد فقط | لا يلمس `Host(...)` الخاص بالـbridge |
| الأسرار | `/etc/nexup-command/app.env` و`db.env` (0600، مالك مستخدم الخدمة) | لا قراءة لـ`/etc/nexup-bridge/*` |
| المستخدم | مستخدم نظام `nexup-command` للحاوية/الـunit | لا صلاحيات على ملفات الجيران |
| Docker socket | **غير مُوصَّل** بالحاوية | حاوية التطبيق لا تستطيع التحكم بأي حاوية أخرى |
| الحدود | `mem_limit` 1 GB، `cpus` 1.5، `pids_limit`، `read_only` + tmpfs حيث أمكن | لا يجوع Hermes/NEXPUBLISH |
| NEXPUBLISH | لا يُذكر في أي أمر هنا؛ لا شبكة، لا مجلد، لا خدمة | غير قابل للمساس من هذه الخطة |

---

## 6. الإعدادات بلا أسرار (الأسماء فقط)

تُكتب القيم على الخادم بيد المشغّل، لا في git ولا في هذه الوثيقة ولا في `journalctl`.

**التطبيق — `/etc/nexup-command/app.env` (0600):**

| الاسم | القيمة/القاعدة | المصدر في الكود |
|---|---|---|
| `DATABASE_URL` | `postgresql://command:<PASS>@nexup-command-db:5432/command` | `src/lib/prisma.ts` |
| `DATABASE_SSL_DISABLE` | `1` (شبكة Docker داخلية بلا TLS) | `src/lib/prisma.ts` |
| `AUTH_SECRET` | **≥ 32 حرفًا عشوائيًا** (`openssl rand -hex 32`)، وإلا يرمي عند أول استخدام | `src/lib/auth.ts` |
| `NODE_ENV` | `production` | Next + الكوكي `secure` |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` داخل الحاوية | `next start` |
| `R2_*` (5 أسماء) | **اختياري** — بدونها رفع الإيصالات يعطي رسالة عربية ولا يكسر بقية النظام | `src/lib/r2.ts` |

**غير مطلوب ولا يُضبط:** `HERMES_RUNTIME_*`، `NEXUP_BRIDGE_*`، `HERMES_SESSION_TOKEN`،
`HERMES_PROFILE` — غيابها هو ما يُبقي Workforce/EXEC خارج النسخة (فشل مغلق، لا fallback).

**القاعدة — `/etc/nexup-command/db.env` (0600):** `POSTGRES_DB=command`،
`POSTGRES_USER=command`، `POSTGRES_PASSWORD=<32 hex>`، `POSTGRES_INITDB_ARGS=--data-checksums`.
لا تُعاد استخدام كلمة مرور الجيران، ولا يُعاد استخدام قاعدة موجودة.

**التحقق دون طباعة قيمة:**

```bash
stat -c '%a %U:%G' /etc/nexup-command/app.env        # 600 <user>:<group>
awk -F= '/^AUTH_SECRET=/{print length($2)}' /etc/nexup-command/app.env   # >= 32
grep -c '^R2_' /etc/nexup-command/app.env            # 0 (معطّل) أو 5
```

---

## 7. القاعدة: التهيئة والهجرات

- **مرة واحدة:** حاوية `postgres:18` جديدة بحجم دائم `nexup-command-pgdata`، بلا منفذ منشور.
- **الترحيل:** `prisma migrate deploy` فقط (14 هجرة) — **لا `db push`** على أي قاعدة تُحفظ.
- **أين يعمل أمر الترحيل:** `prisma` حزمة تطوير، فلا تُضمَّن في صورة الإنتاج. الطريقتان المقبولتان:
  1. من جهاز البناء عبر نفق SSH إلى حاوية القاعدة:
     `ssh -L 55432:nexup-command-db:5432 <VPS>` ثم
     `DATABASE_URL=postgresql://command:<PASS>@127.0.0.1:55432/command npx prisma migrate deploy`
  2. حاوية `migrate` مؤقتة من صورة البناء (تحتوي devDependencies) تُشغَّل مرة وتُحذف.
  الطريقة (1) أبسط ولا تزيد حجم الصورة.
- **المستخدم الأول:** سكربت صغير يُدخل `SUPER_ADMIN` واحدًا (نفس ترتيب `business` ثم `user`)؛
  كلمة المرور تُولَّد على الخادم وتُسلَّم عبر قناة خاصة.
- **التحقق:** `select count(*) from _prisma_migrations where finished_at is null;` = 0،
  و`npx prisma migrate status` يقول "Database schema is up to date".

---

## 8. التشغيل المستمر، النسخ الاحتياطي، التحديث، الرجوع

### 8.1 التشغيل المستمر
- `restart: unless-stopped` للحاويتين + `healthcheck` على `GET /login` (200) للتطبيق و`pg_isready` للقاعدة.
- سجلات إلى `journald`/`docker logs` مع `--log-opt max-size=10m --log-opt max-file=3`.
- `systemd` unit صغير اختياري يلفّ `docker compose up -d` لضمان الإقلاع بعد reboot (بدون وصول لشبكة Hermes).
- مراقبة بشرية كافية للتجربة: `curl -o /dev/null -w '%{http_code}' https://command.<DOMAIN>/login` = **200**،
  و`/api/clients` بلا جلسة = **401**.

### 8.2 النسخ الاحتياطي (قبل فتح النسخة للمستخدمين)
```bash
# يوميًا 03:10 على الخادم، بمستخدم الخدمة، إلى /var/backups/nexup-command
docker exec nexup-command-db pg_dump -U command -Fc -d command \
  > /var/backups/nexup-command/command-$(date +%F-%H%M).dump
find /var/backups/nexup-command -name 'command-*.dump' -mtime +7 -delete
```
- احتفاظ: **7 يومية + 4 أسبوعية** (نسخة أسبوعية تُنسخ خارج الخادم: وجهة R2/جهاز المشغّل).
- **الأسرار ليست في الـdump**: نسخة `/etc/nexup-command/*.env` تُحفظ في مدير أسرار المشغّل، منفصلة.
- **الاستعادة تُختبر قبل الإطلاق** (وليست وعدًا): استعادة الـdump في قاعدة scratch، ثم
  `prisma migrate status` + `count` لجدولين، ثم حذف قاعدة الاختبار. تُسجَّل النتيجة.

### 8.3 التحديث (بإصدار مثبَّت، بلا `latest`)
1. على جهاز البناء: `git fetch && git checkout <SHA>`، `npm ci`، `npx tsc --noEmit`،
   الاختبارات المركزة، `next build` — كلها يجب أن تنجح.
2. `docker build -t nexup-command:<SHA> .` ثم `docker image inspect --format '{{index .RepoDigests 0}}'` وسجّل الـdigest.
3. **نسخة احتياطية الآن** (§8.2) — هذه هي نقطة الرجوع.
4. `prisma migrate deploy` (نفق SSH) — قبل تبديل الحاوية.
5. `docker compose up -d` بالصورة الجديدة → فحص الصحة → `/login` 200، `/api/auth/me` 200 بعد دخول،
   صفحة `/command/projects` 200، وحذف/تعديل تجريبي واحد على بيانات اختبار.
6. أبقِ الصورة السابقة على الخادم (rollback فوري).

### 8.4 الرجوع
| الحالة | الإجراء |
|---|---|
| الكود فقط سيّئ | `docker compose up -d` بالـdigest السابق (دقيقة واحدة) |
| هجرة غيّرت الشكل | استعادة الـdump المأخوذ في 8.3/3، ثم تشغيل الصورة السابقة |
| فساد بيانات | استعادة آخر dump سليم + تسجيل الفارق الزمني المفقود بصراحة |

**الهجرات إلى الأمام فقط** — لا يوجد "down" موثوق؛ الرجوع الحقيقي هو **restore**. هذا مكتوب هنا
حتى لا يُفاجأ المشغّل وقت الحاجة.

---

## 9. خطة التنفيذ (بالترتيب، كل خطوة ببوّابة)

| # | الخطوة | المخرَج المتوقّع | توقف إن |
|---|---|---|---|
| 0 | قياسات §4 للقراءة فقط + تسجيل الحالة | أرقام موارد/شبكة/DNS في سجل التغيير | أي إشارة توقف في §4 |
| 1 | DNS: `command.<DOMAIN>` → IP الخادم | `dig` يطابق | لا تطابق |
| 2 | `/etc/nexup-command/` + مستخدمان/أسرار (0600) | `stat` = 600 | أي ملف مقروء لغير مالكه |
| 3 | شبكة `nexup-command` + حاوية القاعدة + volume | `pg_isready` داخليًا، لا منفذ على المضيف | منفذ منشور بالخطأ |
| 4 | `prisma migrate deploy` من جهاز البناء عبر النفق | `migrate status` نظيف | فشل هجرة |
| 5 | مستخدم `SUPER_ADMIN` الأول | دخول ناجح على `http://127.0.0.1:3000` داخل الخادم | فشل دخول |
| 6 | كتابة `Dockerfile` + `compose.yml` للتطبيق ومراجعتهما (لا وجود لهما اليوم — عائق #9)، ثم بناء الصورة + labels Traefik + `compose up` | `https://command.<DOMAIN>/login` = 200 | 502/404/شهادة خاطئة |
| 7 | فحص الهاتف: دخول، `/command/clients`، `/command/projects`، إضافة عميل/مشروع، خروج | كل الصفحات 200 والجلسة تُحفظ عبر HTTPS | الجلسة لا تُحفظ (يعني HTTP لا HTTPS) |
| 8 | جدولة النسخ + **اختبار استعادة** | restore ناجح موثّق | فشل استعادة |
| 9 | تسليم: الرابط، المستخدم، مكان النسخ، إجراء الرجوع، وحدود النسخة (§2.2) | رسالة تسليم واحدة | — |

**زمن متوقع:** 2–3 ساعات للخطوات 0–7 (منها 30–40 دقيقة بناء)، + 30 دقيقة للنسخ والاستعادة.

---

## 10. العوائق والحدود (يجب أن تُقرأ قبل الموافقة)

1. **البناء الإنتاجي نُفِّذ الآن بنجاح — في شجرة معزولة لا في `.next` الأصلية.** `.deploy/tree`
   (نسخة شجرة + junction لـ`node_modules`) أنتجت `BUILD_ID=xBzUmJntUH51CF7R7q0v3` ثم
   `djmXay5SjmAaCreK2u1gp` بعد تفعيل قفل الحافة، بـ`Compiled successfully in 15.0s` لكلتيهما.
   `.next` الأصلية بقيت **بلا `BUILD_ID`** ومعاينة 3211 بقيت تعمل. يبقى على نافذة النشر أن
   تُعيد البناء على الـSHA المستهدف داخل الحاوية وتُسجّل الزمن.
2. **لا وصول للخادم من جلسة الإعداد هذه**: الذاكرة/القرص/DNS/وجود Postgres غير مقيسة (خطوة 0).
3. **HTTPS شرط لا تحسين**: الكوكي `secure` في الإنتاج. أي محاولة "تجربة سريعة بـ`http://IP:PORT`"
   ستفشل في تسجيل الدخول على الموبايل — وهذا سلوك مقصود لا خلل.
4. **لا قفل/حد لمحاولات الدخول** موثّق في الكود بهذا النطاق؛ على رابط عام يجب الاعتماد على
   اسم غير قابل للتخمين + كلمة مرور قوية + تجربة بمستخدم واحد، ويفضّل تحديد الوصول بـIP allowlist
   على router Traefik للاسم الجديد (تغيير على **حاويتنا** فقط، لا على إعداد Traefik الثابت).
5. **رفع الإيصالات يحتاج R2**؛ بدونها الميزة معطّلة برسالة عربية، والدفعات تُسجَّل بلا مرفق.
6. **Workforce/EXEC الحيّ معطّل** في هذه النسخة (يلزمه Hermes/bridge، وهو جار لا نلمسه الآن).
7. **تسليم الصفقات غير منفّذ**، و**idempotency غير منفّذة**: إعادة إرسال طلب بعد ضياع الرد قد تُكرِّر
   مشروعًا/إيداعًا. للتجربة الخاصة مقبول إن ذُكر للمستخدم؛ وقبل التسليم الحقيقي هو شرط.
8. **نسخة تجريبية ببيانات حقيقية** = مسؤولية نسخ احتياطي يومية مُتحقَّقة؛ لو أردت بيانات وهمية فقط،
   الخطوة 5 تُملأ ببيانات الديمو بدل بيانات العمل.
9. **حزمة الصورة كُتبت ولم تُبنَ**: `deploy/Dockerfile` (3 مراحل، غير جذر، `HEALTHCHECK`) و
   `deploy/compose.yml` (شبكة `internal` مغلقة للقاعدة، و`edge` للتطبيق وحده، بلا `ports:`) و
   `deploy/traefik/command.yml` (file provider منفصل). **`docker` غير مثبّت على جهاز الإعداد**
   (`docker: command not found`)، فلم يُنفَّذ `docker build` ولا `compose up` ولا توجيه Traefik
   ولا `HEALTHCHECK` داخل حاوية. الأمر التالي على جهاز فيه Docker هو البوّابة الحقيقية لهذه الحزمة.

11. **سلسلة الهجرات لا تُنشئ المخطط من الصفر (عائق حقيقي، مُقاس).** `prisma migrate deploy`
    على قاعدة جديدة طبّق 4 من 14 ثم سقط بـ`column "designerName" does not exist`؛ تاريخ الهجرات
    انحرف عن المخطط لأن التطوير استخدم `db push`. عيب واحد أُصلح في
    `20260824120000_add_business_multitenancy` (`DROP CONSTRAINT` لكائنين أُنشئا كـINDEX صار
    `DROP INDEX IF EXISTS`)، والسلسلة ما زالت لا تكتمل. لذلك قاعدة التجربة بُنيت بـ
    `prisma db push --accept-data-loss` (38 جدولًا، 20 عمود `deletedAt`). **قبل أي نشر حقيقي
    يجب إعادة تأسيس الهجرات، وإلا فمسار الترقية غير موجود.** ملاحظة: `--skip-generate` لم يعد
    خيارًا في Prisma 7.9 (`unknown or unexpected option`).

12. **قفل التجربة يعتمد على البناء لا على وقت التشغيل وحده.** الـmiddleware يُبنى لـEdge
    runtime، فقيم `process.env` فيه تُستبدل وقت البناء: تشغيل نسخة مبنية **بلا**
    `--build-arg TRIAL_READ_ONLY=1` أوقف الكتابة في مسارات الدليل (`403`) لكن ترك
    `/api/ai-workforce/health` تُعيد `200`. صورة التجربة تُبنى بالـarg؛ الطبقة الثانية في
    `src/lib/trial-lock.ts` تمنع الكتابة عبر معالجات Node في كل الأحوال.

13. **نطاق القراءة مثبَّت على ثلاث شركات في الكود.** `readScopeSlugs` يعيد
    `nexup`/`rebound`/`abomazen` حرفيًا، فشركة بـslug آخر تُقرأ **صفر صفوف** حتى لـ`SUPER_ADMIN`
    بينما `/api/office/stats` يعدّها (قياس: `0 client(s)` مقابل `clients=1`). لذلك يُنشأ مستخدم
    التجربة على شركة `nexup`. جعل النطاق يُقرأ من القاعدة **تغيير وظيفي** — خارج نطاق هذا التسليم.
10. **NEXPUBLISH غير موثّق في هذا المستودع** (لا ذكر له في الكود ولا الوثائق): تفترض الخطة أنه جار
   مستقل، ولا تحتوي على أمر واحد يلمسه. إن كان يشارك Postgres أو Traefik بشكل غير معتاد، فذلك
   يُفحص في الخطوة 0 ويُسجَّل قبل أي تثبيت.

---

## 11. ما لا تفعله هذه الخطة

- لا نشر، لا `git push`، لا تغيير DNS، لا تشغيل حاويات، لا لمس `/etc/nexup-bridge/` أو Hermes أو 4860.
- لا تغيير على Traefik الثابت (ملف واحد إن وُجد) — فقط **labels** على حاوية COMMAND الجديدة.
- لا إعادة استخدام قاعدة بيانات أو كلمة مرور جار.
- لا إضافات على التطبيق (لا `standalone`، لا auth جديد) — التحسينات المؤجلة خارج نافذة النشر.
- لا migrations جديدة ولا تغيير schema.

---

## 12. أوامر مرجعية (تُنفَّذ في النافذة، لا الآن)

```bash
# بناء على جهاز البناء، من جذر المستودع
git rev-parse HEAD                                   # سجّل الـSHA
npm ci
npx tsc --noEmit
npx vitest run tests/directory-write-authorization.test.ts tests/directory-read-scope.test.ts
npx prisma generate
npx next build                                       # ← البوّابة غير المقيسة بعد (عائق #1)
docker build -t nexup-command:<SHA> .                # يحتاج Dockerfile التطبيق (عائق #9) — صورة تحمل node_modules + .next + prisma client
docker image inspect --format '{{index .RepoDigests 0}}' nexup-command:<SHA>

# على الخادم (بعد الموافقة فقط)
install -d -m 0750 -o root -g root /opt/nexup-command /etc/nexup-command
docker network create nexup-command
docker compose -f /opt/nexup-command/compose.yml up -d          # db أولًا، ثم app
curl -s -o /dev/null -w '%{http_code}\n' https://command.<DOMAIN>/login   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://command.<DOMAIN>/api/clients  # 401 بلا جلسة
docker logs --tail 50 nexup-command-app
```

---

## 13. سجل الأدلة — ما نُفِّذ فعليًا (2026-11-09، محليًا، بلا خادم)

كل ما يلي نُفِّذ على هذه الشجرة فوق `e549f77`. **لا اتصال بأي خادم، لا push، لا DNS،
لا مسّ لـ Hermes أو NEXPUBLISH.**

### 13.1 البناء المعزول

| البند | القياس |
|---|---|
| المكان | `.deploy/tree` (نسخة شجرة، `node_modules` عبر junction، `.next`/`.git`/`.demo`/`tests`/`.env*` مستثناة) |
| الأمر | `npx next build --webpack` مع `DATABASE_URL=…/deploy_check` وقت البناء فقط |
| النتيجة | `✓ Compiled successfully in 15.0s`، `BUILD_RC=0` |
| `BUILD_ID` | `xBzUmJntUH51CF7R7q0v3` (بلا قفل حافة) ثم `djmXay5SjmAaCreK2u1gp` (بعد `TRIAL_READ_ONLY=1`) |
| معاينة 3211 | لم تُمَس: `.next` الأصلية **بلا `BUILD_ID`**، والمنفذ 3211 استمر بالرد |

### 13.2 قاعدة جديدة والهجرات

- `prisma migrate deploy` على قاعدة فارغة: **توقف** بعد 4 هجرات — `column "designerName" does not exist`.
  (عيب منفصل أُصلح: `DROP CONSTRAINT "Client_phone_key"` و`ServiceType_name_isCustom_key`
  كانا `INDEX` لا constraint ⇒ صار `DROP INDEX IF EXISTS`.)
- `prisma db push --accept-data-loss`: **نجح** ⇒ 38 جدولًا، 20 عمود `deletedAt`، `DB_PUSH_RC=0`.
- `prisma/proposed-migrations`: لم تُطبَّق ولم تُمَس.

### 13.3 التشغيل والدخول والقراءة

| المرحلة | الحالة | النتيجة |
|---|---|---|
| كتابة مفعّلة (بلا قفل) | `next start` 3311، `✓ Ready in 338ms` | **12/12** فحصًا: دخول، `/api/auth/me`، `1 client(s)`، `3 project(s)`، صفحتا `/command/*` (~33.6 KB)، إنشاء مشروع، خروج، تحويل بلا جلسة، `401` |
| قيد قراءة (`TRIAL_READ_ONLY=1` + بناء بالـarg) | نفسه | **17/17**: كل ما سبق + رفض الكتابة `403 This trial is read-only.` + `/api/exec/turn` و`/api/ai-workforce/*` = `403 external execution disabled` |

المستخدم الأول: `scripts/create-first-user.mjs --slug nexup` ⇒ شركة `cmw8f0xdq0000ksudmvmh1008`
ومستخدم `owner@trial.local` بدور `SUPER_ADMIN`. كلمة المرور من `--password-stdin`
(مولّدة 24 بايت، في `.deploy/trial-check.env` المستثنى من git) — لا تُطبع ولا تُحفظ في المستودع.

ملاحظة صدق عن التشغيل: أول محاولة للمرحلة الثانية أعطت `201` لأن `kill` لم يُوقف الخادم
السابق (استمع 3311 فبقي يخدم، والخادم الجديد فشل بـ`EADDRINUSE`). بعد الإيقاف بالـPID
(`Stop-Process`) وإعادة البناء، كانت النتيجة 17/17 أعلاه. لا تُصدَّق نتيجة مرحلة لم يُثبت
أنها خدمها الخادم المقصود.

### 13.4 النسخ والاستعادة — أثر الرجوع

| الخطوة | المخرَج |
|---|---|
| `deploy/scripts/backup.sh` | `/tmp/nexup-backups/deploy_run-20261109-004015.dump` — 131689 بايت، `sha256=49bf6e32…`, `users=1 clients=1 projects=1` |
| صف كُتب **بعد** النسخة | مستخدم ثانٍ `second@trial.local` ⇒ الحيّة: `users=2` |
| `restore.sh --file … --database deploy_restore --scratch` | أنشأ القاعدة، استعاد في **1s**، والعدّادات: `users=1 businesses=1 clients=1 live_clients=1 projects=1 activity=1` |
| `migration_history` | `absent` — قاعدة بُنيت بـ`db push` لا تحمل `_prisma_migrations`؛ صُحّح السكربت ليقولها بدل أن يفشل |
| **أثر الرجوع** | الاستعادة تُعيد الحالة **لحظة النسخة**: `second@trial.local` غير موجود في القاعدة المستعادة. لا PITR ولا استعادة تدريجية — كل ما بُعد النسخة يضيع |

### 13.5 ما لم يُختبر (ولا يُدّعى)

- `docker build` / `compose up` / توجيه Traefik / `HEALTHCHECK` داخل حاوية — **Docker غير متاح** على جهاز الإعداد.
- الكوكي `secure` على HTTPS حقيقي، والفحص من هاتف — يحتاج الاسم الفرعي والشهادة على الخادم.
- `prisma migrate deploy` على قاعدة تُحفظ (السلسلة مكسورة أصلًا، §10/11).
- EXEC مع مزوّد حقيقي: غير مُهيّأ ولا مُختبر؛ "مغلق" هنا يعني `403` من قفل/إعداد، لا تنفيذًا ناجحًا مع Hermes.

### 13.6 مراجعة الربط — إغلاق موثَّق (لا علاقة له بالخادم)

| البند | القيمة |
|---|---|
| النتيجة | **63/63 نجحت · 0 فشل · 0 تخطٍّ** (`Test Files 2 passed (2)`، `Tests 63 passed (63)`) |
| المصدر المُراجَع | `635961ceb8b6fad53832f691f053001b6f520914` |
| الشجرة وقت التشغيل | `e549f77` — الملف الوحيد الذي تغيّر خلال التشغيل هو `docs/DEPLOYMENT_PRIVATE_TRIAL.md` ⇒ `REVIEWED_SOURCE_AND_TEST_PATHS_IDENTICAL=True` |
| مسار السجل | `.demo/review/directory-db-tests-635961c.log` (رسمي لكن `.demo/` مستثنى من git؛ الحصيلة الدائمة في §11.7 من `docs/COMMAND_DIRECTORY_BINDING.md`) |
| قاعدة الاختبار | `scripts/dev-db.mjs start` على `127.0.0.1:5435`، `DEV_DB_DIR=%LOCALAPPDATA%\nexup-test-db` |

هذه نتيجة الربط (أذونات/معاملات/رجوع الدليل)، **لا** نتيجة النسخة التجريبية: قياسات التشغيل
والنسخ/الاستعادة هي §13.3–13.4، وما لم يُختبر §13.5.

**الحالة النهائية لهذا التسليم:** حزمة نشر جاهزة وقياساتها مسجّلة، و**لم يُغيَّر شيء على أي خادم
ولم يُنشر شيء**. "يعمل" تقال فقط لما في §13.3–13.4 (والربط في §13.6)؛ "غير مُختبر" لما في §13.5.

### 13.7 ما أُثبت بلا مُحرّك Docker، وما بقي غير مُختبر

طلبُ تشغيل الحزمة على جهاز فيه Docker لا يمكن تنفيذه على جهاز التجهيز، والسبب مُقاس لا مُفترض:

| الفحص | النتيجة |
|---|---|
| `docker --version` / `docker compose version` | `command not found` — لا CLI على PATH |
| مسار تثبيت Docker Desktop (`C:\Program Files\Docker\Docker`) | **غير موجود** (سجل تثبيت 4.67.0 من 2026-04-02 يقول "Existing installation found" ثم أُزيل) |
| `com.docker.service` | موجود لكنه **Stopped**؛ لا `dockerDesktopLinuxEngine` pipe |
| WSL | `Ubuntu` موجودة وتعمل، لكن بلا `docker`/`dockerd`/`podman`/`nerdctl` |
| مساحة القرص الحرة على C: | **0.8 GB** — لا تكفي `node:22-bookworm-slim` + `npm ci` + `.next` (عدة GB) |

لذلك **لم يُبنَ أي image ولم تُشغَّل أي حاوية**، ولم أحاول تثبيت Docker Desktop: تثبيت على مستوى النظام
بحجم عدة GB على قرص شبه ممتلئ يحتاج تصعيدًا إداريًا وتنزيلًا لا يمكن أن ينجح في هذه المساحة.

بدلًا من ادّعاء غير مُختبَر، أُضيف فحص ثابت يستخرج ما تحسمه الملفات نفسها:
`python deploy/scripts/verify-compose.py` (PyYAML، بلا أي اعتمادية جديدة في المشروع) — ينجح على
**16/16** ثابتًا، أهمها:

- **`db` على شبكة `internal` وحدها وليس على `edge` إطلاقًا**؛
- **`app` هو العضو الوحيد على شبكة `edge`**؛
- لا خدمة تنشر `ports:`/`expose:` (لا شيء يُرى من المضيف)؛
- `internal: true` و`edge: external: true`؛
- `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `depends_on: service_healthy`؛
- `TRIAL_READ_ONLY` افتراضيًا `1`، والصورة مرجع مثبَّت لا `latest`؛
- Dockerfile: `ARG TRIAL_READ_ONLY` موصول بالـ`ENV`، و`USER nextjs` (غير جذر)، و`HEALTHCHECK` موجود.

هذا **إثبات ثابت حول الملفات، لا إثبات حول التشغيل**: أن الحاوية على `edge` لا تصِل فعلًا إلى Postgres
يبقى غير مُختبر حتى يُشغَّل الأمران في §13.5/`deploy/README.md` على مضيف فيه محرّك.
