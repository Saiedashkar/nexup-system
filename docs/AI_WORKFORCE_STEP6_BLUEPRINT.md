# Step 6/8 — Command Center wiring blueprint

**Status: BLUEPRINT ONLY. Step 6 has NOT started.**
This document is a mapping plan. No Command Center file was changed, no
`fetch`/SWR/API call was added to `/command`, and no demo scenario was replaced.
`master` / `origin/master` remain at `bf701fac`. Production was not contacted or
mutated.

The goal: when Step 6 is approved, an implementer can wire the existing
`/command` surface to the real Step-2–5 lifecycle **without redesigning it** and
without inventing data. Everything below names the file that renders each
element, the mock it reads today, and the real contract it should read instead.

---

## 0. The one rule

The Command Center is a **read-and-decide** surface, not a second source of
truth. It must read through the same query ports the orchestrator writes
through (`src/modules/workforce/queries/command-center.ts`), over the same
repositories, so a screen and a mission can never disagree about what happened.
Where a real concept does not exist yet (departments, presence), the blueprint
says so rather than inventing one.

---

## 1. What is on screen today, and where it comes from

Every `/command` element reads a client-side model. There is **no network call**:
a search for `fetch(` / `/api/` / `axios` / `useSWR` under
`src/components/command` returns nothing, and the running page issues zero XHRs.

| Layer | File | Role |
|---|---|---|
| Store | `src/components/command/state/command-store.tsx` | `CommandProvider` / `useCommand`; holds the snapshot + scenario; `IS_DEV`; no I/O |
| Snapshot | `src/components/command/state/demo-scenarios.ts` | `buildSnapshot()` → `CommandVisualSnapshot`; `MOCK_PROJECTS`; `ApprovalEntry[]`; `ActivityEntry[]` |
| Organization config | `src/components/command/state/organization-model.ts` | `ORGANIZATION`, `DEPARTMENTS` (D1–D5), pods, workers, presence, deck actions |
| Actors | `src/components/command/state/actors.ts` | `ACTORS` — anonymous human/AI cast (role labels only) |
| Departments | `src/components/command/state/department-workspace.ts` | `departmentMissions(id)` — the mock mission rows `MOCK_PROJECTS` is projected from |
| EXEC | `src/components/command/state/exec-model.ts` | `EXEC_STATES`, EXEC copy ("mock content … no provider, no runtime, no database") |
| Command input | `src/components/command/state/mock-intent.ts` | Parser for the command bar text; produces a mock intent, never issues anything |

Rendered by: `organization/command-center.tsx` (`CommandHeader`, `CommandKpis`,
`CommandMissionsPanels`, `RecentActivity`), `organization/living-organization.tsx`,
`scene/*` (pods, EXEC core, systems, connections), `global-command-bar.tsx`,
`executive-dock.tsx`, `context-rail.tsx`.

---

## 2. The real contracts that already exist (nothing new is needed to read them)

These are live today behind the session guard. Each returns `401` when signed out
and `403` when the session lacks workforce access.

| Method + path | Returns | Route file |
|---|---|---|
| `GET /api/ai-workforce/missions` | `{ count, activeMissions[], executionStatus[], recentActivity[], decisionQueue[], lifecycle }` | `src/app/api/ai-workforce/missions/route.ts` |
| `POST /api/ai-workforce/missions` | issue a Command (`idempotencyKey`, `title`, `goal`, `tasks[]`) → `{ mission, …, replayed }` | same |
| `GET /api/ai-workforce/missions/[id]` | `{ mission, tasks, reviews, executions }` | `missions/[id]/route.ts` |
| `POST /api/ai-workforce/missions/[id]` | `{ action: "drain" \| "advance", wait? }` — settle in-flight / start next | same |
| `GET /api/ai-workforce/decisions` | `{ count, decisions[] }` — the human queue | `decisions/route.ts` |
| `POST /api/ai-workforce/decisions` | `{ reviewId, decision, note? }` → `{ mission, tasks, reviews, changes }` | same |
| `GET /api/ai-workforce/health` | persistence + routing status (no secrets) | `health/route.ts` |

The repository-side contract underneath is
`createCommandCenterQueries()` — `activeMissions` · `executionStatus` ·
`recentActivity` · `decisionQueue` · `snapshot`. It is **read-only by
construction** (only `get`/`list`/`listForMission`/`forTask`/`listPending`), which
is what makes it safe to expose to a page.

---

## 3. The mapping

`transform` = what the UI must do to a real row; `states` = loading / empty /
error the panel must render; `action` = whether the panel mutates anything.

### 3.1 KPIs — `CommandKpis` (`organization/command-center.tsx`)

| KPI | Mock source today | Real source | Transform | States | Action |
|---|---|---|---|---|---|
| Active Missions | `MOCK_PROJECTS.length` / snapshot | `GET /missions` → `activeMissions.length` | none (a count) | spinner / `0` / error chip | none |
| Awaiting Approval | snapshot `approvals.length` | `GET /decisions` → `count` | none | "Nothing is waiting" copy (already exists) | none |
| In Progress | snapshot department nodes | `activeMissions` where `tasks.RUNNING > 0` | sum `tasks.RUNNING` | `0` is a valid state | none |
| Execution Rate | hardcoded `19%` "rolling" | **no backend metric** — derive `terminal attempts with SUCCEEDED ÷ completed missions` from `executionStatus[]` | new, and its meaning must be defined before it ships | must show `—` when there is no history | none |
| AI Agents Online | hardcoded `4` | **no backend concept** — see §4 | — | — | none |

**Note.** Two of the five KPIs have no real source. Do not fake them: either
derive them from `executionStatus[]` (Execution Rate) or replace the label with a
real fact (registered actors, runtime health from `/health`).

### 3.2 Active Missions — `CommandMissionsPanels` + `RecentActivity`

| Column today | Mock (`ProjectEntry`) | Real (`MissionProgress` from `activeMissions[]`) | Transform |
|---|---|---|---|
| MISSION | `name` | `title` | direct |
| DEPARTMENT | `department` (D1–D5) | **none on a mission** | requires a decision — see §4 |
| PROGRESS | `progress` (0–100) | `tasks` counts | derive: `COMPLETED ÷ total` — or show a state chip instead of a bar |
| STATUS | `meta`/status chip | `state` (`PLANNING/RUNNING/WAITING/COMPLETED/…`) | map mission state → the existing chip vocabulary |

Also available and currently unused: `priority`, `owner`, `attempts`,
`decisionQueue`, `lastActivityAt` — enough for a real sort ("most recently
touched") and a "blocked on a human" marker.

| Panel | States | Action |
|---|---|---|
| Active Missions list | loading skeleton / "No active missions" / error row | none (read) |
| Recent Activity | loading / "Nothing has run yet" / error | none |
| Decision Queue | loading / existing "Nothing is waiting on your authority" copy | **APPROVED / REJECTED / NEEDS_REVISION** via `POST /decisions` |

### 3.3 Decision Queue — the only write path

The queue row today is `ApprovalEntry` (mock). Real row is `DecisionRow`:
`reviewId`, `missionId`, `missionTitle`, `taskId`, `taskTitle`,
`requestedAt`, `requestedBy`, `reviewerActorId`, `summary`.

- **Render:** `title = taskTitle ?? missionTitle`, `summary`, requester,
  requested age.
- **Act:** `POST /api/ai-workforce/decisions` with
  `{ reviewId, decision, note? }`. The service refuses a second decision
  (`APPROVAL_ALREADY_DECIDED`) and refuses a non-human decider — the UI must
  surface both as inline errors, not as a silent no-op.
- **Optimistic-safety:** no optimistic removal. Remove the row only after the
  response confirms, because a duplicate decision is a correctness error the
  human must see.
- **Realtime (optional, later):** poll `/missions` on focus; do not add a
  websocket for Step 6.

### 3.4 Command input — `global-command-bar.tsx` + `mock-intent.ts`

Today the bar parses text locally (`mock-intent.ts`) and dispatches nothing. The
real path is `POST /api/ai-workforce/missions`:

- the bar's text becomes the mission `goal` (and `title`); a **new
  `idempotencyKey` is generated per intentional submit** (`crypto.randomUUID()`),
  reused on retry only;
- the composer must refuse an empty goal locally (the API returns `400`);
- an idempotent replay returns the **same** mission with `replayed: true`; the UI
  must treat that as success, not as a duplicate error;
- after issue, the UI polls/reads `GET /missions/[id]` to show the plan forming.

`mock-intent.ts` should be reduced to *labeling* the typed text (which type of
mission it looks like) or deleted — it must not pretend to route work.

### 3.5 EXEC nucleus — `scene/exec-core.tsx` + `exec-model.ts`

EXEC's six states (`ready · thinking · routing · working · waiting · alert`) are
**copy, not data**. There is no EXEC service. Two honest options, decide before
Step 6:

1. derive a coarse EXEC state from real reads — `waiting` when
   `decisionQueue > 0`, `working` when any mission is `RUNNING`, else `ready`;
   `alert`/`thinking`/`routing` stay unclaimed; or
2. keep EXEC as a labelled decorative element and say so on the page.

Do not invent a "thinking" that no process is doing.

### 3.6 Departments, People & Actors, Connected Systems, organization graph

See §4 — these have no real backend concept and must not be fabricated.

---

## 4. Elements with NO real backend concept yet

These are drawn from mock configuration and would be **invented** if wired to
anything:

| Element | File | Why there is no real source |
|---|---|---|
| Departments **D1–D5** (Operations / Client & Delivery / Product & Tech / Growth & Revenue / Finance & Control) | `organization-model.ts` | A `Mission` carries `businessId`, `workspaceRef`, `projectRef`, `clientRef`, `owner`, `priority` — **no department**. There is no department entity anywhere in the domain or schema. |
| Spatial graph, pods, camera, connections | `scene/*`, `spatial-camera.ts` | Presentation only. |
| People & Actors roster | `actors.ts` (`ACTORS`) | The domain has **registered actors** (`actor-registry.ts`, `exec-actor.ts` = EXEC + Founder, `strategy-actor.ts`) but no roster-with-avatars and no per-actor presence. `Actor.runtime` (skills/tools/modelRoute) is explicitly reserved and unread. |
| Connected Systems | `scene/systems-layer.tsx` | No systems/integrations registry exists. |
| Recent Activity *feed* (human-level entries) | `demo-scenarios.ts` `ActivityEntry[]` | Real activity is **execution-level** (`recentActivity[]`: capability + status + attempt). There is no human/audit feed over HTTP today (the audit trail is per-execution). |
| "AI Agents Online" count | hardcoded | No live agent registry/presence. |
| "Execution Rate" rolling % | hardcoded | No metric; must be defined or derived (§3.1). |
| Motion Lab scenarios | `demo-scenarios.ts` (`DEMO_SCENARIOS`, `SCENARIO_ORDER`) | Dev-only visual harness. Keep as an explicitly `DEV ONLY` affordance; never wire. |
| Voice input | `global-command-bar.tsx` ("Voice input (mock)") | No speech pipeline. |

**Rule for Step 6:** an element with no real source either (a) stays visibly
labelled as a model/placeholder, or (b) is hidden. It is never pointed at a real
endpoint that does not mean that thing.

**Open design decision (owner input needed):** what does "department" mean for a
real mission? Options: map to `Business`/workspace, derive from `owner`'s actor,
or add a `department` field. This is the single largest unknown in Step 6 and it
blocks §3.2's DEPARTMENT column.

---

## 5. Suggested implementation sequence (for the Step-6 session, not now)

1. A `useWorkforceSnapshot()` read hook over `GET /api/ai-workforce/missions`
   with loading/empty/error, behind the existing `CommandProvider` — no visual
   change yet.
2. Wire **read-only** panels: KPIs (3 of 5), Active Missions, Recent Activity.
   Keep the mock model as an explicit fallback so a signed-out/demo viewer still
   sees something, and label the source on screen.
3. Wire the **Decision Queue** with `GET/POST /decisions` (the only mutation),
   with confirmed-removal and inline refusal errors.
4. Wire the **command input** to `POST /missions` with a per-submit idempotency
   key.
5. Only then revisit EXEC state (§3.5) and the department question (§4).
6. Leave departments/actors/systems/Motion Lab explicitly labelled until a real
   concept exists.

---

## 6. Acceptance for Step 6 (so "done" is falsifiable)

- `/command` performs real reads only when a session exists; signed out it
  renders the labelled mock fallback, not an error wall.
- Issuing one command from the bar creates exactly **one** mission and exactly
  **one** execution, verified in the database (`read-durable-mission.cjs`).
- Approving one decision from the queue moves the mission and, on a second
  click, surfaces `APPROVAL_ALREADY_DECIDED` instead of deciding twice.
- Empty states are reachable: a fresh database shows "no active missions",
  "nothing waiting on your authority".
- No secret, provider id or credential appears in any panel.
- No element in §4 is presented as real.

---

## 7. Guardrails carried into Step 6

- Do **not** replace `demo-scenarios.ts`; make it the fallback.
- Do **not** add a second source of truth; read through
  `createCommandCenterQueries` / the existing routes.
- Do **not** redesign the layout, and do **not** touch
  `/office/ai-workforce`.
- Production remains untouched; every read/write goes through the session guard.
