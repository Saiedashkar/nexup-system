#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — the Step 5A-4 (third review) RECOVERY proof
# ═══════════════════════════════════════════════════════════════════════
#
# Runs `tests/workforce-step5a4-recovery-evidence.test.ts` against a REAL
# PostgreSQL and writes reproducible evidence:
#
#   * a multi-task cancellation that can only PARTLY resolve rolls its
#     reservations back, and no task is left poisoned;
#   * that cancellation and a concurrent `execute()` contend in ONE place and
#     never both win;
#   * `commands.reconcile()`, `reconcileInFlight()` and `drain()` find an
#     entered-but-unidentified attempt, durably and repeatably;
#   * the atomic finalizer and `markUnverified` race on ONE row, and the record
#     and the ledger can never disagree about which side won;
#   * more than 50 unresolved claims are swept, and a mission's incident is
#     recovered even when it sits OUTSIDE the first global page.
#
# ── RESOURCE OWNERSHIP (this is why the runner is not shared) ──
#
# The port and the data directory are allocated PER RUN:
#
#   * an ephemeral free loopback port is requested from the OS, so a second
#     session's cluster (or a leftover one) cannot collide with this run;
#   * the cluster lives in `nexup-recovery-proof-<port>`, and cleanup stops it by
#     ITS OWN data directory — never by port, and never by enumerating listeners.
#
# Nothing here touches the development cluster, the demo environment, another
# session's server, or any database that was not created by this run. It never
# reads DATABASE_URL.
#
# Usage:  bash scripts/run-recovery-proof.sh
# Env:    PG_BIN                  (default: C:/Program Files/PostgreSQL/18/bin)
#         RECOVERY_PROOF_PORT     (default: an ephemeral free port)
#         RECOVERY_PROOF_DATA     (default: %LOCALAPPDATA% — the BASE directory the
#                                  run directory is created UNDER; never deleted)
#
# Everything this run creates lives in ONE run directory that this process creates
# under that base and MARKS as its own before starting anything: the cluster's data
# directory, its log, and the runner's temporary vitest report. Cleanup proves the
# ownership before it stops the cluster or removes a file, so a caller-supplied
# base is only ever a parent, and the published evidence under `docs/evidence/` is
# the one artifact that deliberately survives the run.

set -euo pipefail

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Windows paths go to native binaries unmodified (Git Bash would otherwise
# rewrite `/D`-style arguments into filesystem paths).
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

INITDB="$PG_BIN/initdb.exe"
PG_CTL="$PG_BIN/pg_ctl.exe"
PSQL="$PG_BIN/psql.exe"

for tool in "$INITDB" "$PG_CTL" "$PSQL"; do
  if [ ! -x "$tool" ]; then
    echo "missing PostgreSQL tool: $tool (set PG_BIN)" >&2
    exit 2
  fi
done

allocated_port() {
  node -e 'const net=require("node:net");const s=net.createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{const p=s.address().port;console.log(p);s.close();});'
}

PORT="${RECOVERY_PROOF_PORT:-$(allocated_port)}"
if [ -z "$PORT" ]; then
  echo "could not allocate a free loopback port (set RECOVERY_PROOF_PORT explicitly)" >&2
  exit 2
fi
# The BASE is a PARENT directory: caller-supplied or not, it is never emptied and
# never deleted. Everything else lives in a fresh child of it, whose name carries
# this run's own token, so two runs — even with the same base — cannot collide.
BASE_DIR="${RECOVERY_PROOF_DATA:-${LOCALAPPDATA:-/tmp}}"
# PATH FORM, and it is not cosmetic. The native PostgreSQL binaries on Windows read
# `/c/Users/...` as `C:\c\Users\...`, while bash (and `rm`) read the same string as
# `C:\Users\...`. That split sent the cluster's data directory and its
# `postmaster.pid` to a path this script never looked in, so cleanup could neither
# verify nor stop it and orphaned clusters accumulated under `C:\c\...`. A DRIVE path
# with forward slashes (`C:/Users/...`) is understood by BOTH, so every check below,
# `pg_ctl`, and `rm` address the same location.
if command -v cygpath >/dev/null 2>&1; then
  BASE_DIR="$(cygpath -m "$BASE_DIR")"
fi
RUN_TOKEN="$$-$(date +%s)-$RANDOM"
RUN_DIR="$BASE_DIR/nexup-recovery-proof-$RUN_TOKEN"
DATA_DIR="$RUN_DIR/data"
LOG_FILE="$RUN_DIR/postgres.log"
# The temporary vitest report: per-run and INSIDE the run directory, so it can
# never be confused with another run's, and it goes when the run directory goes.
# The PUBLISHED evidence (`docs/evidence/...`) is written outside it and survives.
RESULTS_FILE="$RUN_DIR/vitest-results.json"
OWNERSHIP_MARKER="$RUN_DIR/.proof-runner-owned"

# Ownership is PROVEN before anything is stopped or deleted: the marker must exist
# AND carry the token this run wrote. A caller's base, a leftover directory, or a
# path that merely looks like ours is left untouched.
owned_run_dir() {
  [ -d "$RUN_DIR" ] && [ -f "$OWNERSHIP_MARKER" ] && [ "$(cat "$OWNERSHIP_MARKER" 2>/dev/null)" = "$RUN_TOKEN" ]
}

# Is the postmaster THIS run started still alive? Asked ONLY about the pid read from
# this run's own `postmaster.pid`. `pg_ctl status` is deliberately NOT used here: it
# reads the same pid file the postmaster DELETES as it begins shutting down, so it
# can report "stopped" while the process is still running and listening.
postmaster_alive() {
  if command -v tasklist >/dev/null 2>&1; then
    # Dash form: MSYS2_ARG_CONV_EXCL='*' passes '//FI' through literally, which
    # tasklist would reject as an invalid option.
    tasklist -FI "PID eq $1" -FO CSV -NH 2>/dev/null | grep -q "\"$1\""
  else
    kill -0 "$1" 2>/dev/null
  fi
}

cleanup() {
  local status=$?
  if owned_run_dir; then
    # Read the postmaster's OWN pid BEFORE stopping, because the stop removes the
    # pid file it came from. Verified on Windows: without this, a fast shutdown can
    # leave the postmaster alive while `pg_ctl status` already says "stopped", and
    # deleting the data directory underneath it orphans a server on a loopback port.
    local postmaster_pid=""
    if [ -f "$DATA_DIR/postmaster.pid" ]; then
      postmaster_pid="$(head -n1 "$DATA_DIR/postmaster.pid" 2>/dev/null | tr -d '[:space:]')"
    fi
    # Address the cluster by the data directory THIS run created. `pg_ctl -D` can
    # only stop the one cluster it points at, so no other session's listener is
    # ever a candidate for termination.
    if [ -d "$DATA_DIR" ]; then
      # `-w -t 30` makes `pg_ctl stop` WAIT. Then verify against the PID we read
      # above — never against `pg_ctl status` — and escalate until OUR process is
      # really gone. Only then is anything deleted.
      "$PG_CTL" -D "$DATA_DIR" stop -m fast -w -t 30 >/dev/null 2>&1 || true
      if [ -n "$postmaster_pid" ] && postmaster_alive "$postmaster_pid"; then
        "$PG_CTL" -D "$DATA_DIR" stop -m immediate -w -t 30 >/dev/null 2>&1 || true
      fi
      if [ -n "$postmaster_pid" ] && postmaster_alive "$postmaster_pid"; then
        # Last resort, still scoped to THIS run: the pid came from this run's own
        # data directory, so nothing another session started can be reached.
        if command -v taskkill >/dev/null 2>&1; then
          taskkill -F -T -PID "$postmaster_pid" >/dev/null 2>&1 || true
        else
          kill -9 "$postmaster_pid" 2>/dev/null || true
        fi
      fi
      if [ -n "$postmaster_pid" ] && postmaster_alive "$postmaster_pid"; then
        echo "WARNING: the proof cluster (postmaster pid $postmaster_pid) did not stop; leaving its directory in place" >&2
        exit "$status"
      fi
    fi
    rm -rf "$RUN_DIR"
  else
    echo "not stopping or removing $RUN_DIR: this run did not create it" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "── isolated cluster (owned by THIS run) ─────────────────────────"
echo "   base dir : $BASE_DIR (never emptied or removed by this run)"
echo "   run dir  : $RUN_DIR"
echo "   data dir : $DATA_DIR"
echo "   port     : $PORT (auto-allocated, loopback only, trust auth)"

# Create and CLAIM the run directory before a single thing is started inside it.
mkdir -p "$RUN_DIR"
printf '%s\n' "$RUN_TOKEN" > "$OWNERSHIP_MARKER"

"$INITDB" -D "$DATA_DIR" -U postgres -A trust --encoding=UTF8 >/dev/null
"$PG_CTL" -D "$DATA_DIR" -l "$LOG_FILE" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
  -w start >/dev/null

# Readiness is a QUERY, not an open socket.
for attempt in $(seq 1 30); do
  if PGPASSWORD=postgres "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = "30" ]; then
    echo "the cluster never became ready; log follows" >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "   ready    : $(PGPASSWORD=postgres "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'select version()')"

echo "── the recovery proof ──────────────────────────────────────────"
echo "   test     : tests/workforce-step5a4-recovery-evidence.test.ts"

set +e
AI_WORKFORCE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT" \
PSQL_BIN="$PSQL" \
  npx vitest run tests/workforce-step5a4-recovery-evidence.test.ts \
    --reporter=default --reporter=json --outputFile="$RESULTS_FILE"
STATUS=$?
set -e

echo "── evidence ────────────────────────────────────────────────────"
node scripts/write-recovery-proof-evidence.mjs "$RESULTS_FILE" "$STATUS"
# The manifest is re-derived by an INDEPENDENT reader before the run reports success:
# the digest over sorted paths and content hashes is checked against the list, and
# every recorded hash is checked against the file on disk.
node scripts/verify-evidence-manifest.mjs docs/evidence/step5a4-recovery-round5-2026-10-13.json

if [ "$STATUS" != "0" ]; then
  echo "the recovery proof FAILED (exit $STATUS) — the evidence records the failure" >&2
  exit "$STATUS"
fi

echo "   cluster stopped (it existed only for this run)"
