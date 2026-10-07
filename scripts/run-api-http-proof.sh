#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — the HTTP boundary proof
# ═══════════════════════════════════════════════════════════════════════
#
# Builds the Next application, starts it, speaks HTTP to the REAL routes with a
# REAL signed session cookie, and stops it again.
#
#   tests/workforce-api-http.test.ts
#     signed-out 401 · no-workforce-access 403 · issue a Command · idempotent
#     retry (same mission, no second attempt) · reused key + different command
#     409 · malformed input 400 · read · settle · decision queue · human
#     decision · duplicate decision refused · no secret in any error body
#
# WHAT IT GUARANTEES ABOUT SAFETY:
#
#   - the database is a throwaway database INSIDE the isolated development
#     cluster (`node scripts/dev-db.mjs up` creates it on 127.0.0.1:5501), and
#     DATABASE_URL is pointed at that same cluster, so even the application's
#     legacy pool cannot reach the production Supabase host;
#   - the runtime is the deterministic TEST transport, which the application
#     only honours when persistence resolved to a verified LOOPBACK database;
#   - AUTH_SECRET is a fixed, obviously-fake proof value: it signs the proof's
#     own cookies and is never a real credential.
#
# Usage:  bash scripts/run-api-http-proof.sh
# Env:    DEV_DB_PORT (5501) · PROOF_PORT (3111) · PG_BIN

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
DEV_DB_PORT="${DEV_DB_PORT:-5501}"
PROOF_PORT="${PROOF_PORT:-3111}"
PSQL_BIN="$PG_BIN/psql.exe"
DB_NAME="nexup_http_proof"
PROOF_AUTH_SECRET="nexup-http-proof-not-a-real-secret-0123456789"
SERVER_LOG=".tmp-http-proof-server.log"
RESULTS_FILE=".tmp-http-proof-results.json"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

psql() {
  "$PSQL_BIN" -h 127.0.0.1 -p "$DEV_DB_PORT" -U postgres -w -v ON_ERROR_STOP=1 "$@"
}

echo "── the isolated development cluster ────────────────────────────"
if ! node scripts/dev-db.mjs status --json 2>/dev/null | grep -q '"running": true'; then
  echo "the development cluster is not running — start it with: node scripts/dev-db.mjs up" >&2
  exit 2
fi
node scripts/dev-db.mjs status --json | node -e '
let s=""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const identity = JSON.parse(s);
  console.log(`   cluster     : ${identity.dataDirectory}`);
  console.log(`   listening   : ${identity.listenAddresses}:${identity.port}  (loopback=${identity.isLoopbackConnection})`);
  console.log(`   version     : ${identity.version}`);
  console.log(`   production  : ${identity.productionUrlHost.host} (REPORTED only, never contacted)`);
});'

echo "── the proof database ──────────────────────────────────────────"
psql -c "DROP DATABASE IF EXISTS $DB_NAME" -d postgres >/dev/null
psql -c "CREATE DATABASE $DB_NAME" -d postgres >/dev/null
for migration in AI_WORKFORCE_PHASE_1A AI_WORKFORCE_PHASE_1B AI_WORKFORCE_PHASE_2 AI_WORKFORCE_PHASE_3; do
  psql -f "prisma/proposed-migrations/$migration/migration.sql" -d "$DB_NAME" >/dev/null
done
echo "   database    : $DB_NAME (four proposed migrations applied)"
echo "   migrations  : $(psql -t -A -c "select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai\_%'" -d "$DB_NAME") ai_* tables"

echo "── building the application ────────────────────────────────────"
npx next build --webpack >/dev/null
echo "   build       : ok"

echo "── starting the server ─────────────────────────────────────────"
# The application's own pool is pointed at the DEVELOPMENT cluster too, so no
# code path in this proof can reach the production host even by accident.
AI_WORKFORCE_PERSISTENCE=database \
AI_WORKFORCE_DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/$DB_NAME" \
AI_WORKFORCE_TEST_TRANSPORT=deterministic \
DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/nexup_dev" \
DATABASE_SSL_DISABLE=1 \
AUTH_SECRET="$PROOF_AUTH_SECRET" \
  npx next start -p "$PROOF_PORT" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Stops whatever still holds the proof port. `npx next start` can hand the
# listener to a child that outlives (and is re-parented away from) the wrapper,
# so killing $SERVER_PID alone is not enough — and `kill -0 $SERVER_PID` is
# already false once the wrapper has exited. The port is dedicated to this
# proof, so the listener that owns it is unambiguously ours.
stop_port_listener() {
  if ! command -v taskkill >/dev/null 2>&1; then return 0; fi
  local attempt pids pid
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    # `|| true` inside the substitution: with `set -o pipefail`, a port that is
    # already free makes this pipeline exit non-zero, which would otherwise trip
    # `set -e` and make the script report failure after a wholly successful run.
    pids="$(netstat -ano 2>/dev/null | grep -E ":${PROOF_PORT}[[:space:]]" | grep -i LISTENING | awk '{print $NF}' | sort -u || true)"
    if [ -z "$pids" ]; then return 0; fi
    # taskkill is invoked with the DASH form on purpose: the script sets
    # MSYS2_ARG_CONV_EXCL='*' for psql quoting, which would pass the usual '//F'
    # through literally and make taskkill reject it as an invalid option.
    for pid in $pids; do taskkill -F -PID "$pid" >/dev/null 2>&1 || true; done
    sleep 1
  done
  return 0
}

cleanup() {
  local status=$?
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    if command -v taskkill >/dev/null 2>&1; then
      taskkill -F -T -PID "$SERVER_PID" >/dev/null 2>&1 || kill "$SERVER_PID" 2>/dev/null || true
    else
      kill "$SERVER_PID" 2>/dev/null || true
    fi
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  stop_port_listener
  exit "$status"
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 60); do
  # 401 is the SIGNAL we want: it means the route is mounted, the guard ran and
  # no session was presented. A connection error is not readiness.
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROOF_PORT/api/ai-workforce/missions" || true)"
  if [ "$status" = "401" ]; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "the server exited during startup; log follows" >&2
    cat "$SERVER_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "the server never answered the workforce route; log follows" >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi
echo "   server      : http://127.0.0.1:$PROOF_PORT (pid $SERVER_PID, answered 401 unauthenticated)"

echo "── the HTTP boundary proof ─────────────────────────────────────"
set +e
WORKFORCE_API_BASE_URL="http://127.0.0.1:$PROOF_PORT" \
WORKFORCE_API_DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/$DB_NAME" \
AUTH_SECRET="$PROOF_AUTH_SECRET" \
PSQL_BIN="$PSQL_BIN" \
  npx vitest run tests/workforce-api-http.test.ts --reporter=default --reporter=json --outputFile="$RESULTS_FILE"
STATUS=$?
set -e

echo "── evidence ────────────────────────────────────────────────────"
node - "$RESULTS_FILE" "$STATUS" <<'NODE'
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const [resultsFile, status] = process.argv.slice(2);
let results = null;
try {
  results = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
} catch {
  results = null;
}
const git = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const evidence = {
  proof:
    "the AI Workforce HTTP boundary, exercised against a RUNNING next start server with real signed session cookies, on a throwaway database inside the isolated development cluster",
  generatedAt: new Date().toISOString(),
  exitStatus: status,
  counts: {
    testFiles: results?.numTotalTestSuites ?? null,
    tests: results?.numTotalTests ?? null,
    passed: results?.numPassedTests ?? null,
    failed: results?.numFailedTests ?? null,
    skipped: results?.numPendingTests ?? null,
  },
  assertions: (results?.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      title: test.fullName,
      status: test.status,
    })),
  ),
  testedCommit: git(["rev-parse", "HEAD"]),
  workingTreeDirty: git(["status", "--porcelain"]).length > 0,
  workingTreeChanges: git(["status", "--porcelain"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
  environment: {
    server: `next start on 127.0.0.1, built from this tree`,
    database: "the throwaway 'nexup_http_proof' database inside the isolated development cluster (127.0.0.1)",
    productionDatabase: "NOT touched: DATABASE_URL was pointed at the development cluster too, so not even the legacy pool could reach Supabase",
    runtime: "the deterministic TEST transport, which the application only honours for a verified loopback database",
    auth: "a fixed, obviously-fake AUTH_SECRET used only to sign this proof's own cookies",
  },
  howToReproduce: [
    "node scripts/dev-db.mjs up        # the isolated loopback cluster",
    "bash scripts/run-api-http-proof.sh",
  ],
};
const out = "docs/evidence/step5-http-boundary-2026-10-07.json";
fs.mkdirSync("docs/evidence", { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`   wrote ${out}`);
NODE

if [ "$STATUS" != "0" ]; then
  echo "the HTTP boundary proof FAILED (exit $STATUS) — evidence records the failure" >&2
  exit "$STATUS"
fi

echo "   server stopped; evidence: docs/evidence/step5-http-boundary-2026-10-07.json"
