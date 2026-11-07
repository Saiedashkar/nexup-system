#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — the local durability proof, on a THROWAWAY cluster
# ═══════════════════════════════════════════════════════════════════════
#
# `tests/workforce-step5-persistence.test.ts` needs a real PostgreSQL. This
# script supplies one that CANNOT be anything else:
#
#   - it initdb's a NEW cluster in a temp directory (never an existing data
#     directory, never an existing port);
#   - trust auth, `listen_addresses=127.0.0.1`: loopback only, so the workforce
#     loopback guard accepts it and nothing off-machine can reach it;
#   - the proposed migration SQL is applied by the test itself;
#   - the cluster is stopped and DELETED afterwards, on every exit path.
#
# It does not start, stop or touch any running PostgreSQL service, and it never
# reads DATABASE_URL. Use it to produce the durability evidence; it is not a
# deployment step, and it applies no migration to any real database.
#
# Usage:  bash scripts/run-persistence-proof.sh
#         PROOF_TEST=tests/<another-proof>.test.ts bash scripts/run-persistence-proof.sh
# Env:    PG_BIN        (default: C:/Program Files/PostgreSQL/18/bin)
#         PG_PROOF_PORT (default: an EPHEMERAL free port, allocated per run)
#         PG_PROOF_DATA (default: %LOCALAPPDATA% — the BASE directory the run
#                        directory is created UNDER; it is never emptied or
#                        deleted, so a caller may point at any existing path)
#
# RESOURCE OWNERSHIP. The port is allocated per run and the cluster lives in a run
# directory THIS process creates under that base, MARKED as its own before
# anything is started. Cleanup proves the ownership before it stops a cluster or
# removes a file, so: a caller-supplied base is used as a PARENT and left exactly
# as it was, only the run's own child directory is ever stopped or deleted, and a
# cluster another session started is not a candidate at any point. No listener is
# ever enumerated or terminated.

set -euo pipefail

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"

# Ask the OS for a free loopback port. Two runs therefore cannot pick the same
# one, and nothing already listening can be adopted as "ours".
allocated_port() {
  node -e 'const net=require("node:net");const s=net.createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{const p=s.address().port;console.log(p);s.close();});'
}
PORT="${PG_PROOF_PORT:-$(allocated_port)}"
if [ -z "$PORT" ]; then
  echo "could not allocate a free loopback port (set PG_PROOF_PORT explicitly)" >&2
  exit 2
fi
# The BASE may be caller-supplied; it is a PARENT, never the thing we write into
# directly and never the thing we delete. The run's own directory is a fresh child
# of it, so two runs cannot share state even if both use the same base.
BASE_DIR="${PG_PROOF_DATA:-${LOCALAPPDATA:-/tmp}}"
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
RUN_DIR="$BASE_DIR/nexup-pg-proof-$RUN_TOKEN"
DATA_DIR="$RUN_DIR/data"
LOG_FILE="$RUN_DIR/postgres.log"
# Written BY this run and checked before ANY stop or delete: this marker is how
# cleanup proves the directory it is about to remove is its own.
OWNERSHIP_MARKER="$RUN_DIR/.proof-runner-owned"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Native Windows binaries receive Windows-style paths; keep MSYS from rewriting
# them into something the tools cannot open.
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

# Ownership is PROVEN before anything is stopped or deleted: the marker must exist
# AND carry this run's token. Anything else — a caller's base directory, a
# leftover directory from another run, a path that is merely spelled the same —
# is left untouched.
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
    # `pg_ctl -D <our own data dir> stop` is the ONLY thing stopped here: it acts on
    # the cluster this run created, addressed by its data directory, so no other
    # session's cluster or listener can be reached by this cleanup.
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
    # Removes ONLY the run directory this process created and marked, and only once
    # its cluster is actually gone. The base is the parent of it and is left exactly
    # as it was.
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

# Only now — and only inside our own fresh child directory — create and CLAIM it.
mkdir -p "$RUN_DIR"
printf '%s\n' "$RUN_TOKEN" > "$OWNERSHIP_MARKER"

"$INITDB" -D "$DATA_DIR" -U postgres -A trust --encoding=UTF8 >/dev/null

"$PG_CTL" -D "$DATA_DIR" -l "$LOG_FILE" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
  -w start >/dev/null

# Readiness: an open socket is not enough, so the server must answer a query.
for attempt in $(seq 1 30); do
  if PGPASSWORD=postgres "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = "30" ]; then
    echo "cluster never became ready; log follows" >&2
    cat "$LOG_FILE" >&2 || true
    exit 1
  fi
  sleep 1
done
echo "   ready    : $(PGPASSWORD=postgres "$PSQL" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -tAc 'select version()')"

PROOF_TEST="${PROOF_TEST:-tests/workforce-step5-persistence.test.ts}"
echo "── durability proof ─────────────────────────────────────────────"
echo "   test     : $PROOF_TEST"
# The test creates and drops its own database inside this cluster. Everything
# else in the environment (the bridge E2E variables, for the live variant) is
# inherited unchanged, so the same isolated cluster serves both proofs.
AI_WORKFORCE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT" \
PSQL_BIN="$PSQL" \
  npx vitest run "$PROOF_TEST"
