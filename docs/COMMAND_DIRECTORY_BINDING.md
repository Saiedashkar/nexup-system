# The first real binding — `/command/clients` and `/command/projects`

**Branch:** `feature/data-binding-clients-projects-20261107` · **Base:** `c2c8699` · **Round:** one,
`2026-11-08` · **Scope:** the two surfaces now read the demo database through the routes the
application already serves. No design change, no migration, no dependency, no write path, no push.

This document is the hand-off record: what each surface shows, where every value comes from, who is
allowed to read it, what was measured, and what is still open.

---

## 1. What was built

| Path | What it is |
|---|---|
| `src/components/command/state/directory/types.ts` | Wire DTOs for the three reads — `ClientDto`, `ProjectDto`, `SessionDto` |
| `.../directory/api.ts` | `readClients` / `readProjects` / `readSession` — three same-origin GETs, `cache: "no-store"`, failures typed as `unauthorized · forbidden · server · network · shape` |
| `.../directory/mapping.ts` | Pure DTO → view mapping, totals, and the rule that nothing is invented |
| `.../directory/reducer.ts` | Read state: three sources, generations, 401 clearing |
| `.../directory/directory-store.tsx` | `DirectoryProvider` / `useDirectory` — `AbortController` per source, generation bump per load |
| `src/components/command/lab/directory.tsx` | Session-ended state, the scope line, the per-source panel with its own retry |
| `src/app/command/clients/page.tsx`, `.../projects/page.tsx` | The two bound surfaces |
| `tests/command-directory-binding.test.ts` | 13 assertions over the mapping and the read state |

The binding is a **separate module with its own types**. `demoCommandAdapter` and the typed demo
dataset are not imported anywhere on these two pages, so there is no code path that can quietly fall
back to sample rows.

---

## 2. Where the data comes from

| Source | Path | What it returns | Scoping |
|---|---|---|---|
| Session | `GET /api/auth/me` | `user{userId,name,role,businessId,business{id,name,slug}}` | the cookie's session only |
| Clients | `GET /api/clients` | clients **with** their `projectRecords` (id, name, price, deposit, both statuses, date) and the computed `projectCount / totalPaid / totalRemaining / isRepeatClient / computedTier` | `businessId ∈ resolveReadScope(session)` |
| Projects | `GET /api/projects` | project records with `client`, `designer`, `services`, plus per-client `projectCount / totalPaid / isRepeatClient` | **the same** `resolveReadScope(session)` set |

Both reads resolve their companies through one helper (`src/lib/read-scope.ts` +
`read-scope-db.ts`), and `/api/auth/me` publishes that same resolved set as `scope`, so a
surface can print the scope its rows actually came from. (Round 1 scoped clients by the
permission flags and projects by `session.businessId`; a session could then read a company's
clients and not its projects. See section 9.)

Both reads are `same-origin`, `no-store`, and carry no parameters — the pages never ask for a company
the session does not carry.

---

## 3. Field map — what is shown, and from which column

### 3.1 Client row (`/command/clients`)

| On screen | Column / source | Notes |
|---|---|---|
| name | `Client.name` | as stored |
| phone | `Client.phone` | as stored, never reformatted |
| tier pill | computed `tier` in the `/api/clients` response | see gap **G1**: the route recomputes it from deposits and repeat count, shadowing `Client.tier` |
| "N مشروعاً" | `projectCount` (route) or `projectRecords.length` | same arithmetic either way |
| agreed total | Σ `ProjectRecord.totalPrice` over the embedded projects | arithmetic on stored amounts |
| collected | `totalPaid` (route) or Σ `deposit` | arithmetic on stored amounts |
| remaining | `totalRemaining` (route) or Σ (`totalPrice − deposit`) | clamped at zero for display |
| collected share (meter) | `paid ÷ total`, 0–100 | **the only progress-like number**, and it is arithmetic over two stored amounts |
| "عميل متكرر" | `isRepeatClient` or `projectCount > 1` | stored relation, not a guess |
| project list rows | embedded `projectRecords`: name, `workStatus`, `totalPrice − deposit` | link → `/command/projects#<projectId>` |
| "لا مشروع مفتوح لهذا العميل بعد." | rendered only when the client has no projects | |

### 3.2 Project card (`/command/projects`)

| On screen | Column / source | Notes |
|---|---|---|
| title | `ProjectRecord.projectName` | |
| work pill | `workStatus` → `WAITING · IN_PROGRESS · COMPLETED · PAUSED` | unknown value → `—` |
| client link | `client.name` → `/command/clients#<clientId>` | absent client → `—` |
| opened | `date` (first 10 chars) | |
| designer | `designer.name` → falls back to `designerName` | printed **only** when the record carries one |
| meter | `deposit ÷ totalPrice` | |
| "X من Y" | `deposit` and `totalPrice` | |
| services | `services[].name`, else `customServiceText` | both are stored fields; nothing is composed |
| "لا خدمة مسجّلة على هذا المشروع." | rendered when both are empty | |
| notes | `notes` | only when non-empty |
| remaining | `remaining` | clamped at display |
| payment pill | `paymentStatus` → `FULL · PARTIAL · UNPAID` | unknown value → `—` |
| header figures | count, per-status counts, Σ positive `remaining` | all derived from the rows above |

### 3.3 Fields the demo surfaces had that are **gone**

`owner` · `industry` · `client since` · `health score` · `progress %` · `open items` · `mission ids` ·
`agent avatars / assignees` · `department` · `next milestone`.

None of them exist as a column, so the mapped views have no such property at all — a surface cannot
render them. `tests/command-directory-binding.test.ts` asserts their absence on the client view, and
`grep` for them in the two pages returns nothing.

---

## 4. Permissions and company scope

Read before use, then repaired where isolation was broken **without widening any permission**:

| Change | Why |
|---|---|
| `GET /api/clients` — nested `projectRecords: { where: { deletedAt: null } }` | the soft-delete extension only wraps the **top-level** operation, so a deleted project reappeared inside its client's list and skewed its totals |
| `DELETE /api/clients` (orphan cleanup) — scoped to `getAccessibleBusinesses(session)` | a bulk delete could reach across companies; it now cannot |
| `PATCH` / `DELETE /api/projects/[id]` — `businessId` check against the session | a caller could address another company's record by id |
| `GET /api/auth/me` — returns `business {id,name,slug}` | the scope line needs the session's real company; no new data beyond the session's own business |

Observed behaviour: reads resolve through the SAME helper for clients and projects — a
session reads every company its flags grant, a super admin reads all of them, and a session
with no flags reads nothing from either route. Writes are a separate decision (section 9):
they need permission and a company named explicitly, never a read scope.

The bound pages print `Scope: <session company>` and state in one sentence that the header's company
control is a prototype label which does **not** filter these reads. The control itself is untouched on
the shell; the demo badge is hidden on these two surfaces (`hideDemoState`) so nothing on them reads as
sample data.

---

## 5. Read states

* **Loading** — per source; the page waits for its own source.
* **Empty** — `data.length === 0` is `empty`, with a sentence that says the read succeeded and there
  are no rows; it is never rendered as an error.
* **Error** — per source, with the kind's own wording (`network` ≠ `server` ≠ `shape`) and a retry
  that re-runs that source only.
* **Independence** — one source failing leaves the other's rows on screen, with a banner naming the
  failed one and a retry for it.
* **Staleness** — every load carries a generation; a response whose generation is not current is
  discarded, so a read that resolved after a reload, a scope change or a 401 cannot land.
* **Session end (401)** — every row is cleared, the generation is bumped, in-flight reads are aborted,
  and the page shows "Your session ended" with a sign-in link instead of data.
* **No silent demo fallback** — there is no import of the demo dataset here, and no branch that could
  produce one.

---

## 6. Checks (all run on this branch, sequentially)

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | **exit 0** |
| Lint (touched files) | `node node_modules/eslint/bin/eslint.js …` | **exit 0**, 0 errors, 1 pre-existing warning (`request` unused in `GET /api/clients`) |
| Focused tests | `npx vitest run tests/command-directory-binding.test.ts` | **13/13 passed** |
| Manifest | `node scripts/verify-exec-integration-manifest.mjs` | **exit 0**, `problems: []`, 231 rows, new `directory` layer digested |

### 6.1 Runtime — routes (local isolated demo, `127.0.0.1:3211` / DB `127.0.0.1:5501`)

| Case | Result |
|---|---|
| anonymous `/api/clients`, `/api/projects` | `401`, `401` |
| login (real `POST /api/auth/login`) | `200`, session cookie issued |
| `/api/auth/me` as super admin | `200`, `role SUPER_ADMIN`, `businessId "all"`, `business null` |
| `/api/auth/me` as the verification employee | `200`, `role EMPLOYEE`, `business NEXUP` |
| employee, own business | `/api/projects` `200` ×4, `/api/clients` `200` ×3 |
| employee, **foreign** `businessId` | `/api/projects` `200` ×**0** (the filter is real), `/api/clients` ×3 (flag-scoped, by design) |
| employee, no company flags | `/api/clients` `200` ×0; `/api/projects` **`403`** from the middleware |
| tampered session cookie | `401` |
| `PATCH` unknown project as `EMPLOYEE` / as `SUPER_ADMIN` | `403` / `404` (isolation check answers before any write) |
| `/command`, `/command/clients`, `/command/projects` signed in | `200`, `200`, `200` |

### 6.2 Runtime — surfaces (browser, real session)

| Case | Result |
|---|---|
| Clients, Arabic, 1440 | 3 clients / 4 projects / outstanding `6,300` / collected `3,500`; each row's phone, tier, agreed, collected, remaining and its project list link to real ids; a client with no projects shows the "no open project" sentence |
| Projects, Arabic, 1440 | 4 cards, one per work status; designer `نورة` printed on exactly the record that stores it; services from the catalogue on one card, free text on another, "no service recorded" on the other two; payment pills `paid in full / part paid / unpaid` |
| English | same rows and figures, all labels translated, no missing key, no raw `directory.*` string |
| 390 × 844 | no document horizontal overflow (`scrollWidth 390`), figures in 2 columns, cards `351px`, no clipped card title/meta/figure |
| Navigation | `/command → Clients → Projects` via the product-area nav and via a client's project row (`/command/projects#verify-p1`, anchor found and scrolled into view); back to `/command` works |
| Empty | with the demo DB still empty (before the verification dataset) both routes answered `200 []` and the surface path resolves to `empty` — the reducer test asserts it |
| Session end, in page | after `POST /api/auth/logout`, "read again" → `401` → "Your session ended", **no rows**, no source panel, sign-in link back to the same page |
| Session end, navigation | reloading after logout → `307 /login?next=/command/projects` (middleware) |
| Demo badge | absent from both bound pages (`demo-state` not in the served HTML, not in the DOM) |

### 6.3 The dataset used for the row-level checks

The demo database shipped **empty** (1 business, 1 user, 0 clients, 0 projects). To exercise rows and
relationships it was seeded, through SQL only, with 3 clients / 4 projects / 2 services inside the
existing `nexup` business, plus one `EMPLOYEE` verification user — all in the throwaway loopback demo
DB, with `verify-` ids. **They were deleted at the end of the round**; the DB is back to its prior
state (`clients 0 · projects 0 · services 0 · users 1`). No application write path was called, and the
real `superadmin@nexup` row was not touched (its password was only used to sign in).

---

## 7. Gaps and limits

| id | Gap | Status |
|---|---|---|
| **G1** | ~~`GET /api/clients` recomputes `tier` and shadows the stored column~~ | **fixed** (section 9): the derived value is now `computedTier`; the stored `tier` travels untouched and is what the surface shows |
| **G2** | `GET /api/projects?sortBy=<unknown>` sets `orderBy[sortBy]` and Prisma rejects it → `500`. The binding sends no parameters, so these two pages cannot hit it. | documented, not changed |
| **G3** | ~~`POST /api/projects` uses `session.businessId`, i.e. `"all"` for a super admin~~ | **fixed** (section 9): a write resolves an explicit company and refuses `"all"` |
| **G4** | `GET /api/projects` runs two extra queries per project (count + aggregate) — N+1 on a large table. | measured, not optimised |
| **G5** | The projects page subtitle still reads "grouped work per client … when it last moved", while the list is flat and shows no last-activity column. The sentence lives in shared area copy (`lab/areas.ts`), used by the home page too, so it was left alone. | documented |
| **G6** | A browser-level **network failure / single-source failure** could not be produced in this toolchain (no request interception, and stopping the dev server would take every surface down). The rule is covered by `tests/command-directory-binding.test.ts` (`one source fails without touching the other`, stale generation dropped). | not exercised in the browser |
| **G7** | At 390 px the scope-line container `.nl-head__meta` measures narrower than its content (`clientWidth 18`, `scrollWidth 111`) — measurable, but the document does not overflow and no text is clipped. | noted, not restyled |

---

## 8. Reproducing it

```bash
# app + isolated demo DB (loopback only)
node scripts/demo-start.mjs            # → http://127.0.0.1:3211

# checks
npx tsc --noEmit
npx vitest run tests/command-directory-binding.test.ts
node node_modules/eslint/bin/eslint.js src/components/command/state/directory src/app/command/clients/page.tsx src/app/command/projects/page.tsx
node scripts/verify-exec-integration-manifest.mjs

# signed-out readiness (401 is the healthy answer)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3211/api/clients
```

---

## 9. Round 2 — the five corrections (from `8dde2c4`)

Round 1 left five defects in the binding. They are fixed here on the same branch: same design, same
files, no migration, no dependency, and no step taken towards the deal hand-off.

### 9.1 One request identity per source, and its own cancellation

`load()` used to bump ONE generation for every source, so "read the clients again" invalidated the
projects and session requests that were still in flight. Each source now owns:

* its own `AbortController` (a retry aborts only its own request);
* its own `stamp` in `state.stamps` — the reducer applies an outcome only when
  `stamp === stamps[target]` and `epoch === state.epoch`.

A change of **session identity or scope** still voids everything: `scopeKey()` (user + role +
resolved companies) is compared on every session settle, and a change bumps the epoch, aborts every
request, bumps every stamp, dispatches `invalidate` and starts the company reads again under the new
epoch. The projection that models this is `directoryReducer`, tested without a browser.

### 9.2 A superseded answer decides nothing — including a 401

The settle/fail path re-checks the request's stamp and epoch before it is allowed to dispatch, and the
provider checks the same refs before it does anything with a side effect. So:

* an answer (or an error) from a request that a retry replaced is dropped silently;
* a **stale 401** is dropped like any other stale answer — it can no longer sign a healthy page out;
* a 401 from the **current** request still clears every row, voids the in-flight reads and raises the
  session-ended state, exactly as round 1 required.

### 9.3 One scope, actually and as declared

Round 1 resolved the two reads differently (clients by the permission flags, projects by
`session.businessId`), so a session could read a company's clients and not its projects. Now:

| | rule |
|---|---|
| read | `readScopeSlugs()` → `resolveReadScope()` — every company the session's flags grant; all companies for a super admin; nothing for a session with no flags. **Both routes call it**, and `/api/auth/me` publishes the resolved set as `scope`, so the printed scope is the one the rows came from |
| write | `resolveWriteScope()` — an employee may not write; a scoped session writes only its own company; a session that spans companies must name one, and the literal `"all"` is refused |

Consequences that were deliberate, not incidental:

* **The client cleanup stopped inheriting the read scope.** `DELETE /api/clients` now requires an
  admin role AND a named company (`?businessId=` for a session that spans companies; its own for a
  scoped one) that must also exist as a row. A read scope no longer authorises a delete.
* **`POST /api/projects` no longer writes `businessId: "all"`.** A super admin has to name the
  company; a scoped admin names its own; a foreign company is `403`.
* **The middleware no longer gates `/api/projects`.** It was the last place answering a different
  question than the route (a company-flag portal in front of a shared, session-scoped read). Every
  company keeps its own typed routes (`/api/nexup`, `/api/rebound`, `/api/abomazen`) behind their
gates, and the project rows this endpoint returns were already readable through `/api/clients` for
  exactly the same companies — so the change aligns the two reads instead of widening what a session
  can see. Legacy consumers were reviewed first: `/clients`, `/office/nexup/clients`,
  `/office/{rebound,abomazen}/clients` and the office project pages keep their own routes and their
  own suggestions.

### 9.4 No row before the session and its scope are proven

`rowsVisible(state)` is true only when `/api/auth/me` answered `ready` and the page is not signed out.
The store exposes **no rows** while it is false, and both surfaces now render, in order: session-ended
→ "proving the session and its scope" → a session failure with its own retry → then the source's own
loading/empty/error. Company data that arrived first is therefore held and never displayed, and a
failed session proof shows an error instead of rows.

### 9.5 The stored tier is the tier

`GET /api/clients` derives a classification from deposits and repeat count. It used to be returned as
`tier`, shadowing `Client.tier`. The stored column now travels untouched and the derived value has its
own name — `computedTier` — so no consumer can mistake one for the other. The clients surface shows the
stored `tier` (the pill and the tier chips); `computedTier` is not rendered.

### 9.6 Checks run for this round

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| eslint on every touched file | **exit 0**, no errors, no warnings |
| `npx vitest run tests/command-directory-binding.test.ts tests/directory-read-scope.test.ts` | **32/32 passed** (ordering: retry-while-others-loading, stale 401 after a newer success, data arriving before the session, invalidation on scope change, stored-vs-derived tier, read/write scope for two companies) |
| `node scripts/verify-exec-integration-manifest.mjs` | **exit 0**, `problems: []` |
| `/command`, `/command/clients`, `/command/projects`, `/api/auth/me` as a session | `200`, `200`, `200`, `200` |

#### Two companies, live routes, isolated demo cluster

Two companies (the demo cluster seeds only `nexup`; a second company row was created **for the check
and deleted after it**), one client + one project in each, and six sessions minted from the
development secret so no user row was touched:

| session | `/api/clients` | `/api/projects` | declared scope |
|---|---|---|---|
| admin of A | 200, A only | 200, A only | `companies:[nexup]` |
| admin of B | 200, B only | 200, B only | `companies:[abomazen]` |
| admin of A+B | 200, A+B | 200, A+B | `companies:[abomazen,nexup]` |
| super admin | 200, A+B | 200, A+B | `all` |
| employee of A | 200, A only | 200, A only | `companies:[nexup]` |
| no flags | 200, `[]` | 200, `[]` | `companies:[]` |

And the write boundary, all `PASS`: employee cleanup `403`; super-admin cleanup without a company
`400`; unknown company `404`; scoped cleanup `deleted: 0` while the other company's rows stayed;
super-admin `POST /api/projects` without a company `400`; a write naming another company `403`; a cross-
company `PATCH` `403`; and the row counts identical before and after every refused write. The cluster
was then restored to its exact baseline (`nexup 0/0`, business count back to 1).

### 9.7 Gaps after round 2

| id | Gap | Status |
|---|---|---|
| **G1**, **G3** | derived tier shadowing `Client.tier`; `"all"` written as a business | **fixed** (9.5, 9.3) |
| **G8** | `/api/projects` is no longer behind the nexup business prefix, so a session whose flags grant no company now reads `[]` instead of `403` (no data either way) | deliberate (9.3), documented |
| **G9** | A super-admin `POST /api/projects` now needs an explicit `businessId` (`400` otherwise). Any caller that relied on the old `"all"` behaviour must send one | deliberate (9.3) |
| **G6** | Ordering and single-source failure are proven in the reducer tests, not by intercepting requests in a browser | unchanged |
| **G2**, **G4**, **G5**, **G7** | sort key `500`; N+1 on the projects list; stale projects subtitle; the narrow `.nl-head__meta` box | unchanged |

---

## 10. Round 3 — the gates, restored as gates (from `1f2abe3`)

Round 2 removed the middleware gate in front of `/api/projects` and unified the read scope. Four things
were still wrong: the workspace had lost a permission gate, a write trusted its target id, a project
could attach (or rename) a client of another company, and an employee could delete a client through a
route the review had not looked at.

### 10.1 The projects workspace is a capability again — not a company

`middleware.ts` now carries `featureRoutes`: `/api/projects`, `/command/clients` and
`/command/projects` require `canUseDirectoryFeature(session)` — *any* company allowance, or a super
admin — and answer `403` (API) or redirect to `/office` (page) otherwise. Each project handler re-checks
the same rule, so calling the route directly is refused identically.

This restores the question the old gate answered ("may this session use the projects workspace?") as a
capability, which is exactly what the old entry in `businessRoutes.nexup` was doing by accident. It does
not widen what any session can see: rows still come from `resolveReadScope`, so a manager of another
company opens the workspace and reads its own company only. A manager with no flags at all is refused
again instead of receiving `[]` (round 2's G8 is closed).

### 10.2 A write proves four things, and an id is not one of them

`resolveWriteTarget(session, namedId)` (`lib/read-scope-db.ts`) composes the answer in one place:

| Proof | Rule |
|---|---|
| role | `EMPLOYEE` is refused outright |
| operation permission | the workspace capability above (plus the admin role where deletion is involved) |
| company access flag | `companyWriteDenial()`: the target's own slug flag must be **on** |
| target company | the session's own company, or a company a super admin names; never the literal `"all"` |

So a session that *carries* a `businessId` but has no flag for that company is refused (`403`), and a
super admin must still name a real company (`400`/`404`). This is applied to `POST /api/projects`,
`PATCH`/`DELETE /api/projects/[id]`, `DELETE /api/clients/[id]` and the `DELETE /api/clients` cleanup.

### 10.3 A named client must belong to the company being written to

`POST /api/projects` used to accept any `clientId` and then rename it. Now the client is loaded first:
missing → `404`, another company → `403`, both **before** any write. The create path (client
create/revive/rename, project, deposit movement, recomputed tier) runs in one `prisma.$transaction`,
and so does the money side of `PATCH` (treasury movement + client payment + project row + tier). A
failing insert therefore leaves no half-written client and no orphan project — proven by a test that
forces a foreign-key failure after the rename would have happened.

### 10.4 Deleting a client is an admin operation — on every path

| path | before | now |
|---|---|---|
| `DELETE /api/clients/[id]` | **no role check at all**: any employee could hide a client with its projects, payments, treasury movements and subscriptions | `isAdmin` + `companyWriteDenial`; employee `403` |
| `DELETE /api/clients` (cleanup) | admin + scope (round 2) | unchanged, now also through the company-flag check |
| `DELETE /api/projects/[id]` | employee `403` | unchanged |
| `GET /api/office/stats` | auto-hid orphan clients for **any** session and across **every** company | admin only, and only the companies the session's flags grant |

The last row is the bypass the review asked to look for: a GET the employee dashboard calls on load was
deleting clients. It still cleans up after itself, but only for an admin and only inside its own
companies.

### 10.5 Tests: the real middleware and the real handlers

`tests/directory-write-authorization.test.ts` — **31 tests**, the REAL middleware (with a real signed
cookie) and the REAL route handlers, against a throwaway database of two companies; only the session
source is mocked. `tests/directory-read-scope.test.ts` grew to **19** rule tests (capability, and the
flag-aware company write denial). **50/50 pass.**

| Scenario | Evidence |
|---|---|
| manager with no flags | middleware `403` on `/api/projects`, `307` from `/command/projects` and `/command/clients`; handler `403`; nothing written |
| employee | `403` on create/update/delete/cleanup and on `DELETE /api/clients/[id]`; client, project, payment, treasury movement and subscription unchanged |
| session allowed for another company | `403` on the other company's project create, patch, delete and on its own company cleanup when naming the foreign one; the other company's typed routes stay gated |
| session carrying a company without its flag | `403` — the `businessId` alone grants nothing |
| foreign `clientId` | `403` before any write; the foreign client's name, tier and money counts are identical afterwards |
| failure halfway | `500` and **no** renamed client, no orphan project, no deposit row (transaction) |
| allowed paths still work | create in the named company, patch with a payment (one movement pair), admin client delete, scoped cleanup, admin stats cleanup |
| dashboard | an employee's stats load hides nothing; an admin's hides only its own company's orphans |

Every refusal is asserted twice: the HTTP status, and a full snapshot of the rows it would have changed
(client name/tier/hidden, projects, client payments, treasury movements, subscriptions — plus the
global counts).

### 10.6 Limits and what is still open

| id | Gap | Status |
|---|---|---|
| **G8** | the workspace gate | **closed** (10.1): `403` again for a session with no company |
| **G9** | a super-admin write must name a company | unchanged, now tested through the flag-aware path |
| **G10** | `PATCH /api/projects/[id]` has no "change the client" field, so the client-change rule is enforced where a client can actually be changed: the create path that also renames it | documented |
| **G11** | ~~the stats dashboard wrote (auto-hide) on a `GET`~~ | **closed** (10.7): the dashboard is read-only; hiding an orphan client is the explicit `DELETE /api/clients` cleanup, with its admin + named-company checks |
| **G12** | the refusals are proven by calling the real middleware and handlers, not by intercepting a browser session | documented |
| **G2**, **G4**, **G5**, **G7** | unchanged from round 2 | open |

No design, schema, migration or dependency changed in this round. The throwaway test database was a
separate cluster on `127.0.0.1:5435`; the demo database and the system PostgreSQL service were not
touched.

### 10.7 Round 4 — the dashboard is a read again

Round 3 limited the dashboard's auto-hide to admins and to their own companies. That was still a `GET`
that deletes: refreshing a page could hide a client and its money without anyone asking. `GET
/api/office/stats` now only reads. Hiding an orphan client stays in the one place it is requested —
`DELETE /api/clients?businessId=…` (admin role + an explicit, existing company) — and the recycle bin
restores it exactly as before.

`tests/directory-write-authorization.test.ts` pins it: an employee, a company admin and a super admin
each load the dashboard; the statistics still report the truth (one company for the scoped admin, both
for the super admin, `totalClients` / `totalProjects` from the live rows); and **every** row — client
hidden-flags and names, projects, payments, treasury movements, subscriptions and the global counts —
is identical before and after. A fourth test shows the orphan client surviving the dashboard and being
hid only by the explicit cleanup, in the named company alone.

---

## 11. Round 5 — operator-only projects, and writes that are one unit

### 11.1 An employee never reaches the projects surface

`canUseProjectsFeature(session)` refuses an `EMPLOYEE` **even when it carries a company flag**, and it is
checked in the middleware (`/api/projects` in every method, `/api/projects/[id]`, and the
`/command/projects` page) and again at the top of each project handler. The clients workspace keeps its
existing rule; only projects became operator-only.

The check happens **before any record is loaded**, so an employee's `PATCH`/`DELETE` on a missing id
returns the same `403` and the same `{"error":"Access denied"}` body as on a real one. The route is not
an oracle for which project ids exist. Authorized roles keep exactly the isolation they had —
`resolveReadScope` for reads, `companyWriteDenial` for writes — with no new role, flag or schema.

### 11.2 Every write is one transaction — including the activity log

| operation | in the transaction |
|---|---|
| `POST /api/projects` | client find/create/revive/rename, project row, deposit movement, recomputed tier, `CREATE` activity |
| `PATCH /api/projects/[id]` | treasury movement, client payment, project row, recomputed tier, `UPDATE` activity |
| `DELETE /api/projects/[id]` | client payments, treasury movements, project row, client auto-hide, its subscriptions, every `SOFT_DELETE` entry |
| `DELETE /api/clients/[id]` | payments, treasury movements, projects, subscriptions, client row, every `SOFT_DELETE` entry |
| `DELETE /api/clients` (cleanup) | **the whole request** (11.5): choosing the orphans, every orphan's subscriptions, its row and every `SOFT_DELETE` entry |

`softDeleteRecord` / `softDeleteMany` now accept the transaction's delegates (`LooseDb`), and
`logActivity` **rethrows** when it is given one — inside a transaction the log is part of the write, so a
failure aborts it instead of being swallowed after the save. The consequence is the property the review
asked for: a `500` always means nothing was written, and no request can fail with `500` after its save
already landed.

### 11.3 What a transaction does NOT give you: idempotency

A transaction makes **one attempt** atomic. It does not make a retried request safe: if the browser posts
`POST /api/projects`, the commit succeeds and the response is lost, the retry writes a second project and
a second deposit movement — both transactions were individually valid. Deduplicating that needs a
persisted idempotency key (client-generated, unique per attempt, replayed from the first success), not a
transaction. **This is required for the deal hand-off** — delivering a sale to a client, a project and a
receipt — and is deliberately not implemented here.

### 11.4 Tests for this round

| test | proves |
|---|---|
| middleware: employee on `/api/projects`, `/api/projects/[id]` and `/command/projects` | `403`/redirect with a company flag, while the clients page still opens |
| employee `GET /api/projects` | `403` with `{"error":"Access denied"}` |
| employee on an existing vs a missing project id | identical `403` and body — no existence oracle |
| employee create / delete | every row identical afterwards (clients, projects, payments, treasury movements, subscriptions, counts) |
| activity-log failure on create | `500` and **no** client, no project, no deposit |
| activity-log failure on update | `500` and no payment, no project change, no tier change |
| failure halfway through a client delete | `500`, client still visible, every child row still live |
| failure halfway through a project delete | `500`, project still live, its client still visible |
| successful project delete | payments/projects/subscriptions hidden together, client hidden, activity entries written |
| project delete when the client has another live project | the deleted project and its money hidden; the client, the second project, its payment, its treasury movement and the client's subscription all still live |
| cleanup of three clients | three hidden rows and three `SOFT_DELETE` entries written in exactly **one** `$transaction` call |
| cleanup where the second client fails | `500` and **every** client still visible, no log written, the global ledger identical — one unit for the request, not one per client |

`tests/directory-write-authorization.test.ts` holds **44** of these (up from 41), next to the **19**
rule tests in `tests/directory-read-scope.test.ts`: **63/63 pass**.

### 11.5 The cleanup is one transaction for the request

`DELETE /api/clients` used to commit once per client, so a company with nine orphans was nine commits:
if the tenth failed, the route answered `500` with nine clients already hidden and nine activity entries
already written, and the caller had no way to learn how much had landed. The whole request is now one
`prisma.$transaction` — the candidate query, the orphan counts, every client's subscription hide, its row
and its activity entries.

The first failure rolls the request back, so the answer is one of the two honest outcomes: everything is
hidden, or nothing is. Three details are deliberate:

* **The candidates are chosen inside the same transaction**, with `deletedAt: null` spelled out: `tx` is
the raw client, so the soft-delete extension is not filtering for it. A client created while the cleanup
runs cannot be selected and then skipped, and a row that is already hidden is never counted as an orphan
again.
* **One timeout for the request** (`{ timeout: 30_000 }`): a cleanup is a single statement series now, and
the 5 s default would fail a genuinely large company halfway instead of finishing it.
* **The plan is unchanged otherwise**: the same admin role, the same named, existing company, the same
`resolveWriteTarget` proof, the same recycle-bin behaviour (a hidden client is restored with its
subscriptions, section 11.2).

This is the property of 11.2 at the granularity of the request: **a `500` means none of it happened**.
It is still not idempotent (11.3) — repeating the cleanup after a lost response is harmless because the
rows already carry `deletedAt`, but that is not a general answer for a write that adds rows.

### 11.6 Checks run for round 6

| Check | Result |
|---|---|
| `npx vitest run tests/directory-write-authorization.test.ts tests/directory-read-scope.test.ts` | **63/63 passed**, no skipped test |
| `npx tsc --noEmit` | **exit 0** |
| eslint on every touched file | **exit 0**, no errors, no warnings |
| `node scripts/verify-exec-integration-manifest.mjs` | **exit 0**, `problems: []` |
| isolated test cluster (`127.0.0.1:5435`, `%LOCALAPPDATA%\nexup-test-db`) | started through `scripts/dev-db.mjs`, destination verified with `SHOW data_directory` / `SHOW port` / `current_database()` **before** the database tests ran |

The rollback tests are the ones a previous turn could not run (the cluster was down and the handler
suite had been left unexecuted there): the create, update, client-delete, project-delete and cleanup
failures are all re-run here against a live database, each asserting that every row and every activity
entry equals the snapshot taken before the request.

### 11.7 Closure — owner validation (2026-11-08T22:21Z)

| Item | Value |
|---|---|
| Result | **63/63 passed · 0 failed · 0 skipped** — `Test Files 2 passed (2)`, `Tests 63 passed (63)` |
| Reviewed source | `635961ceb8b6fad53832f691f053001b6f520914` |
| Tree the run happened on | `e549f77`; the only file that advanced during the run was `docs/DEPLOYMENT_PRIVATE_TRIAL.md`, hence `REVIEWED_SOURCE_AND_TEST_PATHS_IDENTICAL=True` |
| Run log | `.demo/review/directory-db-tests-635961c.log` — the raw record (start/stop output, counts, `REVIEW_TARGET`, `CLOSURE_BASIS`). `.demo/` is gitignored, so the log is a working record and this table is the durable one |
| Test cluster | `scripts/dev-db.mjs start` on `127.0.0.1:5435`, `DEV_DB_DIR=%LOCALAPPDATA%\nexup-test-db` |

`CLOSURE_BASIS` in the log states the same thing this table does: 63/63 at `e549f77`, with the
reviewed source and test paths byte-identical to `635961c`. The round therefore closes on evidence,
not on assertion: the suite that an earlier round could not execute ran in full, and nothing was
skipped to make it green.
