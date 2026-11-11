# حزمة نشر النسخة التجريبية الخاصة — ما فيها، وما اختُبر فعلًا

هذه الحزمة **لا تلمس أي خادم**. ما هنا: ملفات تُبنى وتُشغَّل، وقياسات نُفِّذت محليًا
على نفس الشجرة. القياسات مسجّلة في `docs/DEPLOYMENT_PRIVATE_TRIAL.md` §13 بالتفصيل؛
وهذا الملف مرجع المشغّل.

## الملفات

| الملف | الدور |
|---|---|
| `Dockerfile` | صورة الإنتاج: 3 مراحل (deps → build → runner)، `USER` غير جذر، `HEALTHCHECK` على `/login`. يقبل `--build-arg TRIAL_READ_ONLY=1`. |
| `compose.yml` | خدمتان فقط: `db` و`app`. شبكتان: `internal` (مغلقة، القاعدة وحدها + التطبيق) و`edge` (شبكة الوكيل، **التطبيق فقط**). **لا `ports:` إطلاقًا**. |
| `traefik/command.yml` | router/service/middlewares للوكيل عبر **file provider** — منفصل تمامًا عن `compose.yml`، فلا يمكن لعنوان في الحزمة أن يوجّه الحافة إلى غير حاويتنا. |
| `.env.example` | أسماء المتغيرات وقواعدها، بلا أي قيمة سرية. |
| `scripts/create-first-user.mjs` | المستخدم الأول: كلمة مرور مولّدة (24 بايت) أو `--password-stdin`؛ يرفض وجود مستخدم/بريد مسبق. لا كلمة مرور افتراضية في المستودع. |
| `scripts/backup.sh` | `pg_dump -Fc` إلى ملف `.part` ثم إعادة تسمية + `sha256` + عدّ صفوف. |
| `scripts/restore.sh` | استعادة إلى **قاعدة scratch** (`--scratch`) وطباعة العدّادات؛ الاستعادة على الحيّة تحتاج `--production --i-understand-data-is-overwritten` معًا. لا ينشئ/يحذف قواعد بنفسه. |
| `scripts/smoke.mjs` | فحص دخان على نسخة تعمل: دخول، `/api/auth/me`، قراءة العملاء/المشاريع، الصفحتان، ثم — مع `--allow-writes` — إنشاء مشروع واحد، وأخيرًا الخروج و`401` بلا جلسة. |

## الشبكات — لماذا الفصل هو الهدف

```
Traefik (موجود، خارج الحزمة)
   └── edge  ← app فقط
        app ──── internal ← app + db
```

`internal: true` تعني أن الشبكة بلا مسار إلى الخارج، ولا ينضم إليها إلا `db` و`app`.
القاعدة **ليست على `edge`**، فحتى حاوية على شبكة الوكيل لا تستطيع فتح مقبس إلى Postgres.
ولا خدمة تنشر منفذًا على المضيف.

## البناء

```bash
# صورة التجربة (مقفلة الكتابة): لاحظ الـbuild arg — إلزامي، انظر «القفل» أدناه
docker build -f deploy/Dockerfile --build-arg TRIAL_READ_ONLY=1 -t nexup-command:<SHA> .

# صورة عادية قابلة للكتابة (سلوك ما قبل التجربة)
docker build -f deploy/Dockerfile -t nexup-command:<SHA> .
```

سجّل الـdigest ولا تستخدم `latest`:
`docker image inspect --format '{{index .RepoDigests 0}}' nexup-command:<SHA>`

## التشغيل

```bash
# الأسرار أولًا: /etc/nexup-command/app.env و db.env بصلاحية 0600 (الأسماء في .env.example)
COMMAND_IMAGE=<digest> EDGE_NETWORK=<proxy network> \
  docker compose -f deploy/compose.yml up -d
```

Traefik يُضاف بشكل منفصل:

```bash
install -m 0644 deploy/traefik/command.yml /etc/traefik/dynamic/command.yml
# عدّل Host(`…`) والعنوان الوحيد المسموح داخل الملف — ثم أعد تحميل الوكيل
```

## القفل (`TRIAL_READ_ONLY`) — اقرأ هذا قبل البناء

القفل مفروض في **موضعين** لأن كل موضع يرى بيئة مختلفة:

1. `src/middleware.ts` — middleware يعمل في **Edge runtime**، و`process.env` فيه يُستبدل
   **وقت البناء**. فقفل الحافة يُخبز بالـbuild arg، ويُغلق عائلات كاملة
   (`/api/exec/*`، `/api/ai-workforce/*`).
2. `src/lib/trial-lock.ts` — تستورده معالجات Node (`projects`, `projects/[id]`, `clients`,
   `clients/[id]`)، ويقرأ المتغيّر **وقت الطلب**. فهو يحمي النسخة التي نُسِيَ لها الـarg.

قياس فعلي على هذه الشجرة: بناء بلا الـarg + `TRIAL_READ_ONLY=1` وقت التشغيل → كتابة الدليل
`403` لكن `/api/ai-workforce/health` ما زالت `200`؛ وبعد إعادة البناء بالـarg → **17/17 فحصًا**.

`compose.yml` يمرّر `TRIAL_READ_ONLY: ${TRIAL_READ_ONLY:-1}` أيضًا؛ اجعل الاثنين متوافقين.

## ما لم يُختبر هنا

`docker: command not found` على جهاز الإعداد — لذلك **لم يُنفَّذ** `docker build` ولا
`compose up` ولا توجيه Traefik ولا فحص الصحة داخل الحاوية. كل ما تحته اختُبر على عملية
`next start` حقيقية بنفس مخرَج البناء، وليس على صورة.

## تحذير الهجرات

`prisma migrate deploy` **لا يبني المخطط من الصفر** على هذه الشجرة: يتوقف بعد 4 من 14 هجرة
بـ`column "designerName" does not exist` (تاريخ الهجرات انحرف عن المخطط). قاعدة التجربة
بُنيت بـ`prisma db push --accept-data-loss` (38 جدولًا، 20 عمود `deletedAt`). أي نشر حقيقي
يحتاج إعادة تأسيس الهجرات أولًا — التفاصيل في §13 و§10 من وثيقة النشر.

كذلك: نطاق القراءة في الكود مثبَّت على `nexup`/`rebound`/`abomazen`، فشركة بـslug آخر
تُقرأ كصفر صفوف رغم وجودها. لهذا يُنشأ مستخدم التجربة على شركة `nexup`.

## Static verification (`verify-compose.py`)

Proving that the database is unreachable from the proxy network needs an engine and a second container
on `edge`. Where no engine exists, this script proves everything the files themselves decide, and prints
what it could not prove:

```bash
python deploy/scripts/verify-compose.py   # needs PyYAML; exit 1 on any broken invariant
```

It parses the real YAML (not the comments) and asserts: no service publishes a port, `internal` is
`internal: true`, `edge` is `external: true`, **`db` is on `internal` only and on nothing else**, **`app`
is the only member of `edge`**, the app waits for a healthy db, runs read-only, drops `ALL` caps, keeps
`no-new-privileges`, defaults `TRIAL_READ_ONLY=1`, and the image is a pinned reference — plus that the
Dockerfile takes `TRIAL_READ_ONLY` as a build `ARG` and its runtime stage is not root.

On a host with Docker, the runtime proof replaces this one:

```bash
docker build -f deploy/Dockerfile --build-arg TRIAL_READ_ONLY=1 -t nexup-command:trial .
docker compose -f deploy/compose.yml up -d
docker compose -f deploy/compose.yml ps          # both healthy
docker run --rm --network <EDGE_NETWORK> busybox sh -c \
  'nc -zv nexup-command-db-1 5432'              # must FAIL: no such host / refused
docker exec nexup-command-app-1 node -e "fetch('http://db:5432').catch(e=>console.log('reachable from app:', e.code))"
```
