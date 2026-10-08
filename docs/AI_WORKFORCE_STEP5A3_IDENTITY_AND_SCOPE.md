# Step 5A-3 — Authenticated authority, HUMAN actor resolution, and business scope

Status: **implemented, not committed**. Authority-only batch: it does not change
live dispatch, the durable claim, Hermes, the Bridge, or production.

## The two defects this batch closes

1. **Decision identity was a constant.** `POST /api/ai-workforce/decisions`
   attributed every human decision to the literal `"actor_founder"`, and a
   mission's `owner` defaulted to the same constant. A signed-in user was
   irrelevant to who "made" a decision.
2. **No business scope on the mission path.** No mission read, advance, cancel or
   decision was checked against the caller's business scope, so any authenticated
   caller could reach any mission.

## The authority path

```
cookie session (@/lib/auth)
  → actorFromSession(...)                        // ai-workforce/adapters
  → authorityFromAuthenticatedActor({ actor, humanActors })
       ├─ resolveHumanActor(userId) → HUMAN workforce actor   (fail closed)
       └─ createExecutionAuthority(...)          // workforce/execution
  → ExecutionAuthority (userId, actorId, actorSlug, actorType,
                        permissionTokens, accessibleBusinessSlugs,
                        isSuperAdmin, hasOfficeFinanceFull,
                        correlationId, requestedAt)
  → WorkforceCommandService / MissionAccessService
```

Every field is derived at the edge from the session and the resolved actor.
**No field is payload-settable.** `buildAuthorizedMissionCommand` takes
`requestedBy` (USER id) from the authority, sets `createdBy` and `owner` (ACTOR
ids) from the resolved actor — refusing any other `owner` — and drops payload
`userId` / `actorId` / `permissions` entirely. A supplied business reference is
resolved through the authoritative registry and authorised BEFORE it is written,
so `businessId` is always the canonical `Business.id`, never the raw payload
string.

## user → HUMAN workforce actor

`createConfiguredHumanActorResolver({ directory, mapping })` resolves one
authenticated user to exactly one registered HUMAN actor. It **fails closed**
with `AUTHORITY_UNRESOLVED` when:

- no actor is mapped to the user;
- the mapping is ambiguous (more than one actor);
- the mapped actor does not exist;
- the mapped actor is not `HUMAN` (an AI agent, executive or service identity can
  never be the human decision authority).

There is **no fallback impersonation**: an unmapped user is refused, not silently
treated as the Founder.

### LIMITATION — the roster is config-seeded

The workforce actor roster has no durable table yet (a documented architecture
gap, deliberately **not** invented in this batch). Until it exists, the mapping
is seeded from server configuration:

```
AI_WORKFORCE_USER_ACTOR_MAP='{"user_1":"actor_founder","user_2":["actor_ada"]}'
```

A malformed value is a startup error, not an empty map. An operator who does not
set it gets a **fail-closed** decision boundary (every decision refused with
`AUTHORITY_UNRESOLVED`) — never a working one that trusts nobody's identity.

## Canonical business scope — VERIFIED, not guessed

The session speaks business **slugs** (`getAccessibleBusinesses` → `"nexup"`,
`"rebound"`, `"abomazen"`). A mission row stores an opaque `businessId` that may
be a database **id** or a **slug**. Comparing the two directly is the bug this
batch removes.

The authoritative registry is the existing **`Business`** table (it owns both
`id` and `slug`). `prismaBusinessScopeResolver` resolves a reference to that row
via `OR: [{ id }, { slug }]`; `MissionAccessService` then authorizes the resolved
**slug** against `accessibleBusinessSlugs`. No second registry, no RLS, no
permissive mapping.

- A mission naming a business the server **cannot resolve** (unknown reference,
  or no registry configured) is **refused** (`BUSINESS_SCOPE_DENIED`), not
  treated as unscoped.
- A mission with **no** business is office-wide — there is no business to deny —
  matching `PermissionPolicy`.
- A payload business reference may **narrow** the caller's own scope; it can
  never **widen** it.

## Surfaces now scope-protected

| Surface | Route | Enforcement |
|---|---|---|
| Create / submit mission | `POST /api/ai-workforce/missions` | reference resolved + authorized; unverified id dropped |
| List / query missions | `GET /api/ai-workforce/missions` | every surface filtered to authorized missions server-side |
| Get mission | `GET /api/ai-workforce/missions/:id` | `authorizeMissionById` before the read |
| Advance / drain | `POST /api/ai-workforce/missions/:id` | `authorizeMissionById` before advancing |
| Decision queue | `GET /api/ai-workforce/decisions` | filtered to authorized missions |
| Decide | `POST /api/ai-workforce/decisions` | HUMAN check, then `authorizeReview` (review → task → mission → business) |

## 404-alike externally, typed internally

`BUSINESS_SCOPE_DENIED` and `MISSION_NOT_FOUND` both map to **HTTP 404**. But a
status alone is not enough: the route returns the error CODE, so a distinct code
would still reveal that an object EXISTS but is out of scope. The edge therefore
REDACTED the reason on the read/advance/decide surfaces:

- a cross-business mission is reported as `MISSION_NOT_FOUND`, with the same
  `{ error, message, details }` shape as a mission that does not exist;
- a cross-business review is reported as `APPROVAL_NOT_FOUND`, likewise.

The typed reason (`BUSINESS_SCOPE_DENIED`) is preserved on
`authorizeMissionById` / `authorizeReview` for safe internal logging; the
*ForCaller* variants — the ones the routes call — redact it. "Not yours" and
"not there" are now byte-identical on the wire.

## Identity fields after this batch — proven from repository truth

The audit's claim was checked against the code, not assumed. What the repository
actually says:

| Field | Vocabulary | Evidence in-tree |
|---|---|---|
| command/intent `requestedBy` | **USER id** | the route sets it from `session.userId`; `ai_command_intents.requestedBy` stores the authenticated user |
| mission `createdBy` | **ACTOR id** | every fixture/test writes `createdBy: "actor_founder"`; `MissionService` calls it "a createdBy actor"; the audit states `createdBy`/`owner` are actor ids |
| mission `owner` | **ACTOR id** | `resolveReviewer` looks `mission.owner` up in the `ActorRegistry` and only a HUMAN actor may decide |
| review `decidedBy` | **ACTOR id** | `ReviewService.decide` resolves `decidedBy` in the `ActorRegistry` |

So this batch does NOT normalise the fields; it keeps each field's meaning:

- `requestedBy` — the authenticated session USER id (`authority.userId`);
- `createdBy` — the resolved ACTOR id (`authority.actorId`);
- `owner` — the resolved ACTOR id (`authority.actorId`); a different owner is
  refused (`PERMISSION_DENIED`) because no delegation policy exists;
- review `decidedBy` — the resolved **HUMAN actor**, never `actor_founder` by
  construction, never a payload value.

`command-service` maps `createdBy: command.createdBy ?? command.owner ??
command.requestedBy`, so the LIVE path (which supplies an explicit actor
`createdBy`) never writes a UserId into an actor field, while an in-process
caller that only ever supplied actor ids keeps its previous behaviour.

### The proof of the vocabulary

- **Offline:** the focused suite uses `user_ada` (USER) and `actor_ada` (ACTOR),
  deliberately different strings, and asserts `requestedBy = user_ada` while
  `createdBy = owner = actor_ada`; a swapped payload yields a DIFFERENT command
  fingerprint, so the two vocabularies are not interchangeable.
- **HTTP:** a scoped session signed as `proof-user-1` creates a mission, and the
  row holds `createdBy = owner = actor_founder` (the ACTOR it resolves to) while
  `ai_command_intents.requestedBy = proof-user-1` (the USER).

## The cross-business HTTP proof

`scripts/run-api-http-proof.sh` now seeds two businesses (`nexup`, `rebound`) in
the schema database `@/lib/prisma` reads, plus a second HUMAN actor
(`AI_WORKFORCE_PROOF_HUMAN_ACTORS`), and runs `tests/workforce-api-http.test.ts`
against a real `next start` server with genuine signed, business-scoped sessions
(role `ADMIN`, one business each, plus the office-finance flag the legacy
route-prefix middleware requires). It proves, end to end:

- a slug-named mission persists the CANONICAL `Business.id` (not the slug);
- `createdBy`/`owner` are the resolved ACTOR id, `requestedBy` is the USER id;
- Business-A cannot GET/advance Business-B's mission (404-alike), and the
  response is the SAME body as a mission that does not exist;
- Business-A cannot decide Business-B's review (404-alike), same body as an
  unknown review;
- a same-business decision is recorded as the resolved HUMAN actor
  (`actor_proof_reviewer`), NOT `actor_founder`;
- payload `userId`/`actorId` are ignored, a payload `owner` naming anyone else is
  refused (403), and a payload business outside scope is refused (404).

The extra HUMAN actor is registered ONLY in proof mode — the same
`resolveApplicationRuntime` branch that binds the deterministic TEST transport,
which itself requires a verified `127.0.0.1` database. Production passes no
seeds, so this is neither a durable actor roster nor a production surface.

### The proof-actor safety invariant

The seeds are fenced at the POSTURE decision, not merely by which branch reads
them:

> `AI_WORKFORCE_PROOF_HUMAN_ACTORS` is honoured only when
> `AI_WORKFORCE_TEST_TRANSPORT=deterministic` AND persistence resolved to a
> verified loopback (`127.0.0.1`) workforce database. In any other posture — no
> transport override, an unsupported transport value, or a remote database —
> `resolveApplicationRuntime` returns `REFUSED` and the application refuses to
> boot (`RUNTIME_UNSUPPORTED`, HTTP 503). The variable is never silently
> ignored, and proof actors can never be registered into a normal runtime.

Refusing rather than ignoring follows THIS module's existing convention for
test-posture variables (`AI_WORKFORCE_TEST_TRANSPORT` is refused when it names
an unsupported value): an operator who set the seeds believes named HUMAN
authorities are registered, and a silent no-op would hide a misconfiguration
while leaving the decision boundary failing closed for a different reason than
the operator expects. There is no `actor_founder` fallback in either case.

`tests/workforce-step5a3-authority-scope.test.ts` pins the invariant over the
pure resolver, with no database: seeds + every non-proof posture → `REFUSED`
(including a `production`-target database), and seeds + `deterministic` +
loopback → `RUNTIME` (so the fence is a gate, not a blanket refusal).

## Not in this batch

No schema or migration change; no CapabilityExecutionService wiring; no dispatch
ordering change; no durable actor/capability/assignment registry; no Hermes,
Bridge or production contact. `isSuperAdmin` keeps its **existing** legacy
cross-business behavior (it mirrors `PermissionPolicy`); it was not given a new
bypass, and no "founder sees everything" shortcut exists.
