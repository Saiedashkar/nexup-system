# Step 5A-4 — corrections to the sixth review's findings, and to the seventh review's

**Status: NOT checkpoint-approved by the author of this document.** This is the corrected
tree, submitted for independent review. The seventh review's **P1 database-process
ownership defect is fixed** (exact `-D` argument matching and a start-time tie between the
lock-file pid and the server; `restart` stops gracefully first), together with the smaller
confirmed findings; the correction map, the regressions and the mutation evidence are in
**§8**, and the earlier sections that this changes say so where they are read. No migration was applied to any shared, staging or
production database; nothing was staged, committed, pushed, merged or deployed; no live
Hermes or provider call was made; no Product/EXEC/capital-fix file was edited. Any schema
change in this round remains a **proposal** and is named as such in §4.

Branch `feature/ai-workforce-foundation`, HEAD `4ecc1a7fd1a28f2a45d2dfbd32a878914133356f`.

---

## 1. P1 — repeated-recovery fairness

### 1.1 What was wrong

The fifth-review traversal was **one** page ordered "never observed first, then least
recently observed". That proves **first** discovery and says nothing about the **second**:
a steady arrival of `N` never-observed rows per sweep fills the page exactly, so a
previously observed row has **no unconditional bound**. The review reproduced it — a live
`DISPATCHING` claim reported `CLAIM_IN_PROGRESS` and stamped, whose owner crashed
immediately afterwards, was not revisited in 20 mission sweeps at 60 arrivals per sweep —
and it is correct that the review's own reproduction is starvation **with no backlog
growth**. The evidence statement "overload means latency, never invisibility" was false for
previously-observed rows; it is **withdrawn** in
`scripts/write-recovery-proof-evidence.mjs`.

### 1.2 The correction: an allocation, not a better order

The sweep's 50-row budget is split into **three windows**, and membership is decided by a
**predicate**. REVISIT is disjoint from the other two. UNSEEN and NEWEST are the **same
set** read from both ends, and the sweep **deduplicates** them — calling the three
"disjoint" was wrong and the seventh review is right to say so (§8.3):

| lane | predicate | order | quota (page 50) |
| --- | --- | --- | --- |
| `UNSEEN` | `recoverySweptAt IS NULL` | `claimedAt ASC, id ASC` | 25 |
| `REVISIT` | `recoverySweptAt IS NOT NULL` | `recoverySweptAt ASC, claimedAt ASC, id ASC` | 20 |
| `NEWEST` | `recoverySweptAt IS NULL` | `claimedAt DESC, id DESC` | 5 |

Arrivals are never-observed rows **by definition**, so no arrival rate can take one row of
`REVISIT`'s allocation. Records use the same shape with the two lanes that apply to them
(`NEVER_OBSERVED`, `PREVIOUSLY_OBSERVED`); the terminal filter and the lane predicate are
in the **query, before `LIMIT`**.

Code: `collectUnresolved` / `collectRecoverable` / `sweepLanes` in
`src/modules/workforce/execution/execution-reconciler.ts`; the lane SQL in
`listLane` (`src/modules/workforce/persistence/prisma-execution-claim-repository.ts`) and
`listRecoverable` (`src/modules/workforce/persistence/prisma-lifecycle-repositories.ts`).

Nothing was restored from process memory, no scan is unbounded, and no page limit was
raised: the page is still 50, and the only durable state is the per-row stamp written by
`markRecoverySwept` (authority, lease and CAS predicates are untouched — see §8.3).

### 1.3 The guarantee, stated exactly

With quotas `u = 25`, `v = 20`, `w = 5` and a scope `S`:

1. An unresolved row of `S` that **no** sweep has observed is reached within
   `ceil(unseen(S) / u)` sweeps of `S`. That window is FIFO, so the arrival rate does not
   enter the arithmetic; the `NEWEST` window additionally makes the `w` most recent ones
   visible on the next sweep.
2. An unresolved row of `S` that **has** been observed — a live `DISPATCHING` claim whose
   owner later crashed, a record whose run finished after its last observation, a permanent
   incident — is revisited within `ceil(observed(S) / v)` sweeps of `S`, because each sweep
   stamps every row it looked at and `REVISIT` reads the **oldest** stamps first. This is a
   strict round-robin over the observed-and-still-open set.
3. Both bounds assume that **sweeps repeat** and that the **persisted stamp advances**
   between them. That is *not* the same as "each sweep is its own transaction, so `now()`
   advances": `recoverySweptAt` is `TIMESTAMP(3)`, and two sweeps inside one millisecond
   carry the **same** stamp. Progress is therefore counted in **distinct stamps** (visits),
   with `(recoverySweptAt, claimedAt, id)` breaking ties, and the strict `ceil(queue/quota)`
   form additionally needs: rows ahead of the target not to keep arriving with an equal
   stamp and a **lower id**; concurrent instances sweeping one window to count as one visit
   (duplicate selection is duplicated work, not progress); and membership of the queue to be
   read as of the previous visit. Those four qualifications are stated in full in §8.4.
   None of them assumes an arrival rate. Sustained traffic lengthens `unseen(S)` and
   `observed(S)` — the backlog — and each bound is measured over the set it drains. What
   traffic can no longer do is push a waiting row behind an **unbounded** number of newer
   rows.
4. **Progress is SHARED, not scope-specific**, and deliberately so: the stamp is a property
   of the **row**, so a global sweep and a mission sweep advance the **same** rotation key.
   There is no per-scope cursor to store, evict, lose on restart, or count. The cost is
   stated rather than left to be discovered: an enclosing sweep can re-stamp a row and move
   it to the back of its own scope's `REVISIT` window. That cannot starve it, because **a
   stamp is a visit** — the sweep that stamped it reached the same per-row verdict a scoped
   sweep would have (recovery decisions are per row; the scope only decides which rows are
   in the window). The price is duplicated, idempotent work, which is the same trade every
   single-statement CAS in this ledger makes. Global and mission fairness are therefore
   **not** independent, but each is bounded on its own, which is what §1.4 measures.

### 1.4 The regressions (deterministic, real PostgreSQL)

`tests/workforce-step5a4-recovery-evidence.test.ts`, all green in §5, row 3:

* **claims, repeated recovery** — 60 already-observed, still-open claims **in the target's
  own mission** ahead of it (position 61 of the rotation), then 60 new claims **before every
  sweep** in other missions. The target is reached within `ceil(61/20)+1 = 5` sweeps, its
  row reaches the **durable** state `UNVERIFIED`, all 60 observed competitors are still
  being served, no attempt was redispatched and `starts === 0`.
* **records, repeated recovery** — the same shape with 55 eligible arrivals per sweep; the
  assertion is the durable one, a `RECONCILED` audit event appended to an attempt that was
  observed while still open.
* **global → mission and mission → global interference** — 8 rounds of 60 arrivals outside
  the mission, a global sweep, 60 inside it, a mission sweep. Both rows are asserted
  **inside the loop** (so a later round cannot hide a starvation) and both reach the durable
  doubt.
* **the 61-incident page** — every seeded id is reached across successive calls, with the
  cap **derived** from the scope's own unresolved count rather than chosen.
* the fourth- and fifth-review scenarios are unchanged and still green: the row-625 target
  with 60 arrivals before each sweep (globally and within one mission), the three-sweep
  stale-write interleaving, the record page's terminal filter before `LIMIT`, and 70 mission
  scopes continued by a second instance.

One correction to this round's own work is disclosed because it produced a false failure: an
earlier version of the 61-incident case measured progress as "rows reported by any sweep",
which other suites' rows could satisfy, so the loop stopped three rows early and the failure
looked like starvation. The progress counter is now scoped to this case's ids, and the
failure message prints the missing ids **and** the queue arithmetic.

---

## 2. P1 — database process ownership

### 2.1 What was wrong

`stillServing()` trusted any live pid named by `postmaster.pid`, and `destroy()` escalated
on `postgres.exe` as the image name. A stale pid file whose pid had been reused by **another
PostgreSQL cluster** passes both tests, so `hardStopCluster()` could force-kill a foreign
cluster's postmaster. The harness covered a foreign **non-PostgreSQL** process, which
deliberately avoids that branch.

### 2.2 The correction: positive ownership or nothing

`scripts/dev-db.mjs` answers **whose process** the lock file names, without signalling
anything (`ownershipOfLockfileProcess()`):

* **`OURS`** — the lock file records **this** data directory, the named process is a
  PostgreSQL postmaster, and **one** of two proofs ties **that pid** to **that directory**:
  (a) a live server **on our port** reports **our** `data_directory` **and** the pid's OS
  start time is that server's own `pg_postmaster_start_time()`; or (b) the pid's argv
  carries **our** directory as an exact `-D`/`--pgdata` **argument**. A start time on line 3
  of the lock file that disagrees with the named process is a refusal on its own.
* **`UNCERTAIN`** — a live process is named and neither tie holds. This is the two-cluster
  state the sixth review reproduced, **and** the neighbouring-path and port/pid states the
  seventh review reproduced.
* **`ABSENT`** — nothing is named, or what is named is gone.

The image name is **report-only** (`isPostmasterImage` is a necessary gate, never the
proof). The seventh review's two P1 defects are what §8.1–§8.2 correct: substring matching
of the data directory, and a port whose server was not tied to the pid being signalled.

Consequences:

* `destroy()` — **no automatic force escalation at all**. A graceful `pg_ctl stop` is issued
  **only** when the state is `OURS`, and only after a second reading immediately before the
  signal names the same pid; an `UNCERTAIN` process is neither stopped, nor killed, nor has
  its lock file cleared or overwritten. The delete is refused while anything may still be
  serving the directory, and the refusal names **no** kill command for an unverified pid.
* `down()`, `ensureCluster()` and `restart()` — the graceful stop is gated the same way. A
  refusal now **exits non-zero**; the previous version printed "not stopping anything" and
  still exited 0, which read as success.
* `stopForRestart()` (what `restart` calls, replacing the old `hardStopCluster`) — attempts
  a **verified graceful `pg_ctl stop` first**, waits for the pid to go, and escalates to
  `stopOwnPostmaster` only if that did not take, with ownership **re-proven at that moment**.
  If the force path cannot be re-proven, it refuses and preserves the data directory.
  `restart`'s documented purpose (clearing the Windows postmaster wedge) is preserved only
  for a cluster it can prove is its own — and it is no longer the first move.

### 2.3 The harness — two disposable runner-owned clusters

`scripts/run-http-proof-safety.sh`, case `ownership` (17 checks, all green in §5, row 1): cluster
**A** is a real data directory that is not running; its `postmaster.pid` is the file a crash
leaves behind — self-consistent (it records A's own data directory) but naming **B's** live
postmaster pid. Destroying A must:

* **fail closed** (non-zero exit) and say why,
* leave **A preserved** with its lock file untouched,
* leave **B alive**, **B still answering on its own port**, and **B's data intact**,
* suggest **no** manual kill of the unverified pid,
* and still delete the same A once that pid is genuinely gone — while a cluster this script
genuinely **owns** is still stopped and deleted normally, so the gate is not a blanket ban.

Case `prefix` (new, **37 checks — 19 prefix, 8 port-tie, 10 lifecycle — all green in §5, row
1**) reproduces the seventh review's P1 with
disposable clusters whose every path contains a **space**: `…/dat` (stopped, its lock file
naming the live postmaster of `…/data` and carrying that postmaster's real start time) and
`…/vault` against `…/vault-old`. `destroy`, `down` and `restart` must all be refused against
both, with the neighbour **alive and answering**, the stale directory preserved and its lock
file byte-identical. It then plants a **real foreign postmaster's pid** in an **owned,
running** cluster's lock file — writing **that foreign postmaster's own start time** on line 3,
so the file is self-consistent with the pid and the start-time cross-check passes — while the
configured port genuinely serves our data directory. The **only** evidence left that can
refuse is the server tie, and the check requires both the refusal **and** that its message
names the start-time disagreement. Finally the ordinary lifecycle of an owned cluster with a spaced path
(`start`, `down`, `start`, `restart`, `destroy`) must still work, and it does.

**The regression was proved to catch the defect.** The new case was run against a temporary
mutation that restored the reviewed substring test: **15 checks failed**, including "the
neighbour postmaster is STILL ALIVE" (it had been stopped) and "…/dat is PRESERVED" (it had
been deleted). The file was then restored byte-for-byte (SHA-256 compared before and after).
A regression that passes on the broken code would prove nothing.

### 2.4 Limits of this proof

It proves **refusal and preservation**, not that a wedged postmaster can always be
identified: on Windows the command-line proof uses `Get-CimInstance` then `wmic`, and if the
platform answers neither while the pid file records a different directory, the state is
`UNCERTAIN` and the command stops. `pg_ctl stop` is still a signal to the pid in the lock
file — it is simply now issued only after ownership is positively established.

Three limits are stated rather than hidden:

* **Verification is not atomic with the signal.** The evidence is read again immediately
  before `taskkill`/`kill -9`, which narrows the window in which the pid can exit and be
  reused, but the platform offers no pidfd, so a few milliseconds of that window remain.
* **The start-time tie is a two-second window.** A pid that is reused, or a foreign
  postmaster that starts, within the same two-second rounding window as ours cannot be told
  apart by start time. Both readings are of one startup, so the window is rounding, not
  "close enough" — but it is a window.
* **A command line the platform will not report** (`Get-CimInstance` returning empty, `ps`
  denied) leaves only the server tie; when the server is too wedged to answer either, the
  state is `UNCERTAIN` and the command refuses instead of escalating.

---

## 3. Evidence corrections

* **SHA-256 serialization.** The runner-safety checksum now comes from Node's own digest
  (`sha256_of`), not `sha256sum`'s backslash-prefixed first field, and the harness validates
  that the value is 64 hex characters **before** comparing it. The malformed
  ``\`` + 64-hex field is gone.
* **Working-tree counts** are derived from `git status --porcelain` by the evidence writer
  rather than counted by hand. Measured for this round: **41 modified tracked, 23 untracked,
  0 staged** (64 entries) — which matches the review's count and retracts the earlier
  handoff's "45 modified / 22 untracked". With this document added it is **41 / 24 / 0**,
  which is what the published artifact now records.
* **The counter itself was fixed, not just its output.** Auditing the recorded number found a
  real defect in the recovery evidence writer: its `git()` helper `.trim()`s the whole
  command output, which strips the leading space from the **first** porcelain line, and the
  first status column is data (`" M"` = modified in the worktree). One ordinary modification
  therefore made the artifact report **`staged: 1`** while nothing was staged. The writer now
  reads porcelain through `porcelainEntries()`, which keeps the two status columns, records
  each entry as `<XY> <path>`, and derives the counts from those same entries — so the count
  and the list it comes from are the same evidence. The published artifact now reads
  `total 65, tracked 41, modified 41, untracked 24, staged 0`, and `git diff --cached
  --name-only` is empty.
* **Skips are measured and explained, and the previous claim is withdrawn.** A bare
  `npx vitest run` (all 32 test files) reports **559 tests: 475 passed, 0 failed, 72
  skipped**, exit **1** — and that non-zero exit is *solely* 16 uncaught connection errors
  (`ECONNRESET` / `Connection terminated unexpectedly`) raised while the capital suites ran
  against their fixture database `capital_test` on `127.0.0.1:5435`. A listener is present on
  that port, so this is not "nothing there"; that fixture simply was not in the state those
  suites expect. **No assertion failed**, and neither capital file nor any capital module is
  touched by this work, so it was not investigated further as part of this change. The
  AI-Workforce subset
  (`npx vitest run tests/workforce-*.test.ts tests/ai-workforce-*.test.ts`) reports, measured
  through vitest's JSON reporter after this round, **474 tests: 390 passed, 0 failed, 72
  skipped, 12 pending, exit 0** — 474 = 390 + 72 + 12, with the four extra passing tests
  this round's `sweepLanes` cases add to `workforce-step5a4-correction-p1.test.ts`. The
  review's own arithmetic for the tree it read — **470 = 386 + 72 + 12** — is therefore
  confirmed, and the earlier "386 passed + 72 skipped = 470" was incomplete: `pending` is
  a third bucket, not a synonym for `skipped`. The 72 skips are
  `describeIfDatabase` / `describeIfServer` / `describeIfLive` blocks gated on
  `AI_WORKFORCE_TEST_DATABASE_URL` (plus `AUTH_SECRET` for the HTTP suite and
  `liveRequested` for the live suites), by file:

  | file | skipped | of |
  | --- | --- | --- |
  | `tests/ai-workforce-persistence.test.ts` | 3 | 3 |
  | `tests/workforce-api-http.test.ts` | 16 (9 skipped + 7 pending) | 16 |
  | `tests/workforce-step3-e2e.test.ts` | 3 | 9 |
  | `tests/workforce-step4-async.test.ts` | 1 | 19 |
  | `tests/workforce-step4-live-cancel.test.ts` | 1 | 1 |
  | `tests/workforce-step5-adoption.test.ts` | 9 | 9 |
  | `tests/workforce-step5-app-integration.test.ts` | 6 | 6 |
  | `tests/workforce-step5-app-restart.test.ts` | 4 | 4 |
  | `tests/workforce-step5-live-durability.test.ts` | 1 | 1 |
  | `tests/workforce-step5-mission.test.ts` | 1 | 12 |
  | `tests/workforce-step5-persistence.test.ts` | 9 | 9 |
  | `tests/workforce-step5a-durable-claim.test.ts` | 17 (12 skipped + 5 pending) | 18 |
  | `tests/workforce-step5a4-recovery-evidence.test.ts` | 13 | 13 |

  These are not disabled tests: the runners **set the variable**, so the same blocks run —
  the recovery suite **13/13 with 0 skipped**, the HTTP suite **16/16 with 0 skipped**. The
  earlier handoff's "no checks were skipped" was wrong as written and is retracted.

  The **12** the review resolved are **pending**: tests nested inside a `describeIfDatabase`
  block whose parent never runs. **Seven** are the HTTP suite's "business scope over real
  signed sessions" cases; **five** are the durable-claim suite's "the cancellation
  reservation is ONE atomic, terminal write" cases (`workforce-api-http.test.ts` 9 skipped +
  7 pending = its 16; `workforce-step5a-durable-claim.test.ts` 12 skipped + 5 pending + 1
  ungated = its 18). The previous paragraph's identification of the 12 with one file's skip
  count was wrong in label, not in count, and is corrected here. All twelve **ran and
  passed** in the dedicated runs below. Which runner exercises which gated block, so the
  counts can be checked rather than believed:

  | gated file | skips | exercised by |
  | --- | --- | --- |
  | `workforce-step5a-durable-claim.test.ts` | 17 (12 skipped + 5 pending) | `run-persistence-proof.sh` with `PROOF_TEST=tests/workforce-step5a-durable-claim.test.ts` (measured: 18/18 passed, 0 skipped, 0 pending) |
  | `workforce-step5a4-recovery-evidence.test.ts` | 13 | `run-recovery-proof.sh` (measured: 13/13 passed, 0 skipped) |
  | `workforce-api-http.test.ts` | 9 | `run-api-http-proof.sh` (measured: 16/16 passed, 0 skipped) |
  | `workforce-step5-app-integration.test.ts` + `-app-restart.test.ts` | 6 + 4 | `run-app-proof.sh` |
  | `workforce-step5-persistence.test.ts` | 9 | `run-persistence-proof.sh` (its default) |
  | `workforce-step5-adoption.test.ts`, `step5-mission`, `step5-live-durability`, `step3-e2e`, `step4-async`, `step4-live-cancel`, `ai-workforce-persistence` | 9, 1, 1, 3, 1, 1, 3 | the same gates; the live (`liveRequested`) ones additionally need a real daemon, which this work deliberately did **not** contact |
* **PHASE_5 scope.** `prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/migration.sql` is
  PROPOSED: not registered in `prisma/migrations/`, not applied to any shared or production
  database. It **was** applied to the **disposable** databases the runners create and destroy
  themselves, which is how the durable rotation was measured — the file's header now says
  exactly that, and the "not applied to any database" wording is corrected.
* **Manifests verified independently** (`node scripts/verify-evidence-manifest.mjs`):
  recovery `d5c5e91c…`, HTTP boundary `bba5cb59…`, runner safety `e8203cd6…` — all
  `manifest-state: ok`, exit 0 (§5, row 11). Each digest is over **sorted paths and content
  hashes** of a fixed file list, and is re-derived by that reader rather than trusted from
  the artifact. The digests moved this round (`2df7d8e0…`, `aecc3a77…`, `553f2b7f…` before
  it) **because** the scripts they fingerprint were corrected: the manifest going stale when
  a proof script changes is the property being relied on, not a nuisance.

---

## 4. Anything further that changes schema

None. PHASE_5 remains the only schema proposal in this round: two nullable, no-default
`TIMESTAMP(3)` columns (`recoverySweptAt`) and two single-column indexes, one per table.
It is **additive-only** (`verify-proposed-migration.mjs` exit 0) and `prisma validate`
is green.

---

## 5. Validation actually run (command → observed result)

Everything below is THIS round's run, on the tree this document describes.

| # | command | observed result |
| --- | --- | --- |
| 1 | `bash scripts/run-http-proof-safety.sh` | **exit 0**; **102 checks passed, 0 failed**, 15 cases: the 11 earlier ones plus `prefix-path-refusals`, `prefix-path-reverse`, `owned-cluster-lifecycle`, `port-tie-refusal`; published manifest `e8203cd6…`, `manifest-state: ok` |
| 2 | `bash scripts/run-api-http-proof.sh` | **exit 0**; **16/16 passed, 0 skipped**; the build stage inside it succeeded (`prisma generate` + `next build`); manifest `bba5cb59…`, `ok` |
| 3 | `bash scripts/run-recovery-proof.sh` | **exit 0**; **13/13 passed, 0 skipped**; manifest `d5c5e91c…`, `ok` |
| 4 | `PROOF_TEST=tests/workforce-step5a-durable-claim.test.ts bash scripts/run-persistence-proof.sh` | **exit 0**; **18/18 passed** — including the **five pending** cancellation cases, executed for real |
| 5 | `npx vitest run tests/workforce-step5a4-correction-p1.test.ts` | **exit 0**; **33/33** (29 from the previous round + the four new `sweepLanes` cases) |
| 6 | `npx tsc --noEmit` | **exit 0** |
| 7 | `npx eslint src/modules/workforce/execution/execution-reconciler.ts tests/workforce-step5a4-correction-p1.test.ts` | **exit 0**. **Repository-wide ESLint is NOT green** — pre-existing errors/warnings in unrelated code |
| 8 | `node scripts/verify-proposed-migration.mjs prisma/proposed-migrations/AI_WORKFORCE_PHASE_5/migration.sql --allow=ai_execution_claims,ai_execution_records` | **exit 0**: additive-only, no destructive statement, both ALTERs target tables the file creates |
| 9 | `npx prisma validate` | **exit 0** |
| 10 | `npx vitest run tests/workforce-*.test.ts tests/ai-workforce-*.test.ts` (JSON reporter) | **474 tests: 390 passed, 72 skipped, 12 pending, 0 failed, exit 0** (§3, §8.6) |
| 11 | `node scripts/verify-evidence-manifest.mjs <artifact>` ×3 | **exit 0** each: recovery `d5c5e91c…`, HTTP `bba5cb59…`, safety `e8203cd6…` |

**What is NOT a passing check this round.** The repository-wide `npx vitest run` was **not
completed**: it exceeded ten minutes in the capital suites, whose fixture on
`127.0.0.1:5435` raises uncaught connection errors (the same 16 `ECONNRESET` /
"Connection terminated unexpectedly" errors measured in the previous round, with **0
assertion failures**). No capital file is touched by this work. That is reported as a
limitation, not as a pass.

**Environment disclosure.** The safety harness's scratch was moved to a different volume
(`PROOF_SAFETY_DIR=D:/nexup-proof-safety`) for the final full run: the system volume had
under 1 GB free, an earlier full attempt aborted when `initdb` ran out of space on it (the
case-9 setup now reports that instead of dying silently), and one `next build` attempt in an
even earlier run died with **exit 134**. With the scratch on a volume with space, the full
sweep passed 102/0. Nothing about the product or the proof logic was changed to accommodate
this.

Runner-side facts, for a reader who wants to check the claims rather than the summary: every
proof above ran against a cluster the script created with `initdb` in its own run directory
on an auto-allocated loopback port, with no shared or production database and no live
provider call; the run directories were removed after verified shutdown.

---

## 6. Final tree identity

* Branch `feature/ai-workforce-foundation`, HEAD
  `4ecc1a7fd1a28f2a45d2dfbd32a878914133356f`.
* `git status --porcelain`: **41 modified tracked, 24 untracked, 0 staged** — the same SHAPE
  as the checkpoint the seventh review read (no file added or removed this round), recorded
  by this round's recovery artifact with its status columns intact and independently
  confirmed by `git diff --cached --name-only` being empty.
* `git status --porcelain | sha256` → `a18dc5d66e04d1e400b9827bee264f4a9b45323cf5144f69a07a46acee2dee51`
  — **unchanged from the reviewed tree**, which is the direct evidence that the correction
  added no path and staged nothing.
* `git diff | sha256` → `e8aea9db78d161feeceb6faf8cf97d0ae4547dc947d783411fceeb774d8a81df`
  (tracked files only; it moves with every tracked edit, so it is a fingerprint of this
  handoff, not a contract). The reviewed tree's value was `8515b979…`.
* **Canonical changed-content manifest.** 65 paths changed (41 modified + 24 untracked, so
  the untracked files are IN it). Sorted `<sha256>  <path>` rows over working-tree content,
  then SHA-256 of that text, **excluding this document** (which describes the tree rather
  than being part of the change under review, and would otherwise make its own digest
  self-referential): **64 files →**
  `bfa61d088f98e008d046ee67ad68531b945b003ab459d0f236ca16e360ea2c81`. The reviewed tree's
  equivalent was `fb33f1d1…` over the same 65 paths; the path SET is unchanged, only content
  moved.
* Nothing staged, committed, pushed, merged or deployed; no shared or production migration;
  no Product/EXEC/capital-fix edit; no live Hermes or provider call.

---

## 7. Still not established (unchanged by this round)

* **Migration before code.** PHASE_5 must be registered and approved through the project's
  real migration workflow and applied **before** this code is deployed — the adapters read
  and write `recoverySweptAt`, so a deployment carrying the code without the column cannot
  run the rotation at all. Prisma Client must be regenerated in that deploy build.
* **Index evidence.** The two indexes are single-column and are **not** claimed to be optimal
  for a page that also orders by `claimedAt`/`id` and filters on state and `missionId`:
  realistic `EXPLAIN (ANALYZE, BUFFERS)` evidence and a decision about non-concurrent index
  creation are owed at activation.
* **Scheduling.** Recovery should be scheduled and monitored only after that; a green test
  run is not an activation.
* **Live Hermes.** The offline artifact present here is the bridge's pinned-profile and
  method allowlist; the **live daemon's own tool list** is not in this worktree, so
  runtime-wide protection inside the Hermes profile remains an operator-side check.
* **Duplicated work.** The shared rotation key means an enclosing and a scoped sweep covering
  the same rows in the same window can both act on them — idempotent, and documented in the
  reconciler rather than hidden.

---

## 8. Seventh review — the confirmed corrections, and how each was proved

### 8.1 P1: a prefix path authorized the wrong postmaster

**The defect.** `commandLineNamesOurDataDirectory()` normalised separators and asked whether
the command line **contained** the configured data directory. `…/dat` occurs inside
`…/data`, so a stopped cluster at `…/dat` whose stale lock file named the live postmaster of
`…/data` was classified `OURS`; `destroy` then stopped that neighbour, deleted `…/dat` and
reported success. `down` used the same decision, and `restart` reached it through
`hardStopCluster()`, which force-killed with `taskkill /F /T` or `kill -9` and never tried a
graceful stop.

**The correction — exact arguments, not containment.**

* `parseCommandLine()` tokenises the command line into **argv**, honouring double quotes on
  every platform and single quotes on POSIX (which is how `pg_ctl` quotes a path containing a
  space). A backslash-escaped quote inside an argument is not modelled: it fails to match,
  which is `UNCERTAIN`, which is a refusal — the safe direction.
* `commandLineDataDirectories()` extracts only the values of `-D`, `--pgdata`,
  `--pgdata=<dir>` and `-D<dir>`. `commandLineNamesOurDataDirectory()` requires one of them
  to be the **same path** as the configured directory (`samePath`: separators normalised,
  trailing slashes dropped, realpath when it exists, case-folded only on Windows).
  Containment is gone; there is no substring test left in the file.
* `ownershipOfLockfileProcess()` still requires the lock file's own second line to record
  **our** directory and the named pid to be a **PostgreSQL postmaster**. Beyond that, `OURS`
  needs one of two ties between *that pid* and *that directory* (§8.2), and a line-3 start
  time that disagrees with the named process's start time is a refusal on its own — it is
  what a reused pid looks like.

**The correction — signals are re-proved at the moment they are sent.**

* `stopOwnPostmaster(pid)` calls `ownershipOfLockfileProcess()` **again** immediately before
  `taskkill`/`kill -9` and returns without signalling unless the state is `OURS` for that
  same pid. It reports whether it signalled.
* `clearStalePostmaster()` no longer removes the lock file when that re-proof fails while the
  pid is still alive: it refuses and leaves the file untouched — a file that cannot be shown
  to describe a dead cluster is evidence, not litter.
* `stopForRestart()` replaces `hardStopCluster()`: a verified **graceful** `pg_ctl stop -w`
  first, a bounded wait for the pid to disappear, and force **only** when the graceful stop
  did not take and ownership can be re-proven at that moment. If it cannot, the command
  throws and the data directory is preserved.
* `destroy()` re-reads ownership immediately before its graceful stop, so the pid `pg_ctl` is
  about to signal is the pid the evidence came from.
* `down()` now **exits non-zero** on a refusal. It used to print "not stopping anything" and
  exit 0, which a caller reads as success.

### 8.2 P1: a server on the port did not authorize the pid in the lock file

The sixth review's server proof — "a live server on our port reports our `data_directory`" —
is a statement about **a process**, not about **the pid in the lock file**, and the seventh
review is right that it authorized the wrong one. The two are now tied by **start time**:
`pg_postmaster_start_time()` from the server against the named pid's own age
(`processAgeSeconds`, from `Get-Process`/`ps -o etimes`). A disagreement is `UNCERTAIN` and a
refusal, reported with both readings. The regression plants a lock file carrying the
**foreign** postmaster's OWN start time on line 3, so the file's internal cross-check passes
and the tie is the only evidence left; the check asserts that the refusal message names the
start-time disagreement, i.e. that the tie — not something incidental — did the refusing.

Two implementation facts are recorded because the first version was wrong:

* **Age, not an absolute timestamp.** Converting `Get-Process`'s `StartTime` to UTC produced a
  value **two hours out** on this machine, so an owned cluster was refused as "a reused pid".
  The new lifecycle case caught it; an untested correction would have shipped a regression.
  A duration needs no time zone, so both sides are measured as ages and converted with the
  same `Date.now()`.
* **The window is two seconds, and it is rounding, not tolerance.** Both readings describe
  one startup, so they differ only by truncation to whole seconds. A wider window would begin
  accepting a foreign postmaster that started around the same time; a reused pid inside the
  same two-second window still cannot be told apart, and that residual is stated in §8.9.

`isPostmasterImage()` is a necessary gate and is never the proof (a foreign cluster's
postmaster has the same image). `isPostmasterProcess()` — a second OS lookup that re-derived
the image just to answer the same question — is gone.

### 8.3 Smaller finding: the lane floors overspent a small budget

`sweepLanes()` gave **every** lane a floor of one row, so `sweepLanes(1)` returned 1 + 1 + 1
and a caller's `limit` was not a limit (the review found it at 1, 2 and 3). It now:

* clamps through `sweepBudget(limit)`: `0`, negative, `NaN` and `Infinity` buy **nothing**; a
  fractional limit is floored; anything above the 50-row page is the page;
* keeps 25 / 20 / 5 at the sweep's own page size, and trims in the **reverse of the
  consumption order** (NEWEST, then REVISIT, then UNSEEN) when three floors do not fit, so
  the total is exactly the requested budget: `1 → 1/0/0`, `2 → 1/1/0`, `3 → 2/1/0`,
  `4 → 2/1/1`;
* is used by `collectUnresolved` **and** `collectRecoverable`, both of which return `[]` for a
  zero budget instead of silently reading a row. The record page reads UNSEEN + REVISIT and
  is capped at the requested total, because it has no freshness lane;
* is exported, and asserted directly by four new cases in
  `tests/workforce-step5a4-correction-p1.test.ts` — totals at 0…50, the small-budget
  allocation, invalid budgets, and the unchanged 25/20/5. That suite is 33/33 in §8.8.

### 8.4 Smaller finding: the fairness bound needed its assumptions

The review is right that "a new transaction guarantees `now()` advances" is too strong at
`TIMESTAMP(3)`. `collectUnresolved`'s doc comment now states the strict form with all four
assumptions, and §1.3 is corrected:

1. **Stamps advance** — progress is counted in distinct `recoverySweptAt` values (visits).
   Two sweeps inside one millisecond share a stamp; ties are ordered by `(claimedAt, id)`.
2. **Ordering** — the bound counts rows sorting before the target. A continuing arrival with
   an equal stamp and a **lower id** sorts ahead of it.
3. **Concurrency** — two instances selecting the same window duplicate work; the bound counts
   distinct progress epochs, not calls.
4. **Membership** — stated over the rows ahead of the target as of the previous visit; rows
   that resolve only shrink the set.

Also corrected: UNSEEN and NEWEST are the **same** set read from both ends, deduplicated by
the sweep (so a page can return fewer than `u + v + w` rows when the unseen set is small);
only REVISIT's separation is structural. The "three **disjoint** windows" sentence in §1.2
and the code comment that said "the windows cannot overlap" are both fixed.
### 8.5 Smaller finding: the runner discarded the caller's cluster directory

`run-api-http-proof.sh` declared its resources empty (`DEV_DB_DIR=""`) **before** the
caller-managed branch read `${DEV_DB_DIR:-…}`, so a caller that supplied both `DEV_DB_PORT`
and `DEV_DB_DIR` was reported against the **default** directory. The caller's value is now
captured as `CALLER_DEV_DB_DIR` before the reset and used in that branch. `OWNS_CLUSTER`
stays `0` for a caller-managed cluster, so the cleanup boundaries are unchanged: that
directory is **metadata only** and is never stopped, deleted or otherwise touched.

### 8.6 Smaller finding: the aggregate accounting was incomplete

474 = 390 passed + 72 skipped + **12 pending**, exit 0. Before this round's four new tests
the same measurement was 470 = 386 + 72 + 12, which is the reviewer's arithmetic. The 12 are
seven nested HTTP business-scope cases and five nested cancellation cases; every one of them
ran — and passed — in the dedicated HTTP and durable-claim runs. §3 carries the corrected
table and the corrected identification of the 12.

### 8.7 Correction map — every file this round touched

| file | what changed |
| --- | --- |
| `scripts/dev-db.mjs` | exact-argv data-directory matching; start-time tie (server ↔ lock-file pid); lock-file start-time cross-check; re-proof before every signal; graceful-first `stopForRestart`; refusal exit codes for `down`; header and ownership comments; `isPostmasterImage` replaces `isPostmasterProcess` |
| `scripts/run-http-proof-safety.sh` | new case `prefix` (37 checks: `…/dat` vs `…/data`, `…/vault` vs `…/vault-old`, spaced paths, foreign postmaster pid on our own port, owned lifecycle start/down/restart/destroy); cluster cleanup through the EXIT trap with newline-separated paths; `FOREIGN_PIDS` defined before the trap so an early exit cannot mask its own cause; top-level `pg_tool`/`INITDB_BIN`/`PG_CTL_BIN`/`PSQL_BIN` |
| `src/modules/workforce/execution/execution-reconciler.ts` | `sweepBudget`, corrected `sweepLanes` (exported), `collectUnresolved`/`collectRecoverable` respect the budget, corrected lane-overlap and fairness-assumption comments |
| `tests/workforce-step5a4-correction-p1.test.ts` | four `sweepLanes` cases (29 → 33 tests) |
| `scripts/run-api-http-proof.sh` | `CALLER_DEV_DB_DIR` preserved with `OWNS_CLUSTER=0` |
| `docs/evidence/step5a4-sixth-review-corrections-2026-10-15.md` | this round's corrections, the qualified bounds and the corrected accounting |

No schema change, no migration, no recovery redesign and no single-flight window: the scope
of this round is exactly the review's findings.
### 8.8 Validation for this round (measured, with exit statuses)

| check | result |
| --- | --- |
| `bash scripts/run-http-proof-safety.sh` (full sweep) | **exit 0 — 102 checks passed, 0 failed**, 15 cases; manifest `e8203cd6…`, `manifest-state: ok` |
| `bash scripts/run-api-http-proof.sh` | **exit 0 — 16/16 passed, 0 skipped** (build inside it exit 0); manifest `bba5cb59…`, `ok` |
| `bash scripts/run-recovery-proof.sh` | **exit 0 — 13/13 passed, 0 skipped**; manifest `d5c5e91c…`, `ok` |
| `PROOF_TEST=tests/workforce-step5a-durable-claim.test.ts bash scripts/run-persistence-proof.sh` | **exit 0 — 18/18 passed**, including the five pending cancellation cases |
| `npx vitest run tests/workforce-step5a4-correction-p1.test.ts` | **exit 0 — 33/33** |
| `npx vitest run tests/workforce-*.test.ts tests/ai-workforce-*.test.ts` | **474 = 390 passed + 72 skipped + 12 pending, 0 failed, exit 0** |
| `npx tsc --noEmit` | **exit 0** |
| scoped `npx eslint` over the changed TS files | **exit 0** |
| PHASE_5 additive verifier | **exit 0** |
| `npx prisma validate` | **exit 0** |
| three evidence manifests re-verified | **exit 0** each |
| subset run of the new case against a temporary mutation restoring the reviewed substring test | **15 checks FAILED** (including the neighbour postmaster being killed and `…/dat` being deleted), then the file was restored and its SHA-256 matched the fixed version |

**Not a pass:** the repository-wide vitest run did not finish within ten minutes because of
the capital fixture's connection errors (0 assertion failures); the capital files are
untouched by this work and were not investigated here. Repository-wide ESLint is not green
either — pre-existing, unrelated.

### 8.9 Remaining limitations, stated as limits

* **The check is not atomic with the signal.** Ownership is re-established immediately before
  `taskkill`/`kill -9`, but this platform offers no pidfd, so a pid that exits and is reused
  inside those milliseconds is not distinguishable. The window is small; it is not zero.
* **The start-time tie is a two-second window** — rounding, not slack. A foreign postmaster
  that starts inside the same two seconds as the pid being authorized cannot be separated by
  this method.
* **A command line the platform will not report** (`Get-CimInstance` empty, `ps` denied)
  leaves only the server tie; with a wedged server the state is `UNCERTAIN`, so `restart`
  refuses instead of clearing the wedge. That is the intended fail-closed direction, but it
  means the Windows-wedge escape hatch now requires a cim/wmic answer.
* **The force-escalation branch is not exercised end-to-end.** The suite exercises its
  ownership gate (the refusals, `destroy`/`down`/`restart` on foreign, prefix and port-tied
  state) and the graceful path (`start`, `down`, `restart`, `destroy` on owned clusters with
  spaced paths), but no test creates a postmaster that survives a graceful stop, because
  wedging a cluster deliberately is exactly the kind of unsafe fixture this work avoids.
* **POSIX quoting is implemented but only Windows was exercised here.** The tokenizer honours
  single quotes for the `sh -c` form `pg_ctl` uses on Unix; that path was not run on this
  machine.
* **Disk pressure shaped the run environment** (see §5): the system volume was below 1 GB
  free, one `initdb` and one build failed on space before the final run, which used a scratch
  volume with room. No product or proof logic was changed for it.
* **Activation prerequisites are unchanged** (§7): PHASE_5 still has to be registered,
  approved and applied before deploying this code, Prisma Client regenerated, `EXPLAIN`
  evidence produced, recovery scheduled and monitored, and the live Hermes daemon tool
  inventory verified.
