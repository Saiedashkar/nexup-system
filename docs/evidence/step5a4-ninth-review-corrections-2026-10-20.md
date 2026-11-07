# Step 5A-4 — ninth-review corrections (P1, P2, P3)

**Date:** 2026-10-20
**Branch:** `feature/ai-workforce-foundation`
**Scope:** the three CONFIRMED ninth-review findings only. No staging, commit, push, merge,
migration, deployment or provider call was performed; no shared or production resource was
touched.

Verdict for this batch: **the three findings are corrected and covered by focused
regressions.** One host-level flake was found in the real-cluster force-cleanup path (not one
of the three findings) and is reported, not fixed, in §5.

---

## 1. Correction map

### P1 — repeated `-D`/`--pgdata` options can authorize the wrong cluster

**Defect.** `dev-db-ownership.mjs` collected EVERY data-directory option and authorised the
pid if ANY one of them matched (`dataDirectories.some(...)`). PostgreSQL honours the LAST
repeated option, so a foreign postmaster launched as
`postgres -D C:\review-first -D C:\review-last`, really serving `C:\review-last`, was accepted
by both the initial inspection and the signal-time revalidation whenever its earlier,
INEFFECTIVE `-D` named the reviewed directory. Every signalling command inherited the bypass:
`start`/`up` (`ensureCluster` → `clearStalePostmaster`), `restart` (`stopForRestart`), `down`
(`stop`) and `destroy`.

**Correction — fail closed on anything that is not ONE exact option.**

| Where | What changed |
| --- | --- |
| [scripts/dev-db-ownership.mjs:168](../scripts/dev-db-ownership.mjs#L168) | `dataDirectoriesFromArgv()` — the "collect every value" helper whose `.some()` built the bypass — is **removed** and replaced by `dataDirectoryOptions(argv) → { options, problems }`. It parses the four spellings this gate understands (`-D <dir>`, `-D<dir>`, `--pgdata <dir>`, `--pgdata=<dir>`) in order, and reports a `problem` for **more than one** occurrence (any mix, any order), a `-D`/`--pgdata` with no value, an empty value, and any `--p`/`--pgd`/`--pgdat…` spelling that a prefix-accepting parser could read as `--pgdata`. |
| [scripts/dev-db-ownership.mjs:498](../scripts/dev-db-ownership.mjs#L498) | `inspect()` decides **ambiguity first**, before any comparison, so a matching earlier option can never stand in for the option PostgreSQL actually honours. The single-option match is at [:525](../scripts/dev-db-ownership.mjs#L525) and reads `dataDirectories[0]` — there is no `some()` anywhere in the decision. |
| [scripts/dev-db-ownership.mjs:38-58](../scripts/dev-db-ownership.mjs#L38) | Module overview gains finding **P1-6**; the ownership clause in `inspect()`'s contract now reads "EXACTLY ONE `-D`/`--pgdata` option". |
| [tests/dev-db-ownership.test.ts:228](../tests/dev-db-ownership.test.ts#L228) | New regression block: parser forms, every repeated/mixed/ambiguous form, the gate refusing each from **both** the reviewed and the foreign directory's point of view, the ordinary single-option lifecycle, and neighbour/differ-by-one-suffix refusals. |
| [tests/dev-db-ownership.test.ts:596](../tests/dev-db-ownership.test.ts#L596) | Structural regression that the five commands still enter the shared gate (`ensureCluster` → `clearStalePostmaster`; `stopForRestart`, `stop`, `destroy` → `ownershipOfLockfileProcess`), and that the harness no longer references the removed collect-everything helper. |

**Why refuse rather than implement last-wins.** The reviewer's `-C data_directory` probe proves
PostgreSQL uses the last repeated option, but an ownership decision that may signal a live
process must not rest on a re-implementation of the option parser — including its placement
rules, its `--NAME=VALUE` path and any per-version differences. A postmaster's argv is never
legitimately ambiguous, so the gate refuses, which is the only answer a signal may rest on.
Cost: a postmaster launched with repeated `-D` is unmanageable by these commands (fail closed,
never a wrong kill).

**A measured premise correction.** PostgreSQL 18.6's own `--help` (verified on this host)
lists **no `--pgdata` long option** for `postgres`; its long options are `--version`,
`--describe-config`, `--help` and the generic `--NAME=VALUE` run-time parameter form. Measured
on this host: `postgres --pgdata=<dir>` → `unrecognized configuration parameter "pgdata"`, and
`postgres --pgdata <dir>` → `--pgdata requires a value`. So on this version `--pgdata` cannot
reach a running postmaster at all. The gate still accepts the `--pgdata` spellings as an
**over-approximation** (a refusal costs nothing; an acceptance costs a cluster) and still
refuses abbreviations, but it no longer claims a getopt_long behaviour it has not measured:
the comment names what was observed and refuses to decide the rest.

### P2 — the real-cluster proof could report `ok` after a setup failure

**Defect.** A setup exception (`initdb` failing, a missing tool) skipped every assertion, ran
the `finally` cleanup, and then wrote a 0/0 artifact plus `ownership-proof-state: ok`. The
process exit code was 1 only because the exception was uncaught — so the artifact and the exit
status disagreed, and the artifact is what gets quoted later.

**Correction — an abort is a recorded failure.**

| Where | What changed |
| --- | --- |
| [scripts/dev-db-ownership-proof.mjs:85](../scripts/dev-db-ownership-proof.mjs#L85) | New `proofOutcome(summary)` derives `{ state, exitCode, reasons }` from **abort**, failed assertions and unverified cleanup — in that order, all of them — and from nothing else. A missing summary is a failure too. |
| [scripts/dev-db-ownership-proof.mjs:274](../scripts/dev-db-ownership-proof.mjs#L274) | `main()` keeps the ORIGINAL exception in `abort` ([:412](../scripts/dev-db-ownership-proof.mjs#L412) records it, no re-wrap), and the case body became `cases()` so setup and execution share one handler while cleanup stays in the `finally`. |
| [scripts/dev-db-ownership-proof.mjs:442](../scripts/dev-db-ownership-proof.mjs#L442) | The summary now carries `aborted`, `error` (`name`, `message`, `stack` — preserved verbatim), `state`, `stateReasons`, and a **separate** `cleanup` object (`state: verified/unverified/nothing-started`, counts, `preserved`, `scratchRemoved`). |
| [scripts/dev-db-ownership-proof.mjs:509](../scripts/dev-db-ownership-proof.mjs#L509) | The abort is rethrown **after** the artifact and the exit status exist, so both agree; the entry point at [:513](../scripts/dev-db-ownership-proof.mjs#L513) only runs when this file is the entry module, so the outcome rule can be imported by a test. |
| [scripts/dev-db-ownership-proof.mjs:478](../scripts/dev-db-ownership-proof.mjs#L478) | `PROOF_OUT` redirects the artifact, so the abort regression can inject a real failure without overwriting the recorded evidence. |
| [tests/dev-db-ownership-proof.test.ts:38](../tests/dev-db-ownership-proof.test.ts#L38) | New regression: the outcome rule (abort with 0 failed assertions and clean cleanup ⇒ `failed`/1; missing summary ⇒ failed), plus an **end-to-end injected setup failure** — the real script with a `PG_BIN` that contains no PostgreSQL tools — asserting exit 1, `ownership-proof-state: failed` on stdout, `aborted: true`, the original `initdb` error preserved, `checks: 0`, `checksFailed: 0`, `cleanup.state: "nothing-started"`, and that the recorded artifact is byte-unchanged. |

### P3 — the remaining contradictory recovery comment

[execution-reconciler.ts:460](../src/modules/workforce/execution/execution-reconciler.ts#L460)
no longer says "THREE DISJOINT LANES": it says three lanes **only one of which is disjoint
from the other two**, and points at the seventh/ninth correction (UNSEEN and NEWEST are the
same set read from both ends).

**Adjacent correction of the same claim (not a separate finding).** The identical falsehood
lived in two sibling comments in the same subsystem, where it was stated even more strongly
("three windows that CANNOT overlap"). Leaving those would have produced a fourth review
finding of exactly the same kind, so the same sentence was corrected at
[execution-claim.ts:565](../src/modules/workforce/execution/execution-claim.ts#L565) and
[:593](../src/modules/workforce/execution/execution-claim.ts#L593) — comments only, no code.
`execution-record.ts` was left alone: its two record allocations ("UNSEEN" and "REVISIT") really
are disjoint.

---

## 2. P1 coverage matrix (the reviewer's requested cases)

| Case | Where | Result |
| --- | --- | --- |
| `-D path` single | parser + inspector (`OURS`, then force, then lock removal) | pass |
| `-Dpath` single | parser + inspector lifecycle | pass |
| `--pgdata path` single | parser + inspector lifecycle | pass |
| `--pgdata=path` single | parser + inspector lifecycle | pass |
| Repeated, same spelling, both orders | parser problems + inspector `UNCERTAIN` + no signal + lock preserved | pass |
| Repeated, mixed spellings, both orders | parser problems + inspector `UNCERTAIN` + no signal + lock preserved | pass |
| Matching EARLIER option, foreign FINAL option (the reviewer's repro) | refused from **both** directories' inspectors | pass |
| Foreign earlier, matching final | refused (repeats are refused whichever one matches) | pass |
| Prefix spellings (`--p`, `--pgd=…`) | refused as unreadable | pass |
| Dangling `-D`, dangling `--pgdata`, empty `--pgdata=` | refused as unreadable | pass |
| Single option naming a neighbour (`…reviewed2`) | `UNCERTAIN` | pass |
| Shared gate of `start`/`up`/`restart`/`down`/`destroy` | structural assertions on the five call sites | pass |

No real process was signalled by these tests: the inspector's process table, argv, liveness and
force command are injected, which is what makes "refused to signal" observable at all.

---

## 3. Actual validation (exit statuses as produced)

| Check | Command | Result |
| --- | --- | --- |
| Ownership gate regressions | `npx vitest run tests/dev-db-ownership.test.ts` | **22/22, exit 0** |
| Proof-runner regressions (incl. end-to-end injected abort) | `npx vitest run tests/dev-db-ownership-proof.test.ts` | **2/2, exit 0** |
| Recovery/correction suite (the comments' subsystem) | `npx vitest run tests/workforce-step5a4-correction-p1.test.ts` | **33/33, exit 0** (the sibling `…-recovery-evidence.test.ts` is opt-in and reported 13 skipped — not counted) |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Syntax, JS | `node --check scripts/dev-db-ownership.mjs` and `…-proof.mjs` | **exit 0** each |
| Evidence manifest | `node scripts/verify-evidence-manifest.mjs docs/evidence/step5a4-eighth-review-ownership-2026-10-19.json` | **exit 0**, `manifest-state: ok`, digest `ffafb7dbce…` → full value below |
| Real-cluster ownership proof, run A | `node scripts/dev-db-ownership-proof.mjs` | **26/30 assertions, exit 1** — cases 1–3 passed; case 4 (force path) failed. See §5. |
| Real-cluster ownership proof, run B (after cleanup) | `node scripts/dev-db-ownership-proof.mjs` | **30/30 assertions, exit 1** — every assertion passed; the run reports `failed` because cleanup could NOT verify one cluster. See §5. |

The artifact on disk is **run B**:
`checks 30, checksPassed 30, checksFailed 0, state "failed"`, reasons
`["shutdown could not be verified for 1 cluster(s)"]`, `cleanup.state "unverified"`.
That is the P2 correction working as intended on live evidence: zero failed assertions does not
override an incomplete run, and the artifact, the printed `ownership-proof-state` and the exit
status all say the same thing.

Manifest digest recorded in run B:
`ffafb7dbce9a9cd986691e5a45e05592fdf66a0e0515a2dfea7cdde35f77f2fa`
(7 files; re-derivation recomputed the identical digest and re-hashed every file).

Also observed live, from the P1 correction, on real clusters: `down` of a cluster whose lock
file named a live foreign postmaster was REFUSED with the argument-vector reason and the lock
file stayed byte-identical (case 1, `…/owners data` vs `…/owner's data`); two clusters started
concurrently with the same recorded start second were distinguished by argv (case 2); and the
ordinary apostrophe-path lifecycle still succeeded (case 3). A separate manual `down` of an
owned disposable cluster after the flake also completed with exit 0 and a verified-gone pid.

---

## 4. Full reproducible tree identity

Serialization: one row per file, sorted by expanded path (ascending byte order, `/`
separators), each row `"<sha256><two spaces><expanded path>"`, LF terminated, no trailing blank
line, hashed with sha256. Paths are expanded (`?? dir/` is expanded to its files).

```
branch              feature/ai-workforce-foundation
HEAD                4ecc1a7fd1a28f2a45d2dfbd32a878914133356f
porcelain digest    34ca81cd3ae6a488af9bd00d1d8458a2550d7660d61d0965247813a4badb405e
porcelain entries   73  = 41 modified tracked + 32 untracked, 0 staged
changed rows        72  (handoff excluded)
tracked diff        aeedc48fb30a230731d8563f57a7dc2322f0c6980aa2464a50f4c524f74afea4
                    (git diff --stat: 41 files changed, 5595 insertions(+), 560 deletions(-))
manifest            9a96a733e203d425310dc3609024e6e7190723bab4b9377080955164fa5b5005
                    (sha256 of the 72 sorted LF-terminated rows)
handoff excluded    docs/evidence/step5a4-ninth-review-corrections-2026-10-20.md
```

Why the handoff is excluded rather than included as a 73rd row: a document cannot contain a
fixed-point digest of itself. Filling this block changes this file's bytes and nothing else,
so the three digests above stay exactly reproducible by re-running the same serialization over
the same 72 paths. The excluded path is the ONLY exclusion, and it is a documentation file
with no runtime role. (For completeness: the parser-visible set is unchanged from the previous
handoff's 71 rows plus `tests/dev-db-ownership-proof.test.ts` and this document.)

---

## 5. The flake, reported not papered over

Neither failure is caused by these corrections, and neither is silently "fixed" here.

**Run A — case 4 (force path).** `taskkill /F /T /PID 4488` returned 0, the postmaster pid was
verifiably gone (`process.kill(pid, 0)` → ESRCH, `Get-CimInstance` empty), and the proof's
"old postmaster is GONE" assertion passed — but an `io_worker` child (pid 21572, parent 4488,
command line `--forkchild="io_worker" 5944`) survived the tree kill. That orphan kept the
cluster's log file open and the old listener socket bound, so the replacement
`pg_ctl start` failed (exit 1; the log file has no entry after
`database system is ready to accept connections`, i.e. pg_ctl never got a new postmaster far
enough to log). The proof correctly failed, preserved the scratch directory, and left the
orphan for an operator. **Review cleanup:** that orphan was identified by its own parent pid
and command line, killed by pid (2s), verified ESRCH, and the bound port verified free; the
preserved scratch — holding only a lock file naming an already-dead pid — was then removed and
its absence verified. No image-name or global kill was used.

**Run B — cleanup verification.** Cluster C's postmaster (pid 29784) noticed the lock file the
proof had deliberately tampered with (`lock file "postmaster.pid" contains wrong PID: 10552
instead of 29784`) and performed an immediate shutdown — PostgreSQL's own safety check, not a
leak. By cleanup time C had no lock file, and pid 29784 had been **reused by a Chrome renderer
process**, so `alive(29784)` was true and the proof refused to claim a verified shutdown.
**Review cleanup:** no proof postmaster was running (no lock files, no listeners on the proof's
ports), the planted lock named a dead pid, the scratch was removed, and no
`nexup-ownership-proof-*` directory remains.

Implication for the reviewer: the proof's *cleanup checker* is pid-reuse-blind in the same way
the ownership gate was before the eighth review. It fails closed (preserves, reports failure)
so it cannot destroy anything or claim a false pass, but on a busy host it can report
`unverified` for a cluster that is genuinely gone. This deserves its own finding; it is not
part of the three corrections.

---

## 6. Remaining limitations

* **Not re-certified in this round** (unchanged files or no concrete reason): the full
  `run-http-proof-safety.sh` matrix, the HTTP boundary proof, the recovery proof on a real
  cluster, the persistence proof and the aggregate suite. The affected application TypeScript
  changed **only in comments**, so the scoped 33-test suite plus `tsc` were the justified
  reruns; the safety runner's own file was not edited.
* The gate's `--pgdata` handling is a deliberate over-approximation (see §1); PostgreSQL 18.6
  does not accept that spelling for a running postmaster.
* A postmaster launched with repeated `-D` options is now **unmanageable** by
  `start`/`up`/`restart`/`down`/`destroy` (fail closed by design), and a platform that will not
  report argv keeps ownership `UNCERTAIN`.
* The proof's cleanup checker can report `unverified` on pid reuse (§5) — fail-closed, but
  noisy.
* Windows argv is reconstructed from the platform's rendered `CommandLine` through its own
  quoting rule; POSIX uses `/proc/<pid>/cmdline`; macOS has no argv source and fails closed.
* Activation conditions from the previous handoffs are unchanged: source approval is not
  migration/deployment approval (PHASE_5 registration, deployment-time Prisma client
  generation, realistic `EXPLAIN`/index evaluation, Linux ownership CI, Hermes daemon tool
  inventory).

## 7. Cleanup inventory (verified)

* 0 `nexup-ownership-proof-*` scratch directories (both runs' scratches removed after
  verification; the second removal was verified by re-`ls`).
* 0 proof postmaster processes, 0 proof `pg_ctl` processes, 0 orphans (including the io_worker
  from run A, killed by pid and verified ESRCH).
* 0 listeners on the proof's ports (checked after removal).
* The one non-proof PostgreSQL cluster started before this review was left untouched.
* No staging, commit, push, merge, migration or deployment.

Tree is frozen at `feature/ai-workforce-foundation`, HEAD
`4ecc1a7fd1a28f2a45d2dfbd32a878914133356f`, ready for independent review.

---

## 8. Addendum — 2026-10-21 re-record after the ownership regressions were repaired

The ownership regressions in this round were re-derived against the CURRENT inspector and four
defects in the code they exercise were found and fixed. This section is appended rather than
rewriting §1–§7, so the earlier run's numbers stay as they were observed.

**Defects found while re-deriving the regressions.**

1. `scripts/dev-db-ownership.mjs` referenced `clusterRunning` and
   `dataDirectoryServingIsOurs` inside `clusterStillServing()` but never destructured them from
   `createOwnershipInspector({ … })`. Every `clearStalePostmaster()` call therefore threw a
   `ReferenceError` instead of returning the FAIL CLOSED refusal. Both are now destructured
   (default `() => false`), and `scripts/dev-db.mjs` wires the real cluster probes into the
   inspector — without them the serving test could never answer "still serving".
2. `clusterStillServing()` additionally required the lock file to name a live `OURS`/`UNCERTAIN`
   pid. That made the check report "not serving" in exactly the case it exists for: a lock file
   left by a gone pid while another cluster still answers on the port. The lock file is no longer
   consulted; the answer comes from the server alone.
3. `clearStalePostmaster()` skipped the serving test when the captured ownership was `OURS`
   (`ownership.state !== "OURS" && clusterStillServing()`), so a verified stop deleted the lock
   while the directory was still serving — the same "pid gone is directory free" mistake one
   level up. The test now runs after EVERY successful stop.
4. In `scripts/dev-db-ownership-proof.mjs`, the cleanup identity probe called
   `createOwnershipInspector` without importing it and passed an undefined `isAlive`. The first
   attempt to use the tampered-lock branch threw instead of deciding, so no artifact was written
   and the cleanup loop stopped early. Both bindings are fixed.

**Re-derived checks (2026-10-21, this host).**

| Check | Command | Result |
| --- | --- | --- |
| Ownership gate regressions | `npx vitest run tests/dev-db-ownership.test.ts` | **28/28, exit 0** (file rewritten against the current contract) |
| Proof-runner regressions | `npx vitest run tests/dev-db-ownership-proof.test.ts` | **2/2, exit 0** |
| Safety-runner cleanup contract | `npx vitest run tests/run-http-proof-safety-cleanup.test.ts` | **4/4, exit 0** |
| Typecheck | `npx tsc --noEmit` | **exit 0** |
| Lint (changed files) | `npx eslint scripts/dev-db-ownership.mjs scripts/dev-db.mjs tests/dev-db-ownership.test.ts tests/dev-db-ownership-proof.test.ts` | **exit 0** |
| Real-cluster ownership proof | `node scripts/dev-db-ownership-proof.mjs` | **30/30 assertions, `cleanup verified (5/5 stopped)`, `ownership-proof-state: ok`, exit 0** |

The artifact on disk is now this run: `state "ok"`, `checks 30`, `checksFailed 0`,
`aborted false`, `cleanup { state: "verified", clustersStarted: 5, clustersStopped: 5,
preserved: [], scratchRemoved: true }`. Manifest digest
`1dbb80b47988582821a462057858bd71b75c2af60df19becebe4f73b9b2dd6b6`, and
`node scripts/verify-evidence-manifest.mjs docs/evidence/step5a4-eighth-review-ownership-2026-10-19.json`
recomputes the same digest and re-hashes all 7 files with `manifest-state: ok`.

§5's run-B flake is *not* claimed as fixed by this addendum: the cleanup checker remains
pid-reuse-blind in the sense described there. What is fixed is that its decision path can now
run at all. If a future run reports `unverified` for a cluster that is genuinely gone, §5 still
applies.
