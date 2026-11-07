# Step 5A-4 — eighth-review corrections (2026-10-19)

Scope: **only** the confirmed findings in the eighth-review verdict, plus the inaccurate
`sweepLanes` comment. No recovery redesign, no new features, no Product/Agent Studio changes,
no migration, no provider call, no commit/push/merge/deploy.

## 1. Correction map

| # | Finding | Correction | Proof it now refuses / behaves |
|---|---|---|---|
| P1-1 | `samePath()` deleted every quote, so `…\owners data` ≡ `…\owner's data` | `samePath()` (`scripts/dev-db-ownership.mjs`) normalises separators, trailing slashes, symlinks and Windows case only. Quoting is removed **only** in `parseWindowsCommandLine`, i.e. where it is syntax. `scripts/dev-db.mjs` now delegates (`const samePath = ownershipInspector.samePath`) | unit: 3 cases (apostrophe, `"`, `'`, tokeniser); probe case 1 (11 checks) and case 3 (positive control: an apostrophe directory is still ours and `down` succeeds) |
| P1-2 | a start time within 2 s was treated as proof of ownership | `inspect()` requires the process's own argv to carry an exact `-D`/`--pgdata` equal to the data directory. Start time can only **refuse** (reused pid); agreement never authorises. `START_TIME_TOLERANCE_SECONDS` survives as a refutation window, documented as such | unit: 4 cases incl. two clusters in the same second; probe case 2: C and D started concurrently with **identical** epoch `1792432220`, C's lock rewritten with D's pid/start → `down` refused, C and D both alive and answering, C's lock byte-identical |
| P1-3 | failed `taskkill` was reported as success, so the lock file was deleted | `stopOwnPostmaster()` checks the force command's exit status **and** waits for the pid to disappear; `clearStalePostmaster()` removes the lock only when the inspection says `ABSENT` or a verified termination occurred; every other outcome returns `refused: true` and removes nothing | unit: `taskkill` exit 1 (alive) → lock preserved; `taskkill` exit 0 but pid alive → `ok:false`, lock preserved; verified kill → lock removed; `UNCERTAIN` → nothing removed |
| P1-4 | `down` and graceful `restart` read ownership once, then signalled | `revalidateOwnership(pid)` is called immediately before every graceful `pg_ctl stop` (`down`, `stopForRestart`, `destroy`); `stopOwnPostmaster` re-inspects immediately before the force signal and requires the same pid | unit: 2 cases (lock swapped to a foreign pid; lock swapped to a different *owned* pid) — no `taskkill` is issued |
| P1-5 | POSIX identity came from rendered `ps … args=` | POSIX argv is read from `/proc/<pid>/cmdline` (NUL-separated). No `ps` fallback; when argv is unavailable the answer is `UNCERTAIN` | unit: spaced path stays one argument, `/tmp/owner` vs `/tmp/owner data` distinguished; harness throws if `ps args=` is ever used, and asserts `rendered === []` |
| P2-6 | safety runner deleted scratch after an unverified stop | `cleanup()` stops each cluster, then asks `cluster_stopped` (pid on line 1 of that cluster's own lock file) independently of `pg_ctl`'s exit; on doubt it announces preservation, forces exit status ≠ 0 and **returns before** any deletion; `rm -rf` remains guarded by `owned_scratch` | structural regression (4 tests) + a behavioural run of the extracted `cluster_stopped()`: no lock → 0, lock→live pid → 1, lock→dead pid → 0 |
| — | `sweepLanes(1)` comment claimed one row **per lane** | comment now states `sweepLanes(1)` = `{unseen: 1, revisit: 0, newest: 0}`, i.e. no revisit window | `src/modules/workforce/execution/execution-reconciler.ts` (comment only) |

Ownership inspection was extracted into `scripts/dev-db-ownership.mjs` so every decision is
testable with injected `exec`/`isAlive`/lock-file I/O, and so `dev-db.mjs` cannot drift from
it. `run-api-http-proof.sh`, `write-recovery-proof-evidence.mjs` and
`run-http-proof-safety.sh` list the new module in their evidence manifests.

## 2. Validation actually run

| Check | Command | Result |
|---|---|---|
| ownership unit regressions (16) + safety-cleanup contract (4) + correction suite (33) | `npx vitest run tests/dev-db-ownership.test.ts tests/run-http-proof-safety-cleanup.test.ts tests/workforce-step5a4-correction-p1.test.ts` | **53/53 passed, exit 0** (7.3 s) |
| typecheck | `npx tsc --noEmit` | **exit 0** |
| shell / module syntax | `bash -n scripts/run-http-proof-safety.sh`; `node --check` on all three `.mjs` | exit 0 |
| real-cluster ownership probe | `node scripts/dev-db-ownership-proof.mjs` | **30/30 checks, exit 0**, 690.9 s wall clock, state `ok` |
| probe evidence manifest | `node scripts/verify-evidence-manifest.mjs docs/evidence/step5a4-eighth-review-ownership-2026-10-19.json` | **manifest-state: ok**, digest `04a5879f4c7e48b70e316a02b7e98bcd0a424325456f5cf3ea8f8ac4820a046f` (7 files) |

Probe cases, as measured:

- case 1 — `…/owners data` whose lock names live `…/owner's data`: `down` exit 1, `destroy` exit 1, refusal text names the argument-vector test, B alive and answering, A's lock byte-identical, A's data preserved.
- case 2 — C and D started **concurrently**: both wrote start second `1792432220`; C's lock then named D's pid/start/port. `down` on C exit 1, C's own postmaster alive, D alive, both answering, C's lock byte-identical. This is the reviewer's exact reproduction, including the tie the old code accepted.
- case 3 — positive control: `…/owner's lifecycle` is recognised as ours, `down` exit 0, pid gone.
- case 4 — stale-start path: a running cluster presented on a *different* port is force-terminated **after** re-verification (`pid 2612 → 23924`), the old pid is verified gone, the replacement answers, and it stops normally afterwards.

**Not re-run** (and therefore not claimed as passing here): the full
`scripts/run-http-proof-safety.sh` matrix, the HTTP boundary proof, the recovery proof,
persistence and the aggregate suite. Reason: on this host one `initdb` costs ~180 s
(measured in the probe), so the 15-case safety matrix alone is hours of wall clock; the
recovery source was not touched in this round. Their previously recorded results stand as
recorded, not as re-certified by this pass.

## 3. Cleanup evidence

- Probe artifact cleanup block: `clustersStarted: 5, clustersStopped: 5, preserved: []`,
  `scratchRemoved: true`.
- No `nexup-ownership-proof-*` directory remains under the temp root.
- No `postgres.exe` process whose command line names the probe's scratch path.
- The one-off `cluster_stopped` harness was deleted after use
  (`scripts/.tmp-check-cluster-stopped.sh`); it is not part of the tree.
- No image-name kill and no `/IM` invocation was used at any point; every signal in this
  round was `pg_ctl -D <dir> stop`, the harness's verified force path on a pid it had
  proved, or `taskkill /F /T /PID <pid>` on that same proved pid.

## 4. Tree identity

Recorded by the eighth review (pre-correction snapshot):
`4ecc1a7f…`, 41 modified tracked / 24 untracked / 0 staged,
porcelain `a18dc5d6…`, tracked diff `e8aea9db…`, 65 changed files.

Current, after the corrections (the digests below are the ones to verify):

- branch `feature/ai-workforce-foundation`
- HEAD `4ecc1a7fd1a28f2a45d2dfbd32a878914133356f` (unchanged — nothing was committed)
- changed tracked files: 41 modified, 0 staged (no tracked file was reverted or discarded)
- changed files on disk: see the digest block in the hand-off message; the count is higher
  than the review's 65 because the corrections add `scripts/dev-db-ownership.mjs`,
  `scripts/dev-db-ownership-proof.mjs`, `tests/dev-db-ownership.test.ts`,
  `tests/run-http-proof-safety-cleanup.test.ts` and this record.

The recorded porcelain/diff digests therefore **cannot** reproduce on the corrected tree, and
do not: the review snapshot predates the corrections it asked for. No reproduction attempt
was made by editing the tree to match; every variant tried (`git diff`, `--binary`,
`core.autocrlf=true`, `status -uall`) was read-only.

## 5. Remaining limitations (stated, not papered over)

1. Check-and-signal is still not atomic: no `pidfd` here, so a few milliseconds remain
   between verification and `taskkill`/`kill -9`, and `pg_ctl` re-reads the lock file itself.
2. On Windows, `Win32_Process.CommandLine` is a *rendered* string; boundaries are recovered
   by the platform's own quoting rule (`parseWindowsCommandLine`). It is faithful to that
   rule, not an OS argv array. It also costs one PowerShell (or wmic) call per inspection.
3. POSIX requires `/proc/<pid>/cmdline`; macOS has no such identity source and would answer
   `UNCERTAIN` — fail closed, but the harness cannot manage a cluster there.
4. A failed force signal can only be exercised by injection (no real unkillable postmaster);
   the unit suite covers exit≠0 and exit 0-with-surviving-process. The real-cluster probe
   covers the *successful* verified force path only.
5. The safety runner's cleanup is covered structurally and its guard function behaviourally,
   but the runner's own end-to-end matrix was not re-executed this round (see §2).
6. The probe's cleanup restores the lock file it saved at start before asking `pg_ctl` to
   stop a cluster whose lock the probe tampered with; that restoration is itself evidence
   the probe owns the directory, and it refuses (`preserves`) when the saved pid is gone.
7. Recovery fairness conditions are unchanged and still conditional (row stays eligible,
   scoped sweeps continue, per-row processing completes, equal-millisecond stamps can weaken
   a strict call-count bound, a repeatedly failing head row delays rows behind it).
