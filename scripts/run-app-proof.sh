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
#     two/three REAL OS processes: A exits holding an open human decision, B
#     rehydrates it from the rows and completes the mission, C measures the
#     in-flight-handle case that does not work.
#
# It needs the isolated development cluster (port 5501 by default):
#
#   node scripts/dev-db.mjs up        # creates it + the pre-migration schema
#
# The cluster is reused if it is already running. This script never connects
# anywhere but 127.0.0.1, and it never reads DATABASE_URL.
#
# Usage:  bash scripts/run-app-proof.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${DEV_DB_PORT:-5501}"
export AI_WORKFORCE_TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:${PORT}"
export PSQL_BIN="${PSQL_BIN:-C:/Program Files/PostgreSQL/18/bin/psql.exe}"
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

RESULTS_FILE=".tmp-app-proof-results.json"
PROOF_LOG=".tmp-app-proof.log"

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
