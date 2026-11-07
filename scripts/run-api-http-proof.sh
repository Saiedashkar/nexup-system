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
#   - the database is a throwaway database (named after the proof's own port)
#     inside an isolated LOOPBACK cluster that THIS run creates — or, when the
#     caller supplies `DEV_DB_PORT`, the one that caller already runs — and
#     DATABASE_URL is pointed at that same cluster, so even the application's
#     legacy pool cannot reach the production Supabase host;
#   - the runtime is the deterministic TEST transport, which the application
#     only honours when persistence resolved to a verified LOOPBACK database;
#   - AUTH_SECRET is a fixed, obviously-fake proof value: it signs the proof's
#     own cookies and is never a real credential.
#
# ── RESOURCE OWNERSHIP (this is why nothing here is fixed) ──
#
# The proof server's port, the proof database's NAME and — unless the caller
# supplies `DEV_DB_PORT` — the development cluster itself are allocated PER RUN:
#
#   * a free loopback port is requested from the OS for the server, and the proof
#     database is named after it, so two sessions running this proof cannot
#     collide and cannot drop each other's database;
#   * with no `DEV_DB_PORT` given, the runner creates its OWN isolated cluster in
#     `nexup-http-proof-<port>` and stops THAT one when it is done. When the
#     caller does supply one, the runner uses (and never stops) it.
#
# Shutdown is ownership-based, and ownership is LINEAGE — never a port number.
# The cleanup stops the process tree this run STARTED, and any listener it RECORDED
# while that tree was up and that is provably inside it. Its exit statuses are
# checked and its termination is VERIFIED; a listener that is not in the tree is
# reported as foreign and left running, because between allocating a port and
# binding it another process can win the race for it, and killing the holder
# because of the number would be killing someone else's server.
#
# Ownership is decided in ONE pid namespace. In Git Bash the shell's `$!`, `ps` and
# `kill` count in MSYS pids while `netstat`, `taskkill` and Node count in WINDOWS
# pids, and for the same process those are DIFFERENT NUMBERS (`ps -W` prints both:
# `PID 5354 … WINPID 17268` for one `sleep`). The tree this run starts is therefore
# translated to its WINDOWS pid ONCE, at start time, through that same platform
# mapping, and every decision after it — who holds the port, what is inside the
# tree, what the stop targets, what the termination check reads — uses that pid.
# Handing `$!` to `taskkill` would have addressed whatever unrelated Windows
# process owned that number, and handing it to the lineage check would have made
# this run's own server look foreign forever, so it would never be stopped.
#
# Cleanup is installed BEFORE any resource is acquired (the run directory, the
# cluster, the server), so a failure during cluster creation or the build still
# unwinds. When shutdown cannot be verified, the run directory and the cluster data
# directory are PRESERVED and the failure is reported — a data directory is never
# deleted while a database may still be live inside it — and `dev-db.mjs destroy`
# refuses the same thing for the same reason.
#
# The server is PINNED to loopback (`next start -H 127.0.0.1`), so the proof
# server cannot listen on another interface even when nothing else about the run
# would have stopped it. Its log and its vitest report live in ONE run directory
# this process creates and marks as its own, and whose removal is gated on that
# marker; the published evidence under `docs/evidence/` is written outside it.
#
# Usage:  bash scripts/run-api-http-proof.sh
# Env:    PG_BIN · PROOF_PORT · DEV_DB_PORT · DEV_DB_DIR · PROOF_RUN_BASE
#         PROOF_FAIL_AT  (i) — failure INJECTION for the safety checks
#                              (`scripts/run-http-proof-safety.sh`): one of
#                              cluster|migration|build|start|shutdown. Unset in
#                              every ordinary run, and a no-op when unset.

set -euo pipefail

# Windows paths go to native binaries unmodified (Git Bash would otherwise rewrite
# `/D`-style arguments into filesystem paths). Done FIRST, because the cleanup path
# calls psql and taskkill too.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
PSQL_BIN="$PG_BIN/psql.exe"

# ── PID NAMESPACES: the shell's (MSYS) vs the platform's (WINDOWS) ────────
# `ps -W` is the platform's OWN translation table — its WINPID column — so this is
# the mapping the OS already maintains rather than a guess about process names.
windows_shell() {
  case "$(uname -s 2>/dev/null)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac
}
winpid_of() {
  local msys_pid="$1" win_pid=""
  [ -n "$msys_pid" ] || return 1
  # On POSIX the shell's pid IS the pid every other tool uses: no mapping needed.
  windows_shell || {
    printf '%s' "$msys_pid"
    return 0
  }
  win_pid="$(ps -W 2>/dev/null | awk -v p="$msys_pid" '$1 == p { print $4; exit }')"
  [ -n "$win_pid" ] || return 1
  printf '%s' "$win_pid"
}
# The REAL node, not Git Bash's `node` shim (itself a shell script that would put a
# wrapper process between this run and the listener). `process.execPath` is the
# node.exe running this line.
NODE_EXE="${NODE_EXE:-$(node -p 'process.execPath' 2>/dev/null || command -v node)}"

PROOF_AUTH_SECRET="nexup-http-proof-not-a-real-secret-0123456789"
# The run's temporary artifacts: per-run names inside a directory THIS run creates
# and marks as its own, so two runs cannot overwrite each other's report and the
# cleanup below has something it can prove it owns before deleting anything.
RUN_TOKEN="$$-$(date +%s)-$RANDOM"
# The BASE the run directory is created UNDER. Caller-supplied or not, it is only
# ever a PARENT: nothing here empties or deletes it, and every removal is gated on a
# marker INSIDE the child this run creates.
RUN_BASE="${PROOF_RUN_BASE:-${LOCALAPPDATA:-/tmp}}"
RUN_DIR="$RUN_BASE/nexup-http-proof-run-$RUN_TOKEN"
SERVER_LOG="$RUN_DIR/server.log"
RESULTS_FILE="$RUN_DIR/vitest-results.json"
OWNERSHIP_MARKER="$RUN_DIR/.proof-runner-owned"
STOP_LOG="$RUN_DIR/shutdown.log"

# ── resources, ALL declared EMPTY until they are acquired ──
# The trap is installed before anything is created, so cleanup can run in the state
# a failure during cluster creation leaves behind. Every variable it touches is
# defined here, so `set -u` cannot turn a cleanup into a second failure, and "empty"
# is the honest answer for "never acquired".
OWNS_CLUSTER=0
# The CALLER's values are captured BEFORE the resource state is reset below. A caller that
# supplies `DEV_DB_PORT` is managing that cluster, and `DEV_DB_DIR` is its data directory —
# the seventh review found this variable cleared here and then re-read from its own empty
# state, so the proof reported the default directory instead of the caller's real one.
# (`DEV_DB_DIR` is METADATA for a caller-managed cluster: with OWNS_CLUSTER=0 this run never
# stops, deletes or otherwise touches it.)
CALLER_DEV_DB_DIR="${DEV_DB_DIR:-}"
DEV_DB_PORT="${DEV_DB_PORT:-}"
DEV_DB_DIR=""
PROOF_PORT="${PROOF_PORT:-}"
DB_NAME=""
SERVER_PID=""
SERVER_MSYS_PID=""
OWNERSHIP_UNRESOLVED=0
RECORDED_LISTENERS=""
OWNED_LISTENERS=""
FOREIGN_LISTENERS=""
STOPPED_PIDS=""
STOP_FAILURES=""
INJECT="${PROOF_FAIL_AT:-}"

# An ephemeral free loopback port, straight from the OS.
allocated_port() {
  node -e 'const net=require("node:net");const s=net.createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{const p=s.address().port;console.log(p);s.close();});'
}

# The PIDs LISTENING on a port. Empty output means nobody is.
listeners_on_port() {
  netstat -ano 2>/dev/null | grep -E ":${1}[[:space:]]" | grep -i LISTENING | awk '{print $NF}' | sort -u || true
}

# A port nobody is listening on, so "who owns this listener" is answered by the
# fact that WE put it there.
pick_free_proof_port() {
  local candidate
  for _ in $(seq 1 20); do
    candidate="$(allocated_port)" || continue
    [ -z "$candidate" ] && continue
    if [ -z "$(listeners_on_port "$candidate")" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# ── the development cluster: ours, or the caller's ──
if [ -n "${DEV_DB_PORT:-}" ]; then
  # An explicit port means the caller is managing that cluster. It is used and
  # left alone — including on failure. The caller's OWN data directory is what gets
  # reported when it supplied one; the default is only a fallback for a caller that
  # named just the port.
  DEV_DB_DIR="${CALLER_DEV_DB_DIR:-${LOCALAPPDATA:-/tmp}/nexup-dev-db}"
else
  OWNS_CLUSTER=1
  DEV_DB_PORT="$(pick_free_proof_port)" || {
    echo "could not allocate a free loopback port for the cluster" >&2
    exit 2
  }
  # Inside the run directory this run owns, together with its ``.log``: removing
  # that directory removes the cluster's remnants, and nothing else.
  DEV_DB_DIR="$RUN_DIR/dev-db"
fi
export DEV_DB_PORT DEV_DB_DIR

# ── OWNERSHIP BY LINEAGE, and a VERIFIED shutdown ─────────────────────────
#
# A PID is OURS when it IS the server this run started, or a DESCENDANT of it.
# The port is NOT evidence: `pick_free_proof_port` asks the OS for a free port, and
# between that answer and `next start` binding it another process can take it. A
# cleanup that kills "whoever holds the port" would then kill a stranger's server;
# a cleanup that kills only its own lineage cannot. The lineage is read at STOP time
# (not at start time), so a listener that appeared later is still judged by
# parentage rather than by arrival order.
is_owned_pid() {
  local pid="$1"
  [ -z "$pid" ] && return 1
  [ -z "$SERVER_PID" ] && return 1
  [ "$pid" = "$SERVER_PID" ] && return 0
  node scripts/process-lineage.mjs owns "$SERVER_PID" "$pid" >/dev/null 2>&1
}

# The log a stop writes to: the run directory's own log when it exists, and
# /dev/null when cleanup runs before the directory was created.
stop_log_target() {
  if [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ]; then printf '%s' "$STOP_LOG"; else printf '/dev/null'; fi
}

# Stops the process tree THIS run started, plus the listeners RECORDED while it was
# up that are provably inside that tree. Exit statuses are COLLECTED rather than
# discarded, and a foreign listener is REPORTED and left running.
stop_owned_processes() {
  [ -n "$SERVER_PID" ] || return 0
  local pid status
  for pid in $SERVER_PID $RECORDED_LISTENERS; do
    [ -z "$pid" ] && continue
    node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1 || continue
    if ! is_owned_pid "$pid"; then
      echo "   foreign     : pid $pid holds port ${PROOF_PORT:-?} but is NOT this run's process — left untouched" >&2
      continue
    fi
    # The `shutdown` injection simulates a kill that does NOT take: it is the only
    # way to exercise the "shutdown not verified" branch without a wedged process.
    if [ "$INJECT" = "shutdown" ]; then
      echo "   injected    : NOT stopping pid $pid (PROOF_FAIL_AT=shutdown)" >&2
      STOPPED_PIDS="$STOPPED_PIDS $pid"
      STOP_FAILURES="$STOP_FAILURES $pid(stop injected as failing)"
      continue
    fi
    STOPPED_PIDS="$STOPPED_PIDS $pid"
    # The exit status is CAPTURED, never merely allowed: under `set -e` a bare
    # failing `taskkill` would abort this trap mid-cleanup (verified), which is the
    # one place a failure must not turn into a second failure.
    if command -v taskkill >/dev/null 2>&1; then
      if taskkill -F -T -PID "$pid" >>"$(stop_log_target)" 2>&1; then status=0; else status=$?; fi
      if [ "$status" != "0" ]; then kill "$pid" 2>/dev/null || true; fi
    else
      if kill "$pid" 2>/dev/null; then status=0; else status=$?; fi
    fi
    if [ "$status" != "0" ] && node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1; then
      STOP_FAILURES="$STOP_FAILURES $pid(stop exit $status)"
    fi
  done
  return 0
}

# TERMINATION IS VERIFIED, not assumed. Every PID this run signalled has to be GONE
# before anything its data directory holds may be deleted.
verify_terminated() {
  local pid attempt
  [ -n "$STOPPED_PIDS" ] || return 0
  for pid in $STOPPED_PIDS; do
    for attempt in $(seq 1 20); do
      node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1; then
      STOP_FAILURES="$STOP_FAILURES $pid(still alive after 10s)"
    fi
  done
  [ -z "$STOP_FAILURES" ]
}

# Ownership is PROVEN before anything is removed: the marker must exist AND carry the
# token this run wrote.
owned_run_dir() {
  [ -d "$RUN_DIR" ] && [ -f "$OWNERSHIP_MARKER" ] && [ "$(cat "$OWNERSHIP_MARKER" 2>/dev/null)" = "$RUN_TOKEN" ]
}

cleanup() {
  local status=$?
  # 1. Remove ONLY the proof-scoped business rows, and only if this proof inserted
  #    them (a pre-existing real row has a different id, so this is a no-op for it).
  psql -d nexup_dev -c "DELETE FROM \"Business\" WHERE id IN ('$PROOF_BIZ_NEXUP_ID', '$PROOF_BIZ_REBOUND_ID')" >/dev/null 2>&1 || true
  # 2. Stop what this run started — by lineage.
  stop_owned_processes
  # 3. VERIFY it. An unverified shutdown is a FAILURE, and nothing below runs.
  #    An unresolved OWNERSHIP is the same kind of failure: a server this run
  #    started but could not address in the platform's own namespace is a server it
  #    cannot prove it stopped, so nothing its data directory holds may be deleted.
  if [ "$OWNERSHIP_UNRESOLVED" = "1" ] || { [ -n "$STOPPED_PIDS" ] && ! verify_terminated; }; then
    echo "SHUTDOWN NOT VERIFIED:${STOP_FAILURES:- ownership of the started server could not be resolved}" >&2
    echo "   PRESERVING $RUN_DIR (its cluster data directory included) and reporting the failure." >&2
    echo "   A data directory is never deleted while a database may still be live inside it." >&2
    echo "   Stop it by hand (taskkill -F -T -PID <pid>), then remove the directory." >&2
    echo "proof-run-dir: $RUN_DIR" >&2
    echo "proof-state: shutdown-unverified" >&2
    [ "$status" = "0" ] && status=1
    exit "$status"
  fi
  # 4. The cluster is destroyed ONLY when this run created it, and only when
  #    `destroy` itself confirms the stop. A refusal preserves the directory.
  if [ "$OWNS_CLUSTER" = "1" ]; then
    if ! node scripts/dev-db.mjs destroy; then
      echo "dev-db.mjs destroy did not confirm the cluster stopped — PRESERVING $DEV_DB_DIR" >&2
      echo "proof-state: cluster-preserved" >&2
      [ "$status" = "0" ] && status=1
      exit "$status"
    fi
  fi
  # 5. The run directory, if this run created it and marked it.
  if owned_run_dir; then
    rm -rf "$RUN_DIR"
  else
    echo "not removing $RUN_DIR: this run did not create it" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# Create and CLAIM the run directory BEFORE anything is started inside it. The
# marker is what the cleanup checks before it stops the cluster or deletes files:
# a directory this run did not create is never touched.
mkdir -p "$RUN_DIR"
printf '%s\n' "$RUN_TOKEN" > "$OWNERSHIP_MARKER"

if [ -z "$PROOF_PORT" ]; then
  PROOF_PORT="$(pick_free_proof_port)" || {
    echo "could not allocate a free loopback port for the proof server" >&2
    exit 2
  }
fi
export PROOF_PORT
# Named after the port, so a parallel run of this proof can neither reuse nor
# drop this run's database.
DB_NAME="nexup_http_proof_$PROOF_PORT"
# Proof-scoped business ids: the cross-business proof seeds `nexup` and `rebound`
# into the schema database and deletes ONLY these ids again, so a real row is
# never touched.
PROOF_BIZ_NEXUP_ID="proof_business_nexup"
PROOF_BIZ_REBOUND_ID="proof_business_rebound"
# The second HUMAN authority the proof attributes a decision to (never the
# Founder channel). Read by the application ONLY in proof mode.
PROOF_HUMAN_ACTOR_ID="actor_proof_reviewer"

psql() {
  "$PSQL_BIN" -h 127.0.0.1 -p "$DEV_DB_PORT" -U postgres -w -v ON_ERROR_STOP=1 "$@"
}

# ── FAILURE INJECTION, for the safety checks only ──
# A no-op unless PROOF_FAIL_AT names the stage. It fails through the SAME cleanup
# path a real failure does, which is the point: a unwind path that only a real
# failure ever exercises is a unwind path nobody has ever seen run.
inject_failure() {
  if [ "$INJECT" = "$1" ]; then
    echo "INJECTED FAILURE at stage '$1' (PROOF_FAIL_AT=$1)" >&2
    return 7
  fi
  return 0
}

echo "── the isolated development cluster ────────────────────────────"
if [ "$OWNS_CLUSTER" = "1" ]; then
  echo "   ownership   : created by THIS run (${DEV_DB_DIR})"
  node scripts/dev-db.mjs up >/dev/null
elif ! node scripts/dev-db.mjs status --json 2>/dev/null | grep -q '"running": true'; then
  echo "the development cluster on port $DEV_DB_PORT is not running — start it, or omit DEV_DB_PORT so this proof creates its own" >&2
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

# FAILURE INJECTION (safety checks only): the cluster is UP and the run directory is
# ours, so cleanup has a cluster of its own to stop and a directory of its own to
# remove — the state a failure during database setup leaves behind.
inject_failure cluster || exit 7

echo "── the proof database ──────────────────────────────────────────"
psql -c "DROP DATABASE IF EXISTS $DB_NAME" -d postgres >/dev/null
psql -c "CREATE DATABASE $DB_NAME" -d postgres >/dev/null
# Step 5A-4 adds AI_WORKFORCE_PHASE_4: the application now owns the DURABLE
# execution claim, so the proof database has to carry the claim ledger. The fifth
# review adds AI_WORKFORCE_PHASE_5: recovery progress lives in the ROWS
# (`recoverySweptAt`), and the durable repositories SELECT that column, so a
# database without it cannot serve the ledger the server is about to use. Still
# PROPOSED SQL applied to a throwaway database — no migration is added to
# prisma/migrations by this proof.
# FAILURE INJECTION (safety checks only): the database exists but carries no schema.
inject_failure migration || exit 7
for migration in AI_WORKFORCE_PHASE_1A AI_WORKFORCE_PHASE_1B AI_WORKFORCE_PHASE_2 AI_WORKFORCE_PHASE_3 AI_WORKFORCE_PHASE_4 AI_WORKFORCE_PHASE_5; do
  psql -f "prisma/proposed-migrations/$migration/migration.sql" -d "$DB_NAME" >/dev/null
done
echo "   database    : $DB_NAME (six proposed migrations applied)"
echo "   migrations  : $(psql -t -A -c "select count(*) from information_schema.tables where table_schema='public' and table_name like 'ai\_%'" -d "$DB_NAME") ai_* tables"

echo "── the business registry (schemas db) ─────────────────────────"
# The session speaks business SLUGS; a mission stores the canonical Business.id.
# The cross-business proof needs both slugs registered in the schema database
# that `@/lib/prisma` reads (nexup_dev). Inserted with `ON CONFLICT DO NOTHING`
# so an existing real row is left exactly as it was.
psql -d nexup_dev -c "INSERT INTO \"Business\" (id, name, slug, \"createdAt\") VALUES ('$PROOF_BIZ_NEXUP_ID', 'Proof NEXUP', 'nexup', now()), ('$PROOF_BIZ_REBOUND_ID', 'Proof REBOUND', 'rebound', now()) ON CONFLICT DO NOTHING" >/dev/null
PROOF_NEXUP_BUSINESS_ID="$(psql -d nexup_dev -t -A -c "select id from \"Business\" where slug = 'nexup'")"
PROOF_REBOUND_BUSINESS_ID="$(psql -d nexup_dev -t -A -c "select id from \"Business\" where slug = 'rebound'")"
echo "   business    : nexup=$PROOF_NEXUP_BUSINESS_ID  rebound=$PROOF_REBOUND_BUSINESS_ID"

echo "── building the application ────────────────────────────────────"
# FAILURE INJECTION (safety checks only): cluster up, schema applied, build never run.
inject_failure build || exit 7
npx next build --webpack >/dev/null
echo "   build       : ok"

echo "── starting the server ─────────────────────────────────────────"
# The application's own pool is pointed at the DEVELOPMENT cluster too, so no
# code path in this proof can reach the production host even by accident.
# The authenticated-user -> HUMAN actor roster (Step 5A-3). Without it the
# decision boundary fails CLOSED by design, so the proof seeds the one mapping
# its signed-in cookie needs: the proof user to the seeded Founder actor.
AI_WORKFORCE_PERSISTENCE=database \
AI_WORKFORCE_DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/$DB_NAME" \
AI_WORKFORCE_TEST_TRANSPORT=deterministic \
AI_WORKFORCE_USER_ACTOR_MAP="{\"proof-user-1\":\"actor_founder\",\"proof-user-2\":\"$PROOF_HUMAN_ACTOR_ID\"}" \
AI_WORKFORCE_PROOF_HUMAN_ACTORS="[{\"id\":\"$PROOF_HUMAN_ACTOR_ID\",\"slug\":\"proof-reviewer\",\"displayName\":\"Proof Reviewer\"}]" \
DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/nexup_dev" \
DATABASE_SSL_DISABLE=1 \
AUTH_SECRET="$PROOF_AUTH_SECRET" \
  "$NODE_EXE" node_modules/next/dist/bin/next start -p "$PROOF_PORT" -H 127.0.0.1 >"$SERVER_LOG" 2>&1 &
# The shell's pid for the tree, then the WINDOWS pid every ownership decision below
# is made in. A server this run cannot prove it owns is a server it must not leave
# running, so an unresolvable translation is a FAILURE here (the run directory and
# the cluster are preserved by cleanup, exactly as for an unverified shutdown)
# rather than a server that is started and then orphaned.
SERVER_MSYS_PID=$!
if ! SERVER_PID="$(winpid_of "$SERVER_MSYS_PID")"; then
  echo "cannot resolve the WINDOWS pid of the server this run just started (msys pid $SERVER_MSYS_PID)" >&2
  echo "   stopping it in the only namespace this shell can address, and preserving everything else." >&2
  OWNERSHIP_UNRESOLVED=1
  kill "$SERVER_MSYS_PID" 2>/dev/null || true
  echo "proof-state: ownership-unresolved" >&2
  exit 1
fi
# FAILURE INJECTION (safety checks only): the server HAS been started, so cleanup
# has a process tree of its own to stop.
inject_failure start || exit 7


ready=0
for _ in $(seq 1 60); do
  # 401 is the SIGNAL we want: it means the route is mounted, the guard ran and
  # no session was presented. A connection error is not readiness.
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROOF_PORT/api/ai-workforce/missions" || true)"
  if [ "$status" = "401" ]; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_MSYS_PID" 2>/dev/null; then
    echo "the server exited during startup; log follows" >&2
    cat "$SERVER_LOG" >&2 || true
    holder="$(listeners_on_port "$PROOF_PORT")"
    if [ -n "$holder" ]; then
      echo "port $PROOF_PORT is held by pid(s) ${holder}, which this run did NOT start: a foreign listener won the race for the allocated port. It is left running and is never a kill target." >&2
      echo "proof-foreign-pids:$holder" >&2
    fi
    echo "proof-state: start-failed" >&2
    exit 1
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "the server never answered the workforce route; log follows" >&2
  cat "$SERVER_LOG" >&2 || true
  echo "proof-state: not-ready" >&2
  exit 1
fi
# The listeners are RECORDED here and OWNED by LINEAGE, not by port number: the
# port was free when it was allocated, but another process can win it afterwards, so
# each recorded PID is classified against the tree this run started. A listener that
# is not in that tree is FOREIGN: it is reported, and it is left running.
RECORDED_LISTENERS="$(listeners_on_port "$PROOF_PORT")"
OWNED_LISTENERS=""
FOREIGN_LISTENERS=""
for pid in $RECORDED_LISTENERS; do
  if is_owned_pid "$pid"; then
    OWNED_LISTENERS="$OWNED_LISTENERS $pid"
  else
    FOREIGN_LISTENERS="$FOREIGN_LISTENERS $pid"
  fi
done
echo "   server      : http://127.0.0.1:$PROOF_PORT (windows pid $SERVER_PID, msys pid $SERVER_MSYS_PID, answered 401 unauthenticated)"
echo "   owned pids  : ${OWNED_LISTENERS:-none recorded (netstat reported no listener, so ownership rests on the started tree alone)}"
if [ -n "$FOREIGN_LISTENERS" ]; then
  echo "   foreign pids:${FOREIGN_LISTENERS} — NOT this run processes; reported and left running" >&2
fi
# The listener that ANSWERED this run's readiness probe has to be inside the tree
# this run started. If it is not, this run can USE it but can never STOP it, and
# continuing would publish evidence from a server it cannot clean up — so it fails
# here, with the run directory preserved, instead of leaking one at the end.
if [ -n "$RECORDED_LISTENERS" ] && [ -z "$OWNED_LISTENERS" ]; then
  echo "the listener on port $PROOF_PORT that answered this run's readiness probe is NOT in the tree this run started (pids:${RECORDED_LISTENERS})" >&2
  echo "   refusing to treat this run as owning the port it is serving on." >&2
  echo "proof-state: listener-not-owned" >&2
  exit 1
fi
# Machine-readable resource lines, for the safety checks that assert what a failure
# left behind (and what it did not touch).
echo "proof-run-dir: $RUN_DIR"
echo "proof-server-pid: $SERVER_PID"
echo "proof-server-msys-pid: $SERVER_MSYS_PID"
echo "proof-cluster-dir: $DEV_DB_DIR"
echo "proof-cluster-port: $DEV_DB_PORT"
echo "proof-state: server-ready"

# The `shutdown` injection aborts HERE: the server is up and owned (which is all the
# shutdown path needs) and the HTTP suite is not run, so the failure is cheap to
# reproduce. `stop_owned_processes` is what makes that stage's stop fail.
if [ "$INJECT" = "shutdown" ]; then
  echo "INJECTED FAILURE: aborting with the server still up so cleanup must stop it (PROOF_FAIL_AT=shutdown)" >&2
  exit 7
fi

echo "── the HTTP boundary proof ─────────────────────────────────────"
set +e
WORKFORCE_API_BASE_URL="http://127.0.0.1:$PROOF_PORT" \
WORKFORCE_API_DATABASE_URL="postgresql://postgres@127.0.0.1:$DEV_DB_PORT/$DB_NAME" \
AUTH_SECRET="$PROOF_AUTH_SECRET" \
PSQL_BIN="$PSQL_BIN" \
WORKFORCE_PROOF_NEXUP_BUSINESS_ID="$PROOF_NEXUP_BUSINESS_ID" \
WORKFORCE_PROOF_REBOUND_BUSINESS_ID="$PROOF_REBOUND_BUSINESS_ID" \
WORKFORCE_PROOF_HUMAN_ACTOR_ID="$PROOF_HUMAN_ACTOR_ID" \
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
    // stderr is DISCARDED on purpose: `ls-files --error-unmatch` reports an
    // untracked file on stderr, which is a legitimate answer here ("untracked"),
    // not a failure — and it must not be echoed as if something went wrong.
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
    server: `next start PINNED to 127.0.0.1 (-H), built from this tree`,
    database: "the throwaway 'nexup_http_proof' database inside the isolated development cluster (127.0.0.1)",
    productionDatabase: "NOT touched: DATABASE_URL was pointed at the development cluster too, so not even the legacy pool could reach Supabase",
    runtime: "the deterministic TEST transport, which the application only honours for a verified loopback database",
    auth: "a fixed, obviously-fake AUTH_SECRET used only to sign this proof's own cookies",
  },
  howToReproduce: [
    "bash scripts/run-api-http-proof.sh    # allocates its own free ports and proof database, and creates its own cluster unless DEV_DB_PORT is set",
    "# or, against a cluster you already run: DEV_DB_PORT=5501 bash scripts/run-api-http-proof.sh",
  ],
};
// THE CANONICAL MANIFEST (nexup-evidence-manifest/1): paths SORTED, with a content
// hash and a size per file, plus a digest over the canonical form — the format is
// documented in `scripts/evidence-manifest.mjs`, and it is re-derivable by an
// independent reader with
//   node scripts/verify-evidence-manifest.mjs docs/evidence/<this file>
// which checks both the digest and every recorded hash against the file on disk.
const manifestPaths = [
  "src/modules/workforce/execution/execution-claim.ts",
  "src/modules/workforce/execution/execution-reconciler.ts",
  "src/modules/workforce/execution/capability-execution-service.ts",
  "src/modules/workforce/persistence/prisma-execution-claim-repository.ts",
  "src/modules/workforce/application/command-service.ts",
  "src/app/api/ai-workforce/missions/route.ts",
  "src/app/api/ai-workforce/decisions/route.ts",
  "src/app/api/ai-workforce/missions/[id]/route.ts",
  "tests/workforce-api-http.test.ts",
  "scripts/run-api-http-proof.sh",
  "scripts/run-http-proof-safety.sh",
  "scripts/dev-db.mjs",
  "scripts/dev-db-ownership.mjs",
  "scripts/process-lineage.mjs",
  "scripts/evidence-manifest.mjs",
  "scripts/verify-evidence-manifest.mjs",
];
evidence.resourceOwnership =
  "the proof server ran on an OS-allocated free port, PINNED to 127.0.0.1, with a per-port database name, and the development cluster was created by THIS run in its own data directory under a run directory that carries this run's ownership marker (unless DEV_DB_PORT was supplied, in which case the caller's cluster was used and left running). Ownership is decided in ONE pid namespace: the tree this run starts is translated to its WINDOWS pid through the platform's own mapping (`ps -W`, whose WINPID column is the OS's own table) at start time, because Git Bash's `$!` counts in MSYS pids and a `$!` handed to `taskkill` would address an unrelated Windows process — and a listener that answered the readiness probe but is not in the started tree fails the run before any work is done on it. Cleanup stopped only the process TREE this run started — ownership is decided by process LINEAGE, never by the port number, so a foreign listener that won the race for the allocated port is reported and left running — checked the exit status of every stop, and VERIFIED termination before deleting anything. When termination could not be verified the run directory and the cluster data directory were PRESERVED and the failure was reported; `node scripts/dev-db.mjs destroy` refuses the same thing for the same reason. Termination and preservation are exercised by `bash scripts/run-http-proof-safety.sh`.";
// Step 5A-4 evidence is written to its OWN artifact: the Step-5 record
// (`step5-http-boundary-2026-10-07.json`) is a reviewed result of the batch
// before this one, and re-running the proof must not rewrite it.
const out = "docs/evidence/step5a4-http-boundary-2026-10-10.json";
import("./scripts/evidence-manifest.mjs").then(({ buildManifest }) => {
  evidence.manifest = buildManifest(manifestPaths);
  fs.mkdirSync("docs/evidence", { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`   wrote ${out}`);
  console.log(`   manifest digest: ${evidence.manifest.digest}`);
});
NODE

# The manifest is re-derived by an INDEPENDENT reader before the run reports success:
# the digest is checked against the list, and every recorded hash against the file on disk.
node scripts/verify-evidence-manifest.mjs docs/evidence/step5a4-http-boundary-2026-10-10.json

if [ "$STATUS" != "0" ]; then
  echo "the HTTP boundary proof FAILED (exit $STATUS) — evidence records the failure" >&2
  exit "$STATUS"
fi

echo "   server stopped; evidence: docs/evidence/step5a4-http-boundary-2026-10-10.json"
echo "proof-state: ok"
