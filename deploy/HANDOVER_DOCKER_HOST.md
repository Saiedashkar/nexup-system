# تسليم الحزمة إلى بيئة فيها Docker — المطلوب، والخطوات، وما يجب أن يعود

هذا الملف للشقّ الثاني من الطلب: **بيئة التجهيز لا تحتوي Docker**، فلا يمكن اختبار الحزمة فيها. هنا
المطلوب من المضيف البديل، وخطوات تنفيذ حرفية، والأدلة التي يجب أن تعود.

## لماذا لا يُختبر هنا (مُقاس، لا مُفترض)

| الفحص | النتيجة |
|---|---|
| `docker` / `docker compose version` | `command not found` |
| `C:\Program Files\Docker\Docker` | غير موجود (تثبيت 4.67.0 أُزيل) |
| `com.docker.service` | Stopped، ولا pipe للمحرّك |
| WSL `Ubuntu` | بلا `docker`/`dockerd`/`podman`/`nerdctl` |
| القرص الحر C: | **0.8 GB** — لا يحمل بناء `node:22` + `npm ci` + `.next` |

لذلك لم تُبنَ صورة ولم تُشغَّل حاوية، ولم يُدَّعِ غير ذلك.

## الحزمة المعنيّة (نقطية)

| البند | القيمة |
|---|---|
| الالتزام | الأرشيف مقطوع عند `afdca18` (يحتوي حزمة `6f1196e` كاملة). **تكافؤ بايتي مُتحقَّق** بين `6a3be76` وHEAD في `src/`, `prisma/`, `scripts/`, `tests/`, `deploy/Dockerfile`, `deploy/compose.yml`, `deploy/traefik/`, `deploy/.env.example` (`git diff --quiet` ⇒ `rc=0`). ما بعد `afdca18` وثائق فقط، ولا شيء منه يُدخل في الصورة |
| الأرشيف | `nexup-trial-afdca18.tar.gz` — 25.7 MiB، 955 مدخلًا، `--prefix=nexup-trial/` |
| البصمة | `sha256=7f8fea7d0eeb4c592bef71c2848ac26b7f827f29d09429fa7c419044dd5842db` |

الأرشيف يحتوي الشجرة كلها كما في ذلك الالتزام، ومنها مجلد `bridge/` غير المتعلّق بهذا النشر: **الجذر
المعنيّ هو `nexup-trial/` نفسه**، و`node_modules` غير مشمول (يُثبَّت بـ`npm ci` داخل البناء).

## متطلبات المضيف

| المتطلب | لماذا |
|---|---|
| Docker Engine ≥ 24 و Compose v2 (`docker compose version`) | الحزمة تستخدم `name:`، `depends_on.condition`، `env_file`، `read_only` |
| **≥ 12 GB مساحة حرة** | `node:22-bookworm-slim` + `npm ci` + `.next` + `postgres:18-alpine` + Traefik + طبقات البناء |
| Linux مضيفًا (أو Docker Desktop بذاكرة ≥ 4 GB) | أسرع وأقرب لشكل الخادم؛ لا حاجة لـWindows |
| sudo | `/etc/nexup-command/{app,db}.env` مسارات مطلقة في `compose.yml` |
| المنفذان 80 و443 حرّان | اختبار المرور عبر Traefik وHTTPS |
| خروج للإنترنت | سحب الصور |
| **مضيف مخصّص أو VM مؤقت** | لا DNS يشير إليه، ولا شبكة مشتركة مع VPS |

**قاعدة صارمة:** هذا المضيف ليس VPS المشترك. لا يلمس Hermes ولا NEXPUBLISH ولا أي حاوية قائمة،
والاسم المستخدم هو `trial.local.test` عبر `/etc/hosts` فقط — لا سجل DNS عام.

## الخطوات

```bash
# 1) التحقق من الأرشيف قبل فكّه
sha256sum nexup-trial-afdca18.tar.gz     # يجب أن يطابق 7f8fea7d0eeb4c59…5842db
tar xzf nexup-trial-afdca18.tar.gz && cd nexup-trial

# 2) الأسرار: الأسماء نفسها الموجودة في deploy/.env.example، والقيم تُولَّد هنا وحدها
sudo install -d -m 700 /etc/nexup-command
sudo tee /etc/nexup-command/db.env >/dev/null <<EOF
POSTGRES_USER=nexup
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=nexup_trial
EOF
sudo tee /etc/nexup-command/app.env >/dev/null <<EOF
DATABASE_URL=postgresql://nexup:$(grep '^POSTGRES_PASSWORD=' /etc/nexup-command/db.env | cut -d= -f2-)@db:5432/nexup_trial
DATABASE_SSL_DISABLE=1
AUTH_SECRET=$(openssl rand -hex 32)
NODE_ENV=production
EOF
sudo chmod 600 /etc/nexup-command/*.env
# DATABASE_SSL_DISABLE=1 إلزامي: postgres:18-alpine هنا بلا TLS داخلي، وPrisma يجرّب SSL
# افتراضيًا فيفشل الاتصال بدونه. راجع الأسماء مقابل deploy/.env.example قبل المتابعة.

# 3) شبكة الوكيل (يلعب دور شبكة Traefik على الخادم الحقيقي)
docker network create nexup-edge

# compose يستخدم ${COMMAND_IMAGE:?} و${EDGE_NETWORK:?}، فيجب تمريرهما في كل استدعاء —
# حتى `up -d db` وحده، و`down`، لأن compose يفسّر الملف كله قبل التنفيذ.
export COMMAND_IMAGE=nexup-command:trial EDGE_NETWORK=nexup-edge TRIAL_READ_ONLY=1

# 4) البناء بالقفل — الـbuild arg إلزامي لعائلات EXEC/AI على الحافة
docker build -f deploy/Dockerfile --build-arg TRIAL_READ_ONLY=1 -t nexup-command:trial .

# 5) المخطط: سلسلة الهجرات لا تبني قاعدة فارغة (عائق معروف)، فالتجربة تُبنى بـdb push
docker compose -f deploy/compose.yml up -d db
docker compose -f deploy/compose.yml ps          # db → healthy قبل المتابعة
docker run --rm --network nexup-command-internal \
  --env-file /etc/nexup-command/app.env nexup-command:trial \
  npx prisma db push --schema=prisma/schema.prisma --accept-data-loss

# 6) أول مستخدم — كلمة المرور تُطبع مرة واحدة؛ خزّنها فورًا
#    ملاحظة إلزامية: --slug nexup، لأن readScopeSlugs مثبَّت على nexup/rebound/abomazen،
#    وأي slug آخر يُرجع 0 عميلًا و0 مشروعًا رغم وجود الصفوف.
docker run --rm --network nexup-command-internal \
  --env-file /etc/nexup-command/app.env nexup-command:trial \
  node scripts/create-first-user.mjs --email owner@trial.local --name Owner \
  --business "NEXUP COMMAND" --slug nexup

# 7) التشغيل (المتغيرات مُصدَّرة أعلاه)
docker compose -f deploy/compose.yml up -d
docker compose -f deploy/compose.yml ps        # app + db كلاهما healthy
docker exec nexup-command-app-1 printenv TRIAL_READ_ONLY   # → 1 (وقت الطلب)
# ملاحظة: الـbuild arg لا يظهر كمتغير بيئة في الصورة — يُستهلك وقت البناء داخل حزمة الحافة،
# وإثباته سلوكي (رفض عائلات EXEC/AI في الأدخنة)، لا بـprintenv.
```

### Traefik وHTTPS

`deploy/traefik/command.yml` مكتوب لمزوّد الملفات في الوكيل، ويستخدم `certResolver: le` الذي يحتاج
دومينًا عامًا. للاختبار المحلي يُستخدم شهادة Traefik الافتراضية (self-signed) بحذف سطر المُحلِّل فقط،
وبلا أي تعديل على الملف المشحون:

```bash
mkdir -p /tmp/traefik/dynamic
cp deploy/traefik/command.yml /tmp/traefik/dynamic/command.yml
sed -i '/certResolver:/d' /tmp/traefik/dynamic/command.yml      # tls: يصبح الافتراضي (self-signed)
# استبدل اسم المضيف بقيمة الاختبار بدل متغيّر الوكيل
sed -i 's|Host(`${COMMAND_HOSTNAME}`)|Host(`trial.local.test`)|g' /tmp/traefik/dynamic/command.yml

docker run -d --name trial-traefik --network nexup-edge \
  -p 80:80 -p 443:443 \
  -v /tmp/traefik/dynamic:/etc/traefik/dynamic:ro \
  traefik:v3 \
  --entrypoints.web.address=:80 \
  --entrypoints.websecure.address=:443 \
  --providers.file.directory=/etc/traefik/dynamic \
  --providers.file.watch=true

echo "127.0.0.1 trial.local.test" | sudo tee -a /etc/hosts

curl -sk -o /dev/null -w 'https /login → %{http_code}\n' https://trial.local.test/login     # 200
curl -s  -o /dev/null -w 'http  /login → %{http_code}\n' http://trial.local.test/login      # 308
curl -skI https://trial.local.test/login | grep -iE 'strict-transport|nosniff|x-frame'       # رؤوس الأمان
```

### الأدخنة: الدخول، القراءة، ورفض الكتابة/التنفيذ

```bash
# شهادة self-signed: تعطيل التحقق لهذه الجولة المحلية فقط — لا يصلح لأي بيئة حقيقية
NODE_TLS_REJECT_UNAUTHORIZED=0 \
BASE_URL=https://trial.local.test TRIAL_EMAIL=owner@trial.local \
TRIAL_PASSWORD='<كلمة المرور المطبوعة في الخطوة 6>' BUSINESS_ID=<business id> \
node deploy/scripts/smoke.mjs
```

المتوقَّع: **17/17** بلا `--allow-writes` — دخول، `/api/auth/me`، قراءة العملاء والمشاريع، ثم
`403 This trial is read-only.` للكتابة و`403 external execution disabled` لـ`/api/exec/turn`
و`/api/ai-workforce/*`. ولإثبات أن الرفض من القفل لا من مسار معطوب: أعد التشغيل بـ`--allow-writes`
على صورة مبنية بلا الـbuild arg، فيجب أن تنجح الكتابة.

### إثبات العزل

```bash
docker inspect nexup-command-db-1  --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
#   → nexup-command-internal   (وحدها)
docker inspect nexup-command-app-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
#   → nexup-command-internal nexup-edge

# من شبكة الوكيل فقط: يجب أن يفشل الاتصال بقاعدة البيانات
docker run --rm --network nexup-edge busybox sh -c 'nc -zv nexup-command-db-1 5432; echo "rc=$?"'
#   → bad address / rc=1
```

### التنظيف

```bash
docker compose -f deploy/compose.yml down -v      # يحتاج COMMAND_IMAGE/EDGE_NETWORK كما أعلاه
docker rm -f trial-traefik; docker network rm nexup-edge
sudo rm -rf /etc/nexup-command /tmp/traefik
sudo sed -i '/trial.local.test/d' /etc/hosts
```

## ما يجب أن يعود كأدلة

1. `docker version` و`docker compose version`.
2. مخرجات البناء كاملة مع `docker build … --build-arg TRIAL_READ_ONLY=1` ورمز الخروج.
3. `compose ps` و`docker inspect --format '{{.State.Health.Status}}'` للحاويتين.
4. مخرجات الخطوة 6 (المعرّفات والعدّادات — **بلا كلمة المرور**).
5. خرج `smoke.mjs` كاملًا (17/17) مع رمز الخروج، ونتيجة جولة `--allow-writes` على صورة غير مقفلة.
6. مخرجات `docker inspect` للشبكتين ونتيجة `nc` من شبكة الوكيل.
7. مخرجات `curl` الثلاثة لـTraefik (200 / 308 / الرؤوس).
8. `docker compose logs --no-color > run.log 2>&1`.

## ما لا يغطيه هذا الاختبار

- شهادة حقيقية عبر ACME/DNS، وسلوك الكوكي `secure` على دومين عام.
- متصفح الهاتف فعليًا (لوحة مفاتيح، تحميل، جلسة).
- التعايش مع Traefik/Hermes/NEXPUBLISH القائمين — مقصود: هذا الاختبار معزول تمامًا.
- الأداء تحت حمل، والنسخ/الاستعادة على نفس الحاويات (سبق اختبارها محليًا على قاعدة حقيقية).
