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
| Clients | `GET /api/clients` | clients **with** their `projectRecords` (id, name, price, deposit, both statuses, date) and the computed `projectCount / totalPaid / totalRemaining / isRepeatClient / tier` | `businessId ∈ getAccessibleBusinesses(session)` |
| Projects | `GET /api/projects` | project records with `client`, `designer`, `services`, plus per-client `projectCount / totalPaid / isRepeatClient` | `businessId = session.businessId` unless `SUPER_ADMIN` |

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

Observed behaviour, unchanged and correct: `/api/clients` is scoped by the business **flags**
(`canAccessNexup/Rebound/Abomazen`), `/api/projects` by `businessId`; the middleware answers
`403 Access denied` for a business route whose flag is off; `SUPER_ADMIN` bypasses both and sees all
companies (`businessId: "all"`).

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
| **G1** | `GET /api/clients` **recomputes** `tier` (from total deposit and repeat count) and its value shadows `Client.tier`, so a stored `VIP` row can render as `وفيّ`. The surface shows what the route answers. | documented, not changed (route behaviour) |
| **G2** | `GET /api/projects?sortBy=<unknown>` sets `orderBy[sortBy]` and Prisma rejects it → `500`. The binding sends no parameters, so these two pages cannot hit it. | documented, not changed |
| **G3** | `POST /api/projects` uses `session.businessId` as `businessId`, which for a super admin is the string `"all"`. Write path, out of this round's scope; it matters for the hand-off spec below. | documented |
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
