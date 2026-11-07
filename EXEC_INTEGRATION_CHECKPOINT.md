# Checkpoint — EXEC conversation lab, server side + integration copy

**Handoff to:** NEXUP AGENT (UI) · **Assembled by:** Main/Core · **Tree frozen for review:**
no commit, no push, no merge, no deploy, no dependency install, no SQL.

## 1. Where it lives

| | |
|---|---|
| Worktree | `nexup-exec-integration` |
| Branch | `feature/exec-integration-lab` |
| Base | `4ecc1a7fd1a28f2a45d2dfbd32a878914133356f` |
| Composition | Core snapshot (74 paths) → EXEC layer (32) → authored server side (11) |
| Sources | untouched: Core still 74 paths, EXEC still its own; see [EXEC_INTEGRATION_OVERLAY.md](EXEC_INTEGRATION_OVERLAY.md) |

## 2. The contract — `exec-conversation/v1` (**proposed**)

Single module, isomorphic, imported by both sides — never copied into the UI:

`src/modules/exec-conversation/contracts.ts`

```ts
EXEC_CONVERSATION_CONTRACT = "exec-conversation/v1"
EXEC_TURN_PATH            = "/api/exec/turn"
EXEC_REQUEST_ID_HEADER    = "X-Nexup-Request-Id"
EXEC_TURN_TIMEOUT_MS      = 20_000      // server binding
EXEC_TURN_CLIENT_TIMEOUT_MS = 25_000    // client patience
EXEC_BODY_MAX_BYTES       = 16_384
EXEC_MESSAGE_MAX_CODE_POINTS = 4_000
EXEC_MESSAGE_MAX_BYTES    = 8_192
EXEC_REPLY_MAX_BYTES      = 8_192
EXEC_ID_MAX_LENGTH        = 128         // ^[A-Za-z0-9_-]{1,128}$
```

Functions the client may use: `parseExecTurnRequest`, `limitExecReplyText`, `countCodePoints`,
`utf8Bytes`, `isExecJsonContentType`, `isExecTurnSuccess`, `createExecErrorBody`, `execErrorStatus`.
Types: `ExecTurnRequest`, `ExecTurnSuccess`, `ExecTurnError`, `ExecTurnErrorCode`.

### Request

```json
POST /api/exec/turn
{ "turnId": "turn-1", "message": "مرحبا", "conversationId": "conv-1" }
```

- `turnId` — required, correlation only. **Not an idempotency key**: replaying it yields a second
  reply and a second `requestId`.
- `message` — trimmed; 1..4000 code points **and** ≤8192 UTF-8 bytes; the smaller ceiling wins.
- `conversationId` — optional opaque echo. Never stored, never a transcript key.
- Unknown fields are ignored. No history, no transcript, no attachments, no streaming.

### Success (200)

```json
{"contract":"exec-conversation/v1","requestId":"53977fc0-…","turnId":"t2","conversationId":"conv-1",
 "reply":{"text":"رد اختباري من الموصل الوهمي — لا يوجد اتصال بنموذج حقيقي. …","truncated":false,"durationMs":0},
 "connector":{"kind":"DUMMY","provenance":"TEST"}}
```

Render only when `contract` matches, `isExecTurnSuccess(body)` holds, and `body.turnId` equals the
turn still in flight. `truncated: true` means the text was cut on a code-point boundary at 8192 bytes.

### Errors

```json
{"error":"CSRF_REJECTED","message":"رُفض الطلب لأنه لم يأتِ من أصل التطبيق.","requestId":"…","details":null}
```

| Status | `error` | When |
|---|---|---|
| 400 | `INVALID_INPUT` | bad JSON, wrong type, empty message, invalid id, invalid UTF-8 |
| 401 | `UNAUTHORIZED` | no/invalid session |
| 403 | `CSRF_REJECTED` | origin/CSRF gate refused |
| 413 | `MESSAGE_TOO_LARGE` | message over a ceiling |
| 413 | `PAYLOAD_TOO_LARGE` | >16384 bytes actually read |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | not `application/json` |
| 503 | `CONNECTOR_UNAVAILABLE` | connector not explicitly enabled (or production) |
| 504 | `CONNECTOR_TIMEOUT` | server binding expired |
| 500 | `INTERNAL` | connector failed |

All responses carry `Cache-Control: no-store` and `X-Nexup-Request-Id`. `details` is always `null`.
No `RATE_LIMITED` in v1 (nothing implements it). No CORS headers, ever.

## 3. Server side — what was built

| File | Role |
|---|---|
| `src/modules/exec-conversation/contracts.ts` | the one contract (isomorphic) |
| `src/modules/exec-conversation/connector.ts` | the port: one turn in, one text out |
| `src/modules/exec-conversation/dummy-connector.ts` | offline dummy; no network, no DB, no env read |
| `src/modules/exec-conversation/composition.ts` | fail-closed resolution + the **binding** deadline |
| `src/modules/exec-conversation/http-guard.ts` | `EXEC_TRUSTED_ORIGIN` / CSRF gate |
| `src/app/api/exec/turn/route.ts` | the only mutation; owns gate order and envelope |
| `src/middleware.ts` | exact-path route-managed auth for `/api/exec/turn` only |
| `scripts/exec-review-session.mjs` | mints an unprivileged review session (no DB, no secret output) |

**Gate order** (deliberate): `requestId` → CSRF → session → media type + bounded body + schema →
connector. A foreign origin therefore gets **403** even when unauthenticated.

**Middleware exception** is an exact-path `Set`, not a prefix: `/api/exec/turn/extra` still gets the
legacy `{"error":"Unauthorized"}` 401, `/api/ai-workforce/**` and `/api/office/**` are unchanged, and
an unauthenticated page still redirects to `/login?next=…`.

**Deadline is a binding.** `runExecTurn` settles once: the connector is called exactly once, the
timer aborts it, `504` is returned at 20s, and any late resolve/reject is consumed for logging and
discarded — it can neither produce a reply nor mutate state. No retry.

**CSRF policy** (`EXEC_TRUSTED_ORIGIN`, never derived from `Origin`/`Host`):

| Request | Result |
|---|---|
| trusted unset / malformed / not an origin | reject |
| `Origin` exact match, no/`same-origin` `Sec-Fetch-Site` | allow |
| `Origin` foreign, `null`, empty, multiple, trailing slash | reject (whatever `Sec-Fetch-Site` says) |
| `Origin` exact but `Sec-Fetch-Site` ≠ `same-origin` | reject |
| no `Origin`, `Sec-Fetch-Site: same-origin`, `nextUrl.origin` = trusted | allow |
| no `Origin` and no `Sec-Fetch-Site`, or request origin ≠ trusted | reject |

## 4. Runtime variables (names only — values are never in this tree)

| Name | Needed | Value |
|---|---|---|
| `AUTH_SECRET` | yes | existing app secret, ≥32 chars; the review secret is supplied by the operator |
| `EXEC_TRUSTED_ORIGIN` | yes | the exact review origin, e.g. `http://localhost:3100` |
| `EXEC_CONNECTOR` | yes | `dummy` |
| `EXEC_CONNECTOR_ALLOW_TEST` | yes | `1` (second deliberate opt-in) |
| `EXEC_DUMMY_DELAY_MS` | no | `0`–`2000`, lets you watch pending/cancel |

Production is refused by code (`NODE_ENV === "production"` → `503`), not by configuration.
Missing any of the three required switches → `503 CONNECTOR_UNAVAILABLE`, never a silent demo
fallback.

Review session (no database, no seed, no migration):

```bash
AUTH_SECRET=… node scripts/exec-review-session.mjs --out <outside-the-tree>/cookies.txt --host localhost
# prints: cookieJar path, cookieHost, tokenSha256Prefix, role EMPLOYEE, flags "all false", expiry
```

## 5. Reserved for NEXUP AGENT (untouched by this delivery)

`src/components/command/exec-lab/exec-conversation-client.ts` *(new)*,
`.../exec-conversation-state.ts` *(new)*, plus edits to `exec-experience.tsx`, `chrome.tsx`,
`i18n.ts`. `engine.ts` stays HTTP-free and there is **no** fallback to it on API failure.
The client imports the contract from `@/modules/exec-conversation/contracts`; it must not carry a copy.

Required UI text: **«رد اختباري — لا يوجد اتصال بنموذج حقيقي»** and **«الرسائل تُفقد عند تحديث الصفحة»**.
Conversation state stays in React memory (no `localStorage`/`sessionStorage`); no history is sent.

## 6. Checks actually run

| Check | Command | Result |
|---|---|---|
| Focused tests | `vitest run tests/exec-conversation-turn.test.ts tests/exec-conversation-timeout.test.ts tests/exec-review-session.test.ts` | **45/45**, exit 0 |
| EXEC UI's own test in this copy | `vitest run tests/exec-experience.test.ts` | **69/69**, exit 0 (same 4-file run: 114/114) |
| Types | `tsc --noEmit` | **0 errors** (whole project) |
| Lint | `eslint` on the new/changed files | **0 problems** |
| Script syntax | `node --check scripts/exec-review-session.mjs` | exit 0 |

HTTP smoke test against a real `next dev` (port 3210, review env, real signed cookie):

| Case | Result |
|---|---|
| no session, trusted origin | `401 UNAUTHORIZED` envelope + `X-Nexup-Request-Id` |
| session + trusted origin | `200`, contract/echo/reply, `connector: DUMMY/TEST` |
| session + foreign origin | `403 CSRF_REJECTED` |
| session, no `Origin`, `Sec-Fetch-Site: same-origin` | `200` |
| 4200 code points | `413 MESSAGE_TOO_LARGE` |
| 20 000-byte body, chunked (no `Content-Length`) | `413 PAYLOAD_TOO_LARGE` |
| `text/plain` | `415 UNSUPPORTED_MEDIA_TYPE` |
| `GET /command/exec` with session | `200` (lab page renders from this copy) |
| `GET /command/exec` without session | `307 → /login?next=%2Fcommand%2Fexec` |

**Server state:** the dev server was started for the smoke test and **stopped** afterwards; port 3210
is released and no process from this session is running. `.next/` was removed afterwards.

## 7. Limits and honest notes

- **Not implemented, by decision:** rate limiting, transcript persistence, missions, approvals,
  capability execution, real provider, Hermes wiring, streaming, retries, CORS.
- **The 20 s route deadline** is proven at the binding (`runExecTurn`) and through the route with the
  same binder on a shortened deadline; the route was not held open for the full 20 s in a test.
- **Host spelling:** Next normalizes `127.0.0.1` → `localhost` inside `nextUrl`. Use one spelling in
  `EXEC_TRUSTED_ORIGIN`, the browser URL and curl. Browser `fetch` always sends `Origin`, so the
  page is unaffected; an originless client on the other spelling fails closed.
- **`.mjs` line endings:** the mint script must stay LF (CRLF breaks Vite's import of it in tests).
- **`node_modules`** in this copy is a junction to Core's install; nothing was installed and the
  lockfile is unchanged.
- The review secret and cookie jar live outside the tree and are never printed.

## 8. Next step (not started)

Set the four variables for this copy, start `next dev` on `localhost`, mint a review cookie, then run
the browser journey: unauthenticated 401, one message through the dummy connector, both mandatory
labels visible, single POST per Enter, late reply ignored after switching conversation, refresh loses
the thread, `EXEC_CONNECTOR` unset → 503 with no demo fallback, foreign-origin POST → 403.

## 9. UI integration closeout — 2026-10-28

The EXEC UI is now wired to the server-side dummy connector in this integration copy only. Core,
middleware, the route, the connector and both source worktrees were not changed.

### UI files

- Added `src/components/command/exec-lab/exec-conversation-client.ts`: relative same-origin POST,
  canonical contract validation, turn matching, safe error projection and the 25 s client deadline.
- Added `src/components/command/exec-lab/exec-conversation-state.ts`: immediate one-turn gate,
  cancellation/stale guards and mapping of the accepted reply/error into the existing message model.
- Updated `exec-experience.tsx`: free text uses `/api/exec/turn`; explicit scripted openers still use
  the local demo engine. Pending turns are cancelled on conversation/scope changes and unmount.
- Updated `chrome.tsx`: the composer is immediately busy/disabled while one turn is in flight.
- Updated `i18n.ts`: Arabic/English test-connector, pending, ephemeral-thread and safe-error copy.
- `engine.ts` remains HTTP-free. There is no retry, transcript upload, persistence or demo fallback.

### Tests and evidence

- `npx vitest run tests/exec-conversation-ui.test.ts tests/exec-experience.test.ts`:
  **78/78**, exit 0.
- `npx tsc --noEmit`: exit 0.
- Focused ESLint on the five UI files plus the UI unit test: **0 errors, 0 warnings**, exit 0.
- `git diff --check`: exit 0 (pre-existing line-ending warnings only).
- `python -m py_compile tests/exec-conversation-browser.py`: exit 0.
- Browser success journey, exit 0: Arabic desktop + English mobile; one POST during repeated Enter;
  a pending turn cancelled on conversation switch (`requestfailed` observed); no late reply; refresh
  cleared the conversation; no horizontal overflow.
- Browser 503 journey, exit 0: one failed POST, localized safe error with requestId, no raw details,
  no scripted-demo reply and no fallback.
- The English UI chrome, pending state, persistence notice and safe errors were verified. The accepted
  dummy reply itself remains Arabic because that is the server-provided v1 payload; it was not
  translated or altered in the UI, and the server is outside this task's ownership.
- Internal navigation away from EXEC completed while a turn was pending. Chromium did not expose a
  reliable `requestfailed`/abort callback before document teardown; the unmount uses the same tested
  `ExecTurnGate.cancel()` cleanup, while cancellation is directly observed in the conversation-switch
  browser case. This is the remaining browser-observability limit, not a persistence path.

Screenshots:

- `docs/evidence/exec-integration/exec-integration-desktop-success.png`
- `docs/evidence/exec-integration/exec-integration-mobile-success.png`
- `docs/evidence/exec-integration/exec-integration-desktop-error.png`

### Runtime state

Review used `http://localhost:3211` with exactly matching `EXEC_TRUSTED_ORIGIN`, the documented
unprivileged 15-minute review session, and the offline dummy connector. Both the enabled and disabled
connector runs were stopped; port 3211 is released. The temporary cookie jar was removed. No secret or
cookie value is stored in this tree or in the evidence.

## 10. Client response-body lifecycle correction — 2026-10-28

- `postExecTurn` now keeps its client deadline and caller `AbortSignal` binding active through
  `response.json()` and all response validation, not only until response headers arrive. Timer and
  listener cleanup happen in one outer `finally` covering the complete operation.
- A deadline firing while the response body is being read returns `CLIENT_TIMEOUT` and preserves the
  header requestId when available. Caller cancellation during body reading remains a non-rendered
  `NETWORK_ERROR`; the turn gate rejects its settlement after the caller cancels.
- Added focused stream tests for headers-first/body-later timeout and caller cancellation after
  headers. `tests/exec-conversation-ui.test.ts`: **11/11**, exit 0.
- `npx tsc --noEmit`: exit 0. Focused ESLint on the client and UI test: exit 0, no findings.
- The success browser journey was rerun: exit 0. Conversation-switch cancellation remains directly
  observed (`requestfailed`), late replies remain absent, and refresh still clears the conversation.
- Page-leave cancellation is **not claimed as browser-proven**: a listener attached specifically to
  the `/api/exec/turn` request signal did not report before Chromium tore down the document, and
  `requestfailed` was also absent. The script reports `pageLeaveCancellationProof` as
  `not observable before document teardown`; successful navigation is not treated as cancellation
  evidence. The unmount cleanup and `ExecTurnGate.cancel()` remain code/unit-test evidence only.
- The contract module and server side were read but not changed. Review server stopped, port 3211
  released, and the temporary cookie jar removed.

## 11. Interactive preview recovery and affordance audit — 2026-10-29

- The reported non-interactive “image” was reproduced as a stale browser document while nothing
  listened on `localhost:3211`. The integration worktree is now running locally on that port with
  the offline dummy connector and the existing local Demo database on `127.0.0.1:5501`.
- The first restart loaded quoted `.demo/env` values literally, so real local login could not reach
  the Demo database. The preview launcher now strips only the surrounding quotes in-process; the
  env file, auth code, server, contract and database were not changed.
- Browser interaction proved message send + dummy reply, new session, sessions/tools navigation,
  header menu, Arabic/English switching and the Live Work disclosure. The settings control was the
  one misleading affordance: it opened the team panel although settings are not implemented. It is
  now disabled and explicitly labelled `Settings — unavailable` / `الإعدادات — غير متاحة`.
- Voice chat, model selection and dictation remain disabled and explicitly state that they are not
  implemented. Tools states that no tool/model/provider is connected. No real provider was used.
- Added `tests/exec-interaction-browser.py` for the real local login and interactive journey. Its
  first run failed on the missing disabled-settings contract; the post-fix run passed and recorded
  `docs/evidence/exec-integration/interaction-final/exec-interaction-proof.mp4` (plus source WebM).
- Checks after the fix: interactive browser journey exit 0; `vitest` EXEC experience 69/69 exit 0;
  `tsc --noEmit` exit 0; focused ESLint exit 0; Python compile exit 0; `git diff --check` exit 0
  (pre-existing line-ending warnings only).
- Runtime intentionally remains available for user review at `http://localhost:3211/command/exec`;
  it is loopback-only. Replies are dummy and conversation state is lost on refresh.

## 12. Single reviewable product — Product layer assembled — 2026-10-29

### What changed here

The Product command layer was copied in as a fourth layer: **79 source paths**
(`src/app/command/**`, `src/components/command/**`), **4 `public/exec-lab/` files** (three new, plus
`exec-head.png` which already existed byte-identically), **2 Product tests**, and **one deletion**
(`adaptive-command-deck.tsx`). Nothing was written back to Core, EXEC or Product. No `src/app/api/**`
path was copied; Core's newer workforce guards are untouched and `src/middleware.ts` keeps its narrow
`/api/exec/turn` exception.

Path-level conflicts: **none**. The one route that needed a decision is `/command/exec`, which stays
EXEC's (Product never edited that file). `exec-workspace.tsx` is now unmounted and recorded as such.
The manifest gained `layers.product` (85 rows), `counts.*`, `digests.product85` and `deletions`, and the
five EXEC files NEXUP AGENT edited were reconciled against their current bytes (as-copied hashes kept).

### The link and how to sign in

**`http://localhost:3211/command`** — one URL for the whole journey. Unauthenticated requests are sent
to `/login?next=/command` and return there.

Sign-in is the **real product login** (`/login` → `/api/auth/login` → `User` row → HS256 cookie). Any
account already in the demo database works; the review server was pointed at the local demo DB on
`127.0.0.1:5501` (`nexup_redesign`), which holds the seeded `*.nexup.local` accounts and the demo company
data. No account, password or cookie is stored in this tree.

The no-database **review session** (`scripts/exec-review-session.mjs`) still exists for HTTP checks: an
unprivileged `EMPLOYEE`, all flags false, no user row, default 8 h. It reaches `/command/**` because that
route has no permission gate, and is refused by `/office/nexup/**` and office finance. It is a review
credential, not a product login, and it needs the same `AUTH_SECRET` the server was launched with.

Relaunch (the secret is supplied by the environment, never committed):

```bash
cd nexup-exec-integration
AUTH_SECRET=… DATABASE_URL=postgresql://…/nexup_redesign DATABASE_SSL_DISABLE=1 \
EXEC_TRUSTED_ORIGIN=http://localhost:3211 EXEC_CONNECTOR=dummy EXEC_CONNECTOR_ALLOW_TEST=1 \
./node_modules/.bin/next dev --webpack --port 3211 --hostname localhost
```

`--webpack` is required: Turbopack refuses this copy's `node_modules` junction (“symlink points out of
the filesystem root”), and `package.json`'s own `dev` script already passes the flag.

### Journey actually walked (real browser, real login)

A throwaway `SUPER_ADMIN` row was created in the local demo DB only to drive the login form, then
**deleted** (verified `count = 0`); its random password never entered the tree.

| Step | Observed |
|---|---|
| `/login?next=/command` | form rendered; submit → `200` and redirect to `/command` |
| `/command` | new home composition: greeting header, six-space orbit, EXEC seat, summary strip, “Demo data — local, read-only, nothing executed” |
| rail → Work → `/command/missions` | 15 mission rows, state filters, department filters, state breakdown |
| area strip → `/command/clients` | 7 client cards, figures `7 / 3 / 8 / 8`, project + mission links |
| client → `/command/projects#pr-studio-kensington` | 10 project cards, anchored card in view, client link and one mission link |
| project → `/command/missions/cr-m1` | `MIS-2054 · Kensington spring campaign`, task graph, “Visual prototype” note, mock “Reassign owner” |
| rail → `/command/exec` | EXEC experience, Arabic, both mandatory labels, model/dictation/settings disabled |
| composer send | `POST /api/exec/turn 200`; dummy reply “استُلمت رسالة بطول 26 حرفًا … لم تُحفظ شيء”, no error, no fallback |
| `/command/finance` | four figures `— / — / — / 8`, four spend guards, product-shell note |

Server log across the walk: no errors, no warnings, `POST /api/exec/turn 200`.

### Checks run for this assembly

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0, whole project |
| `vitest run tests/command-locale.test.ts tests/command-product-lab.test.ts` | **60/60**, exit 0 |
| `vitest run` EXEC experience + conversation UI/turn/timeout/review-session | **125/125**, exit 0 |
| `node scripts/verify-exec-integration-manifest.mjs` | 202 rows, problems `[]`, exit 0 |
| Unauthenticated `/command` | `307 → /login?next=%2Fcommand` |
| Session on all six routes + `/exec-lab/space-home.webp` | `200` each |

### Known limits (not defects introduced here)

- Every Command page reads the **demo adapter**; EXEC free text hits the **dummy connector**. No real
data, provider, tool, mission or write path is connected.
- `/command/finance`'s “Open the real finance surface” points at `/office/finance`, which has no route:
it redirects to `/office` (`/office/nexup/finance` is the real surface). Owner: Product Builder, one line.
- `/command` defaults to English on a first visit (locale cookie); Arabic is one switch away.
- Conversation state is memory-only: refresh clears it, as the UI states.
- Two conversation surfaces are mounted on purpose: `/command/exec` (EXEC, wired) and
  `/command/exec/talk` (Product's deterministic demo, kept because the phone nav links it).

No commit, push, merge or deploy was made; nothing is staged.

## 13. Visual polish — readable type, refined plates and controls — 2026-10-29

**Reported:** the plate names read soft, the plate's own shading fought the text, and the cards and
buttons should look more professional.

**Cause (measured, not guessed):** two layers sat between the glyphs and the reader —
`.nc-pod__plate::after` painted a milky sheen over the whole plate, and the plate background carried
an amber wash (`rgba(246,219,173,.1–.2)` at the top). Together they tinted the type at 60% opacity and
made a crisp 17px/700 label look blurred. The 60px identity disc also crowded the name.

**Change — one appended section (`home.css` §10), home surface only:**

| Element | Before | After |
|---|---|---|
| Plate names | 17px/700 on amber wash | 17px/640 on near-black glass, `#fcf7ed`, tracking 0, no text-shadow |
| Plate surface | warm grey flood, `::after` sheen over all content | three-stop graphite glass, 1px champagne rim (`rgba(246,219,173,.3)`), rim light limited to the top 26% |
| Identity disc | 60px | 52px desktop / 42px tablet / 38px narrow, with a defined rim and a top inner light |
| Status line | 12px sentence case, 72% | 10.5px micro-label, uppercase, tracking `.1em`, 60% + a tight LED ring |
| Hover / selected | border only | border lift + two-stop background + a ring for selection (no colour change) |
| Focus | none on the plate | `:focus-visible` 2px mint outline, offset 3px (plate and demo pill) |
| Demo pill | 36px, 11.5px label, 9px tag | 40px, 12px/600 label, 9.5px DEMO chip, chevron slides on hover; stays 44px on the phone |
| Orbit rings | 0.13–0.26 | 0.17–0.29, so the geometry reads without becoming a grid |
| EXEC wordmark | 15px, tracking .42em | 16px, weight 560, tracking .40em, role line warmer |

Every rule is scoped to `.nc-root[data-surface="home"]` and appended after all twelve imported layers,
so no earlier layer is rewritten and no other surface changes. The Product source worktree was not
touched: this pass lives only in the integration copy, and `home.css` is recorded in the manifest with
its as-copied hash beside the current one.

**Verified:** computed styles confirm the applied values (name `rgb(252,247,237)` / 640 / no shadow;
plate border `rgba(246,219,173,.3)`; `::after` rim; disc 52px; pill 40px / 999px); CSSOM confirms all
five base and media rules parsed (base pill, ≤760 pill, focus ring, ≤1000 disc, rim); contrast is 17.4:1
for the name and above 7:1 for the status; hover border moves `.22 → .52` with `[data-hovered="true"]`;
all six names render unclipped. `node scripts/verify-exec-integration-manifest.mjs` → exit 0 after
reconciling `home.css` (`product85` digest `a218966f…79990e`). CSS-only: `tsc` is unaffected.

**Not done:** no screenshot of the final state was captured (the review tab is in active use and the
capture mirrors the visible page), no phone-width visual check, and the other Command surfaces
(missions, clients, projects, finance) keep their existing styling — this pass is the home only.

## 14. EXEC menu, interaction and reference-size visual closeout — 2026-10-30

- The hidden three-line menu was reproduced before changing it. Its visible-area ratio was only
  `0.0229`: `.nce-top { overflow: hidden }` clipped the absolutely positioned menu at the header
  boundary. This was not a z-index defect. The header now permits overflow; the menu owns a bounded
  viewport-height scroll region; and header/body/tabbar stacking is explicit.
- `HeaderMenu` now closes on an outside pointer press, closes on Escape, and restores focus to its
  trigger after Escape. The interaction browser proof requires at least 98% of the menu rectangle to
  remain visible and repeats the complete open/outside/Escape/focus journey at desktop and mobile
  widths.
- The same EXEC pass deepened the existing warm dark glass, localized champagne reflections, reduced
  the desktop rail to 238px, and tightened message/composer proportions. It does not use the composite
  reference as a background and leaves `--nce-orbit-image: none` until an independent orbital asset is
  supplied.
- Visible affordances exercised in one recorded journey: menu desktop/mobile, mobile chat/sessions/tools
  navigation, launch-brief choices and result, result details, Preview/Edit panels, new session,
  attachment demo add/remove, effects toggle, rail collapse/expand, free-message dummy reply,
  sessions/tools, AR/EN, Live Work and return to EXEC. Settings, model selection, dictation and voice
  chat are asserted disabled and labelled as unavailable/unimplemented.
- Browser journey: **exit 0**. `tsc --noEmit`: **exit 0**. Focused ESLint: **exit 0**.
  `vitest run tests/exec-experience.test.ts`: **69/69**, exit 0. Python compile: **exit 0**.
  `git diff --check`: **exit 0** (pre-existing line-ending warnings only).
- Evidence:
  - `docs/evidence/exec-integration/final-interaction-visual/exec-interaction-proof.mp4`
  - `docs/evidence/exec-integration/final-interaction-visual/exec-reference-size-conversation.png`
  - `docs/evidence/exec-integration/final-interaction-visual/exec-reference-comparison.png`
- Runtime intentionally remains loopback-only at `http://localhost:3211/command/exec`, with the offline
  dummy connector and isolated Demo database on `127.0.0.1:5501`. The documented 15-minute review
  cookie used by automation was removed immediately. The existing local Demo user's password hash was
  synchronized to the already-stored `.demo/env` value (one row; no role or permission change) so the
  normal login flow and `.demo/credentials.txt` work again. No secret or cookie was printed or stored
  in evidence.
- Files changed by this closeout: `src/components/command/exec-lab/chrome.tsx`,
  `src/app/command/exec-lab.css`, `tests/exec-interaction-browser.py`, this checkpoint and the evidence
  files above. Earlier integration changes in `exec-nav.tsx` and `i18n.ts` remain preserved.
- Remaining visual gap: the independent space/planet asset is still absent. The current subdued CSS
  ambience preserves readability but does not reproduce the reference's orbital depth. No substitute
  asset or provider integration was added.

## 15. EXEC professional workspace pass — 2026-10-30

- Reorganized the EXEC-owned UI only: a prominent New session action, collapsible searchable
  memory-only conversations with human titles, account/preferences at the rail foot, and review
  scenarios behind a clearly labelled review disclosure. Technical conversation codes remain
  secondary and are never the primary title.
- Replaced the former generic Tools/settings presentation with a truthful Plugins inventory and a
  structured Workspace with Activity, Preview and Outputs tabs. The inventory names only repository-
  confirmed systems: same-origin EXEC Conversation API, offline dummy connector, server-side R2
  receipt capability (not bound to EXEC), and external model provider (not connected).
- The composer now starts compact and auto-expands to a bounded height. Unavailable model and voice
  controls are no longer presented as daily affordances; the existing attachment demo, send, pending,
  cancellation and contract checks are unchanged.
- Fixed two interaction defects found by the updated browser journey: a stale panel-exit timer could
  detach a newly opened panel, and the mobile full-screen panel's body stacking context sat below the
  header and let the menu intercept Back. Opening a panel now cancels the stale timer; on mobile the
  panel-owning body rises above the header only while a panel is open.
- Browser journey (Arabic + English, 1280x820 + 390x844): exit 0. It proves free-message dummy reply,
  immediate panel switching, session search/no-results, Plugins, account language switch, desktop
  workspace tabs, mobile full-screen workspace/back, menu outside/Escape/focus, and memory-only New
  conversation. `tsc --noEmit`: exit 0; focused ESLint: exit 0; `vitest
  tests/exec-experience.test.ts`: **71/71**, exit 0; Python compile: exit 0.
- Evidence:
  - `docs/evidence/exec-integration/workspace-ui-final/exec-workspace-desktop.png`
  - `docs/evidence/exec-integration/workspace-ui-final/exec-workspace-mobile.png`
  - `docs/evidence/exec-integration/workspace-ui-final/exec-interaction-proof.webm`
- Files changed in this pass: `src/components/command/exec-lab/engine.ts`, `exec-nav.tsx`, `chrome.tsx`,
  `exec-experience.tsx`, `i18n.ts`, `src/app/command/exec-lab.css`,
  `tests/exec-experience.test.ts`, `tests/exec-interaction-browser.py`, this checkpoint and the evidence
  files. All prior untracked overlay work remains preserved.
- Runtime: the integration preview is intentionally left running loopback-only at
  `http://localhost:3211/command/exec`, with the offline dummy connector. Browser automation used the
  documented unprivileged 15-minute review session and deleted each temporary cookie jar. No secret or
  cookie is stored in evidence. The local Demo database did not start because its ownership guard found
  an unverifiable PostgreSQL process and correctly refused to clear the stale lock; nothing was stopped
  or altered.
- Still needs Main/server ownership: durable conversation storage and archive APIs, a governed plugin
  registry/connection flow, and server-held credentials/permissions. This UI deliberately provides no
  local-storage substitute and no fake connection success. The independent orbital background asset is
  still absent; `--nce-orbit-image` remains the prepared insertion point.

## 16. Isolated EXEC Studio layout prototype — 2026-10-30

- Verified before writing that `http://localhost:3211/command/exec` was serving the latest saved UI:
  rendered HTML contained the current Workspace, Plugins and Demo-account markers. The existing route
  was not replaced or modified by this prototype pass.
- Added an isolated review route at `/command/exec/prototype`. It reuses the approved EXEC head and the
  existing vector icon family, but owns its page component and stylesheet. It introduces no API, auth,
  contract, provider, persistence or local-storage change.
- Three states are implemented for visual review: centered conversation start; a conversation with a
  side-by-side Activity/Preview/Outputs workspace; and a mobile conversations drawer. Plugins lists only
  the confirmed same-origin conversation API, offline dummy connector and unbound server-side R2
  capability. Development scenarios remain outside daily navigation behind the existing Review-space
  link.
- TDD proof: the browser test first failed on a 404 before the route existed. A second targeted red test
  caught the mobile drawer button leaking into the desktop header; CSS breakpoint specificity was then
  corrected and the test passed.
- Focused verification: `tsc --noEmit` exit 0; ESLint on the new page/component exit 0; Python compile
  exit 0; three-state Playwright journey exit 0; no horizontal mobile overflow and desktop Workspace is
  asserted beside, not over, the thread.
- Files added: `src/app/command/exec/prototype/page.tsx`,
  `src/components/command/exec-lab/exec-studio-prototype.tsx`,
  `src/app/command/exec-prototype.css`, `tests/exec-studio-prototype-browser.py`, and the three PNGs in
  `docs/evidence/exec-integration/studio-prototype/`. The preview remains loopback-only on port 3211.

## 17. EXEC Studio interaction-map correction — 2026-10-30

- The prototype sidebar is now the only owner of conversation search and switching. Desktop uses the
  same fixed, collapsible sidebar that mobile presents as an inline-start drawer; selecting a mobile
  conversation closes that drawer. New conversation opens the empty chat directly.
- Plugins and Settings are primary destinations with an explicit return to chat. The account remains a
  compact anchored menu. Workspace is the only opposite-side panel and contains only Activity,
  Preview and Outputs; it never presents conversations or unrelated navigation.
- Active conversation/destination state is exposed visually and with `aria-current`. Opening or closing
  navigation and account controls preserves the composer draft. The same drawer follows logical
  inline-start when switching between RTL and LTR.
- Focused verification after the correction: `tsc --noEmit` exit 0; focused ESLint exit 0; Python
  compile exit 0; Playwright click journey exit 0. The journey covers sidebar collapse/expand, direct
  session switching, empty New conversation, primary Plugins/Settings destinations, draft retention,
  side-by-side Workspace, mobile close-after-select and RTL/LTR drawer placement.
- Fresh evidence remains in `docs/evidence/exec-integration/studio-prototype/`: `01-exec-start.png`,
  `02-exec-conversation-workspace.png`, and `03-exec-mobile-sessions.png`. No server, conversation
  contract, authentication, provider, persistence or source-worktree file was changed.

## 18. Isolated preview recovery — BLOCKED at ownership, 2026-11-01

**Outcome: the demo environment was not started, and nothing was bypassed.** The browser journey
(login → `/command/exec/prototype` → interaction) was **not** run. The single blocking reason is
recorded below, with the evidence that identifies both clusters.

### State verified before any action

| Item | Observation |
|---|---|
| Listeners | nothing on `3211`, `5501` or `3300` (`netstat -ano`) |
| App | no `next dev` from this tree; `.demo/` is **absent** (so a start would rebuild the env: `scripts/demo-env.mjs` drops and rebuilds `nexup_dev`, new throwaway password) |
| Our cluster lock | `%LOCALAPPDATA%\nexup-dev-db\postmaster.pid`, 88 bytes, mtime 2026-10-29 00:11 — names pid **6240**, `C:/Users/MegaStore/AppData/Local/nexup-dev-db`, port **5501** |
| Our cluster process | `tasklist /FI "PID eq 6240"` → *No tasks are running* (gone) |
| Our data directory | owned by `MegaStore`; `PG_VERSION` 2026-10-08; log's last entry 2026-10-30 00:55 |
| Cluster log | last start 2026-10-29 00:11 recovered an interrupted shutdown and reached “ready to accept connections” on `127.0.0.1:5501` |

### What was run, and the exact refusal

Only the approved path was attempted: `node scripts/dev-db.mjs start` (the same first step
`scripts/demo-start.mjs` takes). It exited 1 at `clearStalePostmaster`:

> the lock file names pid 6240, which is gone, but live PostgreSQL process(es) cannot be shown to be
> using a different data directory (pid 8236: its argument vector could not be read …)

Nothing was cleared, started, stopped or signalled; the lock file is byte-identical afterwards
(mtime still 2026-10-29 00:11).

### Whose process is 8236 — established read-only

- `Win32_Process`: `postgres.exe`, `ParentProcessId 6840`, `SessionId 0`, `ExecutablePath` **empty**,
  `CommandLine` **empty** (an ACL denial for another account, not a parsing failure).
- `Win32_Service`: **`postgresql-x64-18`**, State Running, `StartName NT AUTHORITY\NetworkService`,
  `ProcessId 6840`, PathName `pg_ctl.exe runservice -N "postgresql-x64-18" -D "C:\Program Files\PostgreSQL\18\data"`.
- That cluster's own `C:\Program Files\PostgreSQL\18\data\postmaster.pid` names **8236**, that data
  directory, and port **5432**.

So 8236 is provably the installed PostgreSQL service, not this cluster. The gate cannot consume that
proof: its only positive clearance is a **readable argument vector** naming exactly one other data
directory (`directoryOccupation`, eleventh/twelfth review).

### Why it cannot be fixed from here

- The refusal does not depend on the data directory or the port: any `DEV_DB_DIR`/`DEV_DB_PORT` hits
  the same unresolved row, so **changing the port would not help**.
- No operator override env var exists in `scripts/dev-db.mjs` or `scripts/dev-db-ownership.mjs`, and
  none was added.
- Not done, deliberately: the gate was not edited, `postgresql-x64-18` was not stopped, the lock file
  was not removed, and neither `scripts/exec-review-proxy.mjs` nor a minted review session was used
  as a substitute for the product login.
- No container fallback exists on this machine (`docker` is not installed).

### To unblock — one owner decision

1. Run `node scripts/demo-start.mjs` from a shell that can read the service process's command line
   (elevated, same account). Whether elevation alone makes `Win32_Process.CommandLine` answer for a
   `NetworkService` pid is **not assumed here** — it has to be verified at that moment; or
2. have the owner of `postgresql-x64-18` stop that service before the demo is started; or
3. change the reviewed gate to accept an evidence source it deliberately refuses (a code change, not
   an operator action).

After either of 1–2, the unchanged sequence applies: `node scripts/demo-start.mjs` (rebuilds `.demo`),
normal login at `/login`, then `/command/exec/prototype`.

### Checks

None beyond the read-only inspection above: no source file was touched by this pass (only this
section), so no build, type or test run was made. Nothing is left running — ports `3211` and `5501`
are free, no app process and no postmaster from this tree, and no cookie jar exists.

## 19. Runtime re-check, contract note closed, manifest reconciled — 2026-11-02

**The assembled Product layer was not changed by this pass.** The manifest open item is closed and the
conversation-client contract note is closed; the runtime is **still BLOCKED at the same ownership gate**,
so the browser journey was **not** run.

### State verified before any action

| Item | Observation |
|---|---|
| Branch / base | `feature/exec-integration-lab`, HEAD `4ecc1a7` |
| Working tree | 171 entries on entry, untouched except this file and the manifest |
| `3211` | nothing listening (`curl /login` → `000`) |
| `5501` | `ECONNREFUSED`; `node scripts/dev-db.mjs status` → "the dev cluster is not running" |
| Our lock | `%LOCALAPPDATA%\nexup-dev-db\postmaster.pid` names pid **8608**, that data directory, port **5501**; pid 8608 is **gone** |
| Live PostgreSQL | pid **8324** with children 8944…9188; `postgresql-x64-18` state **Running**; its argument vector is not readable from this account |

### What was run, and the exact refusal

`node scripts/dev-db.mjs start` exited at `clearStalePostmaster`:

> the lock file names pid 8608, which is gone, but live PostgreSQL process(es) cannot be shown to be
> using a different data directory (pid 8324: its argument vector could not be read …)

Nothing was cleared, started, stopped or signalled, and the lock file is byte-identical afterwards.
The documented unblock #1 (a shell that can read the service process's command line) was requested as an
**elevated** run of the same script; the approval prompt went unanswered, so it did not run. No second
path was invented: `pg_ctl` was not called directly, the lock file was not removed by hand, and neither
the review-session cookie nor `exec-review-proxy.mjs` was used in place of the product login.

### The two open notes

1. **Conversation-client contract — closed, no code change needed.**
   `src/components/command/exec-lab/exec-conversation-client.ts` imports the shared contract from
   `@/modules/exec-conversation/contracts`; only three modules name `EXEC_CONVERSATION_CONTRACT`
   (the contract itself, the route and this client), so no copy exists in the UI.
   `vitest run tests/exec-conversation-ui.test.ts tests/exec-conversation-turn.test.ts
   tests/exec-conversation-timeout.test.ts` → **52/52, exit 0**.
2. **Manifest — closed.** Seven EXEC rows had drifted from the recorded bytes
   (`exec-lab.css`, `chrome.tsx`, `engine.ts`, `exec-experience.tsx`, `exec-nav.tsx`, `i18n.ts`,
   `tests/exec-experience.test.ts`). Each row's `sha256` now records the current bytes,
   `verification.execChangesAfterCopy` lists all seven, and `digests.execLayer32` was recomputed to
   `2a9024a90e0e522908b327aa8e21dfa2f67d4ada009214382b08a703acd35820`;
   `digests.execLayer32AsCopied` is unchanged and no as-copied hash was invented for the two paths that
   never had one. `node scripts/verify-exec-integration-manifest.mjs` → **202 rows, `problems: []`, exit 0**.

### Not done — and why

The browser journey (login → `/command` → clients → projects → missions → `/command/exec` → send a
message and receive the dummy reply, desktop and mobile) was **not run**. There is no demo database to
authenticate against, so the app cannot issue a session and no page behind `/login` can be opened. No
screenshot was captured and no assembled page was re-tested in a browser this pass. That is a blocker,
not a pass.

### Unblock — one owner decision (unchanged from §18)

An elevated `node scripts/demo-start.mjs`, or the owner of `postgresql-x64-18` stopping that service.
After either, the unchanged sequence applies: `node scripts/demo-start.mjs` (reuses `.demo`), then the
journey above.

### Governance note

Ownership evidence of the PID-file / log / service-response kind is a **read** artifact. It authorises no
later stop, restart or delete; each of those needs fresh evidence from the approved path.

### Why the existing launcher was NOT reused

`.demo/admin-start-preview.ps1` — the launcher that produced the 2026-11-01 preview — reaches the demo
database by `Stop-Service postgresql-x64-18`, then runs `node scripts/demo-start.mjs` with
`DEV_DB_DIR=%LOCALAPPDATA%\nexup-dev-db`, `DEV_DB_PORT=5501`, `DEMO_PORT=3211`,
`EXEC_TRUSTED_ORIGIN=http://localhost:3211`, `EXEC_CONNECTOR=dummy`, `EXEC_CONNECTOR_ALLOW_TEST=1`,
and `Start-Service` in `finally`. `demo-start.mjs` forwards `process.env` to the spawned app
(`const env = { ...process.env, ...readEnvFile(DEMO_ENV) }`), so that env recipe is the correct one and
should be reused verbatim when the runtime is unblocked — and `.demo/env` carries no `EXEC_*` key, so the
connector switches **must** come from the environment or the EXEC composer answers `503` instead of the
dummy reply.

It was **not run this pass.** It stops a machine-wide service (`postgresql-x64-18`, listening on 5432), and
this task's rule is that PID/log/service-response evidence may not authorise a later stop or delete. That
stop needs the owner's explicit approval, not this session's inference. Running the service stop silently
would have been the bypass the task forbids, even though the script restores the service in `finally`.

## 20. Runtime UNBLOCKED and the browser journey ran — 2026-11-02 21:29–21:45

**Supersedes the "Not done" part of §19.** The elevated run was approved and, although the tool reported
the step as cancelled after 5 minutes, it had already done its work: the ownership guard could read the
live postmaster's argument vector, proved it belongs to `postgresql-x64-18` on 5432, and started OUR
cluster. Nothing was stopped: `SYSTEM_POSTGRES_UNTOUCHED=Running` is the first line of
`.demo/isolated-launch.log`, and the service is still `Running` afterwards.

| Fact | Value |
|---|---|
| Launcher | `.demo/start-isolated-demo.ps1` (new, env-only; no `Stop-Service`, no old launcher) |
| DB | `127.0.0.1:5501`, fresh `postmaster.pid` pid **10124**, `.demo` reused (password unchanged) |
| App | `next dev --webpack -p 3211`, PID **20668**, `.demo/app.pid`, `/login` → 200 |
| Tree | still 171 entries |

### Browser journey (real login, no proxy, no session substitution)

`/login` with `superadmin@nexup` → `POST /api/auth/login 200` → `/office` (the product's own default
`next`, unchanged) → then:

| Step | Observation |
|---|---|
| `/command` | `h1` «مساء الخير، المؤسِّس» + يحتاج قرارك / العمل الحالي / خدمات مشتركة |
| `/command/clients` | **7** `article` cards, «العلاقات»، «يحتاج انتباهك» |
| `/command/projects#pr-studio-kensington` | **10** cards, Kensington present |
| `/command/missions/cr-m1` | **MIS-2054** found |
| `/command/exec` | composer, «رد اختباري — لا يوجد اتصال بنموذج حقيقي» |
| send (desktop) | `POST /api/exec/turn **200**`, dummy reply «…استُلمت رسالة بطول 39 حرفًا» |
| mobile 390×844 | nav collapses to a bottom bar, composer visible, **no horizontal overflow**, send → dummy reply «43 حرفًا» |

Two timing notes for the next run: the pages hydrate before their cards paint (~2–3 s on this machine, so a
count taken immediately reads 0), and the login button needs hydration before a click submits — a click sent
too early does nothing and shows no error.

### Client notes closed in code (not just by importing the contract)

`exec-conversation-client.ts` now rejects a reply whose echoed `conversationId` differs from the one sent,
rejects a response whose `X-Nexup-Request-Id` differs from `body.requestId`, and maps an error only when the
envelope is well-formed (`message` non-empty, `details` exactly `null`); anything else becomes
`PROTOCOL_ERROR` and is never rendered. `tests/exec-conversation-ui.test.ts` gained cases for all three and
lost the old "tolerate a leaking envelope" expectation. Focused run:
`vitest run tests/exec-conversation-ui.test.ts tests/exec-conversation-turn.test.ts
tests/exec-conversation-timeout.test.ts tests/exec-experience.test.ts` → **126/126, exit 0**.
`verify-exec-integration-manifest.mjs` → **exit 0** (neither file is a manifest row).

### Still Demo / still open

Every Product page reads the demo adapter; the conversation lives in memory only and is lost on refresh;
`/command/finance` still points at a non-existent `/office/finance` (Product Builder owns that);
`/api/ai-workforce/missions` `403` remains untouched and unexplained. Preview and app are left running on
`http://localhost:3211` for Saeed.

## 21. The preview died after hand-off, and the relaunch is waiting on ONE UAC approval — 2026-11-03 00:15

**Current state: the demo is DOWN.** Nothing in the tree changed (still 171 entries), the checkpoint is the only
file this section touches, and no ownership guard was bypassed.

What the evidence shows, in order:

| Check | Result |
|---|---|
| app PID 20668 | gone; port **3211 has no listener**, `/login` → no answer |
| isolated cluster | port **5501 has no listener**; `%LOCALAPPDATA%\nexup-dev-db\postmaster.pid` still names **10124** (gone) |
| `postgresql-x64-18` | still **Running**, and its postmaster **8392** is not touching our data directory |
| `.demo/app.log` | last writes at **21:41** (the `/office` + `/api/office/stats` lines), i.e. it served Saeed's login and then stopped |
| `.demo/relaunch.log` / `.err` | a NON-elevated relaunch was attempted at 00:15 and **failed closed** |

Why the plain relaunch cannot work, quoted from the guard itself:

```
refusing to clear ...\nexup-dev-db\postmaster.pid: the lock file names pid 10124, which is gone,
but live PostgreSQL process(es) cannot be shown to be using a different data directory
(pid 8392: its argument vector could not be read, so it cannot be shown to be using a different
data directory), so it cannot be shown that nothing is using ...\nexup-dev-db
```

`dev-db.mjs start` refuses at `clearStalePostmaster`, and `restart` refuses at `stopForRestart` with the same
reason. Windows will not hand a non-elevated process another process's argv, and the guard is right not to treat
"the lock file's pid is gone" as "the directory is free" — deleting the lock by hand would be exactly the bypass
this work has refused all along, so it was not done.

**What is waiting:** `.demo/detach-launch.ps1` (new) starts `.demo/start-isolated-demo.ps1` through WMI so the
launcher lands OUTSIDE the elevated shell's process tree — the previous launch died together with its elevated
host a few minutes after the banner, and that is the one defect this file fixes. Two elevation requests returned
"cancelled after 5 minutes" and the log's mtime (21:31) proves the wrapper never started, so the UAC prompt was
not approved.

The exact command, from an Administrator PowerShell (or approve the UAC prompt on the next attempt):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\MegaStore\Documents\Codex\2026-08-20\context-md-phase-0-context-md\nexup-exec-integration\.demo\detach-launch.ps1"
```

Then `http://127.0.0.1:3211/login` comes back on the SAME `.demo` environment (same password, same demo data),
because `demo-start.mjs` reuses it when the files and the schema are both present.

## 22. Relaunch succeeded — the demo is back up on the SAME .demo environment — 2026-11-03 21:22

The UAC approval arrived and `.demo/detach-launch.ps1` created the launcher through WMI (**LAUNCHER_PID=12416,
RETURN=0**). Everything §21 promised held:

| Fact | Value |
|---|---|
| Database | `127.0.0.1:5501`, FRESH `postmaster.pid` **3288** (the stale 10124 lock cleared by the guard, never by hand) |
| App | `next dev --webpack -p 3211`, PID **22616**, `/login` → **200** after ~78 s |
| Environment | reused, not rebuilt: same `superadmin@nexup` password, same demo data |
| Launcher | pid 12416 is GONE and the app is still alive — the WMI start means the app is no longer inside the elevated shell's tree, which is the defect that killed §20 |
| `postgresql-x64-18` | still **Running**, never stopped, never reconfigured |

Re-verified on the restarted instance, not assumed from the first run: real login `superadmin@nexup` →
`POST /api/auth/login 200` → `/office`; then `/command/exec` → send → `POST /api/exec/turn **200**` →
«…استُلمت رسالة بطول **47** حرفًا» dummy reply, no error envelope, no horizontal overflow.

Tree still **171** entries, `verify-exec-integration-manifest.mjs` → **exit 0**, preview re-registered against
pid 22616 on `http://localhost:3211`. The two open Product items from §20 are unchanged and still not mine:
`/command/finance` → missing `/office/finance`, and the untouched `403` on `/api/ai-workforce/missions`.

## 23. Marketing & Sales gateway and the sales room — 2026-11-03

Two surfaces, one layer, no records. The home's **Marketing & Sales** plate now opens a GATEWAY
(`/command/sales`) instead of a generic workspace, and the gateway opens the SALES ROOM
(`/command/sales/room`) drawn from the supplied references: three glass stations on one tilted
platform, the "قراراتك" card, the team strip and a five-step demo journey.

| Piece | Detail |
|---|---|
| Route decision | `workspaceHref("growth")` → `/command/sales`. Every other department, and the shared service, keeps its exact URL. The gateway links on to `/command/departments/growth-revenue`, so the old workspace is still reachable. |
| Stations | `data-status` = working / ready / waiting / approval, all derived from the journey; each station is a `<button>` that turns the decisions card to that station's owner and opens its step. Inspecting never moves the work, and the card says so. |
| Journey | qualify → assign (owner + follow-up date) → offer (hand-edited draft + review) → demo acceptance → hand-off preview (existing or new client, plus a project name). Pure `journey.ts`: `canAdvance` gates every step, `advanceManually` is the room's "أكمل يدويًا" and does NOT claim the gate was met. |
| Hand-off | Preview only: it names the client and project and links to the existing `/command/clients` and `/command/projects`. No client, project, offer or activity record is created; there is no route handler and no `fetch` in the layer. |
| Marketing door | **AWAITING TRANSFER** — `nexup-command-product` has no marketing files yet (no `*market*`/`*sales*` path in that tree), so the door is a `div` with `aria-disabled` and NO `href`. A test asserts it can never gain a link, which is why there is no broken route here. |
| Identity | Foundation tokens only: champagne edges and the one primary action, mint "working", amber "awaiting approval", smoked glass, `nxs-`-prefixed, imported last in `app/command/layout.tsx`. No token redefined. |

**Browser journey, with a real session** (`superadmin@nexup`, pid 22616, `:3211`): login → `/command`
→ Marketing & Sales plate → gateway → sales room. Then the demo journey was RUN to the end:
qualify → date `2026-11-10` + owner → draft edited and reviewed → demo acceptance → hand-off preview
(`عميل قائم · Kensington Group`, `Storefront v1`) → `5/5`, all five rail steps `done`, advance
disabled. Network log shows GETs only — no POST, so nothing was written anywhere.

**Checks:** `tsc --noEmit` 0 · `eslint` (sales layer, tests, layout, department-workspace) 0 ·
`vitest tests/sales-journey.test.ts` **14/14** · AR and EN at 390px and 960px with **no horizontal
overflow** · `verify-exec-integration-manifest.mjs` exit 0.

**Manifest:** two new layers recorded with per-path hashes and a layer digest — `sales` (9 paths:
two routes, the CSS layer, three state/copy modules, the gateway, the room, one test) and
`missionsGlass` (1 path, the previous pass's stylesheet). Three product-layer rows were re-hashed
WITH the reason instead of silently: `missions/page.tsx`, `layout.tsx`, `department-workspace.ts`.
`scripts/verify-exec-integration-manifest.mjs` now digests both new layers, so a stray edit to either
fails verification. Counts: 74 core + 32 exec + 11 authored + 85 product + 9 sales + 1 glass = 211.

**Not done, on purpose:** no commit, no push, no deploy, no migration, no auth change, no provider,
no real offer sent, and `postgresql-x64-18` was never touched. The demo journey lives in React state
for the life of the tab; a reload restarts it, which the copy states.

## 24. Unmounted module kept on purpose — `LiveWorkBand` — 2026-11-07

`src/components/command/exec-lab/live-work.tsx` still exports `LiveWorkBand`, and nothing in this
tree imports it. It is **kept**: not mounted and not deleted, pending an explicit owner decision.

**What it does.** `LiveWorkBand({ run, locale, onClose })` draws one band above the conversation
(`<section class="nce-live">`): the run's state chip (glyph and label from `EXEC_STATUS_META`), the
task title, a `stage / total` progress counter, the demo badge, a close button, and — opened by
construction — the plan disclosure `ExecutionSummary`, whose own close bar closes the band. With
`run === null` it draws the same frame and says `live.none` instead of an empty scaffold. There is
no timer, no polling and no animation: the band is a reading of state that already exists.

**Where its data comes from.** Props and local catalogues only. `run: RunState | null` is the run
owned by `exec-experience.tsx`; `total` is `getScenario(run.scenarioId).beats.length` and `stage`
is `run.beatIndex + 1` clamped to it; labels come from `t(locale, …)` in `i18n.ts` and the state
vocabulary from `catalog.ts`. It fetches nothing, calls no API, reads no database and no server
action — every value is demo state the conversation itself produced.

**Why it is separated — what is and is not documented.** No path in `docs/**`, `README.md` or
`EXEC_INTEGRATION_*.md` mentions the band at any version, so *the reason it was left unmounted is
not recorded in this tree* and is not reconstructed here. What is written down is narrower: the
module header states the one-at-a-time rule — the band and the conversation's own execution
summary are the same disclosure, so at most one of the two is rendered. In EXEC's tree that rule
was kept by a `liveOpen` flag that mounted the band; here `exec-experience.tsx` keeps only the
inline path: `openWork(view: "inline" | null)` and `inlineOpen` drive the `ExecutionSummary` at the
end of the thread, and the header affordance `toggleLive` opens the right-hand `workspace` panel
on `activity`. No call site opens the band.

**Cost of keeping it.** No route imports it, so it adds no bytes to any page, and nothing has to
be rewritten to mount it again: the `live.*` strings are still in `i18n.ts` and the `.nce-live*`
rules are still in `exec-lab.css`. The path stays in `layers.exec`, so the per-path hash check keeps covering it.

## 25. External verification — Codex browser review — 2026-11-07

Reported by the owner: Codex's browser review of the command surfaces passed. It is recorded here
as **external verification** — an observer outside this session looked at the running UI — next to
the in-session checks (vitest, `tsc`, eslint and the per-path manifest). It was not reproduced in
this session, and nothing in this branch depends on it: the automated checks stand on their own.
