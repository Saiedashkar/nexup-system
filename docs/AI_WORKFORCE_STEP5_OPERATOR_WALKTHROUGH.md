# Step 5/8 — Operator walkthrough handoff

**What this is.** Step 5 (the mission lifecycle) is complete and operated
through the real application. This document lets the owner run NEXUP locally, in
a browser, and personally exercise and inspect:

```
Command → Mission → Task → Agent/runtime → Execution → Result
        → Human Review → Completed Mission
```

on the **isolated local development database**, using the **real** auth, routes
and persistence — with **no paid AI credits** and **no contact with production**.

**Scope, unchanged.** Step 6 is **not** started; the Command Center UI is **not**
wired to real data. No production migration was applied, no production lifecycle
was activated, and no production object was created.

---

## 1. The environment is one command, and it is reproducible

```bash
node scripts/demo-env.mjs
```

That command, and nothing else, gives you a clean environment:

1. starts the isolated cluster on `127.0.0.1:5501` (loopback, trust auth);
2. **rebuilds `nexup_dev` from `prisma/schema.prisma`** (37 tables, 9 `ai_*`) —
   no migration is registered in `prisma/migrations`, nothing is applied to
   production;
3. seeds one **local, throwaway** `SUPER_ADMIN` login through the app's real
   bcrypt path (no bypass);
4. writes `.demo/env` and `.demo/credentials.txt` — both **git-ignored**, holding
   a generated `AUTH_SECRET` and the demo password.

Re-running it is always safe and always yields a **clean** environment
(`nexup_dev` is dropped and rebuilt), so you never have to clean up by hand.

Nothing here reads `DATABASE_URL` to decide where to connect: every command gets
its own explicit `127.0.0.1` URL.

---

## 2. Shortest safe startup procedure

**One command.** It reuses an existing healthy environment, repairs a missing or
half-built one, starts (or recovers) the database, reclaims the app port from any
previous NEXUP process, starts the app, and waits until `/login` actually answers
before printing anything:

```bash
node scripts/demo-start.mjs          # start (or reuse) everything
node scripts/demo-start.mjs --stop   # stop the app again
```

It prints only the URL, the demo email, and where the password lives.

> **Why the URL host matters.** `127.0.0.1` and `localhost` are *different
> origins* to Next.js. Its development client (HMR socket, `/__nextjs_*`
> endpoints) is guarded against unlisted origins, and only `localhost` is trusted
> by default — so from `127.0.0.1` the dev resources were answered with `403`,
> React never hydrated, and the login form silently fell back to a **native GET**
> that reloaded `/login` with the email and password in the query string. Fixed
> in three places: `allowedDevOrigins: ["127.0.0.1", "localhost"]` in
> `next.config.ts`, a middleware matcher that no longer auth-gates `/_next` and
> `/__nextjs_*`, and `method="post"` on the form so a hydration failure can never
> put a credential in a URL. Login now goes through the real `POST /api/auth/login`
> in every case.

| | |
|---|---|
| **URL to open** | `http://127.0.0.1:3300/login` |
| **Login** | email `superadmin@nexup` · password in `.demo/credentials.txt` (generated, throwaway) |
| **Auth flow** | the real one — `POST /api/auth/login` → signed `nexup_session` cookie; the middleware protects every route |
| **Readiness check** | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3300/api/ai-workforce/missions` → **`401`** means the app and the route are up (unauthenticated is the healthy answer) |
| **Stop** | `node scripts/demo-start.mjs --stop` (the database is left running) |

`demo-run.sh` exports, over the app's own `.env`:

- `DATABASE_URL` → the isolated cluster (so even the legacy client cannot reach
  Supabase);
- `AI_WORKFORCE_PERSISTENCE=database`, `AI_WORKFORCE_DATABASE_URL` → the same
  cluster, `AI_WORKFORCE_DATABASE_TARGET=local`;
- `AI_WORKFORCE_TEST_TRANSPORT=deterministic` → the deterministic runtime. The
  application honours this **only** against a verified loopback database, so it
  can never be enabled against a real host;
- `AUTH_SECRET` → the generated demo secret.

**No auth bypass exists or is created, and no real credential is stored in the
repository.**

---

## 3. The safe deterministic demo (no credits, no production)

```bash
node scripts/demo-lifecycle.mjs          # the whole lifecycle, one run
node scripts/demo-lifecycle.mjs --retry  # …plus an idempotent retry
```

The driver uses only ordinary HTTP against the running app: it logs in, reads
readiness, issues a Command, continues the Mission, reads the Decision Queue,
records a human decision, and prints the final Mission — every step is a request
a browser or the future Command Center would make.

The runtime is the **deterministic TEST transport** (`aiProvider: NONE`), so the
demo **spends no paid provider turn** and makes **no external call**.

---

## 4. The UI cannot show this lifecycle yet — and that is Step 6

**Stated plainly:** there is **no screen that renders the mission lifecycle**
(Command → Mission → Task → Execution → Review → Completed). Building that is
**Step 6**, and it is deliberately not started. No throwaway "fake UI" has been
added for this demo.

What the browser *does* show today:

| Surface | What it is | Real or mock |
|---|---|---|
| `/login` | the real login form | **real** |
| **`/command`** | **the NEXUP COMMAND — Executive Command Center.** The authoritative owner UI: the command bar, the organization graph, People & Actors, Connected Systems, Recent Activity, Active Missions and the Decision Queue. | **UI only** — it reads its own demo model (`src/components/command/state/demo-scenarios.ts`); it makes **no** API call and is **not** wired to the lifecycle. That wiring is Step 6. |
| `/office`, `/office/nexup`, ... | the existing business app | real (its own data) |
| `/office/ai-workforce` | the **Phase-1B control-core** page: registered tools, persistent jobs, recent runs, pending approvals, and the isolation banner. **Legacy/internal — not the Command Center.** | **real reads** of the control core; it is **not** the mission lifecycle |

> **Two pages, one confusingly similar name.** `NEXUP COMMAND` is the title of
> **`/command`** (the current Command Center). The older Phase-1B page at
> `/office/ai-workforce` is *also* labelled "NEXUP COMMAND" in the Phase-1B/Phase-0
docs, which is why an operator reading those docs can land on the wrong screen.
> **`/command` is the one the owner uses.**

**The cleanest existing way to inspect and operate the lifecycle right now** is
the real HTTP API plus the durable read tool — not a mock screen:

- `node scripts/demo-lifecycle.mjs` — operate it end to end;
- open the JSON directly in the browser once logged in (the cookie is sent
  automatically):
  `http://127.0.0.1:3300/api/ai-workforce/missions` (active missions + decision
  queue), `http://127.0.0.1:3300/api/ai-workforce/missions/<id>` (one mission),
  `http://127.0.0.1:3300/api/ai-workforce/decisions` (the human queue);
- `node scripts/read-durable-mission.cjs "postgresql://postgres@127.0.0.1:5501/nexup_dev" <missionId>`
  — read the whole chain from the **database**, in a process that shares nothing
  with the app.

**What becomes visual in Step 6:** the Command Center screens that draw exactly
these four API reads — Active Missions, Mission detail (tasks · executions ·
reviews), the Execution/timeline view, and the Decision Queue with the approve /
reject / needs-revision actions. The data and the operations already exist; Step
6 is the rendering.

---

## 5. Owner walkthrough

### A. What URL I open
`http://127.0.0.1:3300/login`

### B. What I should see
The NEXUP login page. After signing in, open the authoritative owner UI:
`http://127.0.0.1:3300/command` — **NEXUP COMMAND / Executive Command Center**
(command bar, organization graph D1–D5, People & Actors, Connected Systems,
Recent Activity, Active Missions, Decision Queue, EXEC).

The older Phase-1B page `http://127.0.0.1:3300/office/ai-workforce` still exists
for legacy/internal use — it shows the runtime, where persistence lives, the
registered tools, the pending approvals and the isolation banner. It is *not* the
Command Center.

### C. What is real vs still mocked
- **Real:** authentication and session, the durable database, the mission
  lifecycle API, the deterministic runtime, the human-decision boundary, the
  stop/reset tooling.
- **UI only (mock model):** everything on `/command` — its KPIs, Active Missions,
  Decision Queue, departments, actors and EXEC read the demo model and make no
  API call. Nothing on screen renders the real Command → Mission → Task →
  Execution → Review lifecycle yet; that wiring is Step 6. The
  `/office/ai-workforce` page is the earlier control core, not that lifecycle.

### D. How I issue a safe test Command
```bash
node scripts/demo-lifecycle.mjs
```
(or `curl` `POST /api/ai-workforce/missions` with a JSON body carrying an
`idempotencyKey`, `title`, `goal` and `tasks`). It creates one Mission and
dispatches one Task.

### E. Where the Mission is created
The Command's response carries `mission.id`. List them at
`GET /api/ai-workforce/missions`; read one at `GET /api/ai-workforce/missions/<id>`.

### F. How the Task / Agent / Execution progresses
The Task is routed to a **registered actor** with a **capability** and a
**runtime binding**, which starts the execution. The mission read shows the
execution record's `handleId` and `status`. `POST /api/ai-workforce/missions/<id>`
("continue"/drain) settles what is in flight and advances the mission from the
database — starting at most one task.

### G. How I see the Result
`executions[0].output` in the mission read (the deterministic run returns
`{"summary":"deterministic market summary"}`), and the durable form via
`read-durable-mission.cjs`. A successful execution parks the task in **REVIEW** —
it is not auto-completed.

### H. How Human Review works
`GET /api/ai-workforce/decisions` lists everything waiting for a person. Record
one decision with `POST /api/ai-workforce/decisions`
(`{ reviewId, decision: "APPROVED" | "REJECTED" | "NEEDS_REVISION" }`). Review is
the **human authority boundary**: an agent cannot approve its own work, and a
second decision on the same review is refused.

### I. What survives restart
The Mission, Task, Execution record, review and the idempotency ledger are all
**durable rows**. Demonstrate it:

```bash
node scripts/demo-lifecycle.mjs --issue-only     # leaves work in flight, prints the mission id
node scripts/demo-start.mjs --stop               # restart the app
node scripts/demo-start.mjs
node scripts/demo-lifecycle.mjs --finish <missionId>   # settles from the DATABASE, then you decide
```

After the restart the new process settles the attempt **from the durable record**
— it does **not** resubmit the job and cannot create a second run. Re-issuing the
same Command (same `idempotencyKey`) returns the **same** Mission with **no**
second execution (`--retry` shows this).

### J. How to stop / reset the local demo safely
| Goal | Command |
|---|---|
| Stop the app | `node scripts/demo-start.mjs --stop` |
| Reset to a clean demo (keeps the tooling) | `node scripts/demo-env.mjs` |
| Stop the database, keep its data | `node scripts/dev-db.mjs down` |
| Remove the demo database entirely | `node scripts/dev-db.mjs destroy` |

None of these touches any other PostgreSQL instance, and none touches
production. To start again later, run `node scripts/demo-start.mjs` — it rebuilds
what is missing and reuses what is not.

---

## 6. If the local database ever wedges (Windows)

On Windows a PostgreSQL backend can occasionally die with a DLL-initialisation
failure (`0xC0000142`) and leave the cluster listening but refusing connections.
The dev harness now **detects that** (it clears a postmaster that is alive but no
longer answering). If it ever stays stuck, force a fresh cluster:

```bash
node scripts/dev-db.mjs restart     # kills this cluster's postmaster and starts a fresh one
node scripts/demo-env.mjs           # rebuild a clean demo database
```

Only this cluster's own `postmaster.pid` is used to find the process, so no
other PostgreSQL instance is affected.

---

## 7. Safety summary

- **Production mutations: NONE.** A read-only migration-history check could not
  even resolve the production host from this machine; nothing was applied.
- **No auth bypass, no committed credential.** The demo secret and password live
  only in the git-ignored `.demo/`.
- **The runtime is deterministic and local**, so no paid turn is spent.
- `master` / `origin/master` remain untouched at `bf701fac`.

---

## OWNER — OPEN NEXUP NOW

Run this **one** command in a terminal at `nexup-business-system/`:

```bash
node scripts/demo-start.mjs
```

It builds the demo environment if it is missing, starts the database and the
app, and prints the URL, the email, and where the password is. (Re-running it is
always safe: it reclaims the port and reuses a healthy environment.)

Then, in the browser:

1. Open **http://127.0.0.1:3300/login**
2. Log in with **`superadmin@nexup`** — the password is on the line
   `password ...` in **`.demo/credentials.txt`**
3. Open **http://127.0.0.1:3300/command** — the NEXUP COMMAND / Executive Command
   Center (the authoritative owner UI; its figures are the demo model until Step 6)
4. In a second terminal, run the lifecycle and watch it complete:

```bash
node scripts/demo-lifecycle.mjs --retry
```

5. Inspect it yourself in the browser (you are logged in, so the cookie is sent
   automatically):
   - **http://127.0.0.1:3300/api/ai-workforce/missions** — active missions + the decision queue
   - **http://127.0.0.1:3300/api/ai-workforce/missions/<missionId>** — one mission in full
   - **http://127.0.0.1:3300/api/ai-workforce/decisions** — what is waiting for a human

To try the restart yourself:

```bash
node scripts/demo-lifecycle.mjs --issue-only
node scripts/demo-start.mjs --stop && node scripts/demo-start.mjs
node scripts/demo-lifecycle.mjs --finish <missionId>
```

To stop: `node scripts/demo-start.mjs --stop`. To reset clean: `node scripts/demo-env.mjs`.
