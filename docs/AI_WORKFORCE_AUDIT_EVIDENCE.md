# AI Workforce — audit evidence convention

The Step-4 audit found a real gap: the only proof that a live run had happened
lived in `outputs/` **outside this repository**, untracked, with no commit
identity, so nobody could tell which tree it came from and nothing could be
re-verified. This file is the convention that replaces it.

## The rule

Live evidence is committed, under `docs/evidence/`, and every artifact answers
five questions:

| Question | Field |
|---|---|
| Which code produced this? | `testedCommit` (+ `treeFingerprint`, see below) |
| When and where? | `testedAt`, `environment` |
| Who/what ran? | `actorId`, `actorSlug`, `capabilityId`, `capabilityVersion`, `runtimeId`, `profileRef`, `assignmentId` |
| Which execution? | `runId` (the bridge's own run id = the handle), `providerExecutionId` (the Hermes session), `idempotencyKey` |
| Can the other side be checked? | `bridgeAudit` — the matching bridge log lines, by `runId` |

### Never in an evidence file

- the value of `NEXUP_BRIDGE_HMAC_SECRET` or any secret/key/token,
- the Hermes session token,
- `/etc/nexup-bridge/*` contents,
- environment dumps (`.env`, `printenv`),
- full prompts when they contain business-sensitive text.

Only ids, statuses, timings and hashes. If a value is needed to correlate a
run, correlate on the **run id**, never on a secret.

## Getting the secret without printing it

The bridge HMAC secret is read straight into an environment variable and never
echoed:

```bash
SECRET=$(ssh -o BatchMode=yes root@<host> \
  'grep -E "^NEXUP_BRIDGE_HMAC_SECRET=" /etc/nexup-bridge/bridge.env | cut -d= -f2-' \
  | tr -d '\r\n')
```

Nothing in this repository may contain that value. Verify before committing:

```bash
grep -rIl "$SECRET" . 2>/dev/null        # must print nothing
```

## Gated commands

Every live proof is skipped unless explicitly requested, so the normal `vitest`
run never touches the network.

Common environment (the secret is always passed by reference, never inline):

```bash
export NEXUP_BRIDGE_E2E=1
export HERMES_RUNTIME_PROFILE=saieed
export HERMES_RUNTIME_TRANSPORT=BRIDGE
export HERMES_RUNTIME_BRIDGE_URL=https://bridge.srv1995415.hstgr.cloud
export HERMES_RUNTIME_BRIDGE_KEY_ID=nexup-vercel
export HERMES_RUNTIME_BRIDGE_SECRET="$SECRET"
export HERMES_RUNTIME_TIMEOUT_MS=120000
```

| Proof | Command |
|---|---|
| Step 3 — one honest end-to-end run | `npx vitest run tests/workforce-step3-e2e.test.ts` |
| Step 4 — the real actor, submit → status → terminal | `npx vitest run tests/workforce-step4-async.test.ts` |
| Step 4 — **live cancel through the port** | `npx vitest run tests/workforce-step4-live-cancel.test.ts` |
| Step 5 — the full mission lifecycle | `npx vitest run tests/workforce-step5-mission.test.ts` |
| Step 5 — **durability** on a real PostgreSQL | `bash scripts/run-persistence-proof.sh` |
| Step 5 — **live + durable**, real agent | `PROOF_TEST=tests/workforce-step5-live-durability.test.ts bash scripts/run-persistence-proof.sh` |

## Durability proofs — the isolated cluster

The durability proofs need a real PostgreSQL, and NEXUP's real database is data.
`scripts/run-persistence-proof.sh` therefore stands up a **throwaway** cluster:

```bash
bash scripts/run-persistence-proof.sh                                    # 9 tests, offline
PROOF_TEST=tests/workforce-step5-live-durability.test.ts \
  bash scripts/run-persistence-proof.sh                                  # 1 test, + the bridge env
```

It `initdb`s a new cluster in a temp directory, on loopback with trust auth,
applies the three proposed migration files to it, runs the suite, and then stops
and deletes the cluster. It never starts, stops or touches any running
PostgreSQL service, never reads `DATABASE_URL`, and applies no migration to any
real database.

The suite `boot()`s several "processes" — each with its own Prisma client and its
own registries — so a re-read is a genuine reconstruction and not the same
object handed back. Those still share the vitest process, so the first test goes
one step further and reads the finished chain from a **separate operating-system
process**:

```bash
node scripts/read-durable-mission.cjs <databaseUrl> <missionId>
```

That script imports nothing from `src/`, so no registry, cache or module state
built by the test is reachable from it — the database is the only possible
source. It prints one JSON object and contains no credentials.

Because that database is **not** the production one, the live durability proof
does not close Step 5: applying the migration for real needs explicit owner
approval against a separate development database.

## Additive-only, checked mechanically

Before any proposed migration is trusted, its SQL is inspected by machine, not
by eye:

```bash
node scripts/verify-proposed-migration.mjs \
  prisma/proposed-migrations/AI_WORKFORCE_PHASE_2/migration.sql
```

It fails on any `DROP` / `DELETE` / `TRUNCATE` / `RENAME`, and on any
`ALTER TABLE` naming a table the file does not itself create. It is also invoked
from the durability suite's `beforeAll`, so the guarantee cannot regress
silently. (`AI_WORKFORCE_PHASE_1B` intentionally fails it: the `DROP` there is a
reviewed removal of a proposed table that never existed anywhere. Every `DROP`
should fail this check and be argued for by a person.)

Optional knobs: `NEXUP_CANCEL_AFTER_MS` (default 10000) — how long the run is
left working before the cancel.

The offline proofs need no environment at all:

```bash
npx vitest run tests/workforce-step4-safety-closure.test.ts
npx vitest run tests/workforce-step5-mission.test.ts
```

## Capturing the bridge side

The app-side test prints one JSON line, e.g. `[step4-cancel-audit] {…}`. The
bridge side is read back by run id and pasted into `bridgeAudit`:

```bash
ssh -o BatchMode=yes root@<host> \
  'docker logs nexup-bridge --since 30m 2>&1 | grep -E "<runId>|action"' | tail -20
```

Then confirm the log carries no secret material:

```bash
ssh -o BatchMode=yes root@<host> \
  'docker logs nexup-bridge --since 30m 2>&1 | grep -cE "llm.oneshot|session-token|HMAC_SECRET"'
# must print 0
```

## Certifying the tree — `treeFingerprint`

A live run costs a real execution, so it is spent **once**, on the working tree
that is about to be committed. The artifact then proves that the committed tree
is the tested one:

```bash
# 1. fingerprint the tree that is about to be committed (only your files staged)
git add -A && git diff --cached <parentCommit> | sha256sum

# 2. commit
git commit -m "…"

# 3. the commit's tree must hash identically — this is the certification
git diff <parentCommit> HEAD | sha256sum        # must equal step 1
```

`treeFingerprint` is that hash, and `testedCommit` is `<parentCommit>` (the
commit the change was made on top of). `closureCommit` is the commit that
contains this artifact. Anyone can check out `closureCommit`, re-run the gated
command from the table above, and compare.

## Artifact template

```json
{
  "proof": "…",
  "testedAt": "ISO-8601",
  "environment": "local-build-machine | production-host",
  "testedCommit": "<sha>",
  "treeFingerprint": "sha256:<hex>",
  "closureCommit": "<sha>",
  "gatedCommand": "NEXUP_BRIDGE_E2E=1 … npx vitest run <file>",
  "actorId": "…", "actorSlug": "…", "actorLifecycle": "…",
  "capabilityId": "…", "capabilityVersion": "…", "assignmentId": "…",
  "runtimeId": "…", "runtimeType": "…", "transport": "BRIDGE", "profileRef": "saieed",
  "runId": "…", "providerExecutionId": "…", "idempotencyKey": "…",
  "timings": { "acceptedMs": 0, "cancelMs": 0 },
  "result": { "statusDuring": "…", "statusFinal": "…", "terminal": true },
  "bridgeAudit": [ "…" ],
  "secretScan": { "leakedSecretOccurrences": 0 }
}
```

## Recorded artifacts

| Artifact | Proof |
|---|---|
| `docs/evidence/step4-live-cancel-2026-10-07.json` | live cancel through `AgentRuntime.cancelJob` |
| `docs/evidence/step5-durability-local-2026-10-07.json` | the Step-5 lifecycle over durable repositories on a real PostgreSQL, re-hydrated by fresh domains and by a separate operating-system process |
| `docs/evidence/step5-live-durability-2026-10-07.json` | the same lifecycle with the REAL agent over the bridge, persisted and re-hydrated |

## Historical note

`outputs/step3-e2e-audit-*.txt`, `outputs/step4-live-audit-*.txt` and
`outputs/step5-live-mission-*.txt` predate this convention. They live outside
the repository, are untracked, and name no commit. They are **not** certified
evidence and are not cited as such.
