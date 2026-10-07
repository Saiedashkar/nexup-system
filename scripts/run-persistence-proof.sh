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
# Env:    PG_BIN      (default: C:/Program Files/PostgreSQL/18/bin)
#         PG_PROOF_PORT (default: 5499)

set -euo pipefail

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
PORT="${PG_PROOF_PORT:-5499}"
DATA_DIR="${PG_PROOF_DATA:-${LOCALAPPDATA:-/tmp}/nexup-pg-proof}"
LOG_FILE="${DATA_DIR}.log"

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

cleanup() {
  local status=$?
  if [ -d "$DATA_DIR" ]; then
    "$PG_CTL" -D "$DATA_DIR" stop -m fast >/dev/null 2>&1 || true
    rm -rf "$DATA_DIR"
  fi
  rm -f "$LOG_FILE"
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "── isolated cluster ──────────────────────────────────────────────"
echo "   data dir : $DATA_DIR"
echo "   port     : $PORT (loopback only, trust auth)"

rm -rf "$DATA_DIR"
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
