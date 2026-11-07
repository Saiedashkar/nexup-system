#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — the APPLICATION acceptance proof
# ═══════════════════════════════════════════════════════════════════════
#
# Runs the two proofs that grade the application boundary, on the ISOLATED
# development cluster, and writes reproducible evidence:
#
#   tests/workforce-step5-app-integration.test.ts
#     Command → Mission → Task → Actor → capability → Runtime → Execution
#     → Review → human decision → COMPLETED, plus Command idempotency
#     (retry → same mission, no duplicate execution; reused key → refused).
#
#   tests/workforce-step5-app-restart.test.ts
#     REAL OS processes: A exits holding an open human decision (or an in-flight
#     run), B rehydrates it from the rows and completes the mission, C RE-ADOPTS
#     the in-flight execution without resubmitting it, and E covers the run the
#     provider no longer knows (UNKNOWN → escalated to a human).
#
# It needs the isolated development cluster (port 5501 by default):
#
#   node scripts/dev-db.mjs up        # creates it + the pre-migration schema
#
# The cluster is reused if it is already running. This script never connects
# anywhere but 127.0.0.1, and it never reads DATABASE_URL.
#
# Usage:  bash scripts/run-app-proof.sh
# Env:    APP_PROOF_DATA (default: %LOCALAPPDATA% — the BASE directory a
#                        per-run scratch directory is created UNDER; the base
#                        itself is never emptied or deleted)
#
# RESOURCE OWNERSHIP. This run does not own the development cluster (it reuses
# whatever is already running), so ownership here covers its SCRATCH FILES only:
# the vitest JSON report and the log live in a run directory THIS process creates
# under the base and MARKS as its own, never in the repository root and never in
# a shared fixed name, so two concurrent runs cannot overwrite each other. Cleanup
# proves the ownership before it removes anything, so a caller-supplied base is
# only ever a parent and a directory this run did not create is left untouched.
# The PUBLISHED evidence under `docs/evidence/` is deliberately outside the run
# directory and survives the run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${DEV_DB_PORT:-5501}"
export AI_WORKFORCE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${PORT}"
export PSQL_BIN="${PSQL_BIN:-C:/Program Files/PostgreSQL/18/bin/psql.exe}"
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# Per-run scratch: a fresh child of the base, marked as this run's before anything
# is written, so the JSON report and log can never collide with another run's and
# the repository root stays clean.
BASE_DIR="${APP_PROOF_DATA:-${LOCALAPPDATA:-/tmp}}"
RUN_TOKEN="$$-$(date +%s)-$RANDOM"
RUN_DIR="$BASE_DIR/nexup-app-proof-$RUN_TOKEN"
RESULTS_FILE="$RUN_DIR/vitest-results.json"
PROOF_LOG="$RUN_DIR/proof.log"
OWNERSHIP_MARKER="$RUN_DIR/.proof-runner-owned"

# Ownership is PROVEN before anything is removed: the marker must exist AND carry
# the token this run wrote. A caller's base, a leftover directory, or a path that
# merely looks like ours is left untouched.
owned_run_dir() {
  [ -d "$RUN_DIR" ] && [ -f "$OWNERSHIP_MARKER" ] && [ "$(cat "$OWNERSHIP_MARKER" 2>/dev/null)" = "$RUN_TOKEN" ]
}

cleanup() {
  local status=$?
  if owned_run_dir; then
    # Removes ONLY the scratch directory this process created and marked. The base
    # is its parent and is left exactly as it was; the published evidence lives
    # outside it and is never a candidate.
    rm -rf "$RUN_DIR"
  else
    echo "not removing $RUN_DIR: this run did not create it" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# Create and CLAIM the scratch directory before a single file is written into it.
mkdir -p "$RUN_DIR"
printf '%s\n' "$RUN_TOKEN" > "$OWNERSHIP_MARKER"

if ! node scripts/dev-db.mjs status 2>/dev/null | grep -q '"running": true'; then
  echo "── starting the isolated development cluster ────────────────────"
  node scripts/dev-db.mjs up
fi

echo "── application acceptance proof ────────────────────────────────"
echo "   database : ${AI_WORKFORCE_TEST_DATABASE_URL}"
echo "   tests    : tests/workforce-step5-app-integration.test.ts"
echo "              tests/workforce-step5-app-restart.test.ts"

set +e
npx vitest run \
  tests/workforce-step5-app-integration.test.ts \
  tests/workforce-step5-app-restart.test.ts \
  --reporter=default --reporter=json --outputFile="$RESULTS_FILE" 2>&1 | tee "$PROOF_LOG"
STATUS=${PIPESTATUS[0]}
set -e

node scripts/write-app-proof-evidence.mjs "$RESULTS_FILE" "$STATUS"

if [ "$STATUS" != "0" ]; then
  echo "the application proof FAILED (exit $STATUS) — evidence records the failure" >&2
  exit "$STATUS"
fi

echo "evidence: docs/evidence/step5-app-acceptance-2026-10-07.json"
