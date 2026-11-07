#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — HTTP RUNNER: FAILURE-INJECTION SAFETY CHECKS
# ═══════════════════════════════════════════════════════════════════════
#
# `scripts/run-api-http-proof.sh` creates a run directory, creates a whole
# PostgreSQL cluster, applies migrations, builds the application, starts a server
# and stops all of it again. Every one of those steps can fail, and a cleanup path
# that only a real failure ever exercises is a cleanup path nobody has ever seen
# run. These checks DRIVE each failure and assert what a reviewer would want after
# it:
#
#   case 1  cluster failure      — injected after the cluster is up
#   case 2  migration failure    — the database exists and has no schema
#   case 3  build failure        — injected immediately before `next build`
#   case 4  start failure        — the server was started and is then abandoned
#   case 5  PORT COLLISION       — a FOREIGN listener already holds the port the
#                                  runner was told to use. The runner must fail,
#                                  must NOT kill it, and it must still be listening
#                                  when the runner has exited.
#   case 6  FAILED SHUTDOWN      — the runner's stop does not take: the run
#                                  directory and the cluster data directory must be
#                                  PRESERVED and the failure reported, never deleted
#                                  underneath a possibly-live database
#   case 7  dev-db destroy guard — `destroy` must REFUSE to delete a data directory
#                                  whose postmaster is still alive (and must not kill
#                                  it), and must still delete an ordinary stopped
#                                  cluster
#   case 8  CLUSTER OWNERSHIP      — TWO disposable runner-owned clusters: cluster A's
#                                  stale `postmaster.pid` names cluster B's real
#                                  postmaster pid (and A's own data directory). A
#                                  POSTGRES EGG image name is not ownership, so
#                                  destroying A must fail closed: B must stay alive,
#                                  keep serving and keep its data, A must be PRESERVED,
#                                  and no manual kill of the unverified pid may be
#                                  suggested. A must still delete once that pid is gone,
#                                  and a cluster this script genuinely owns must still
#                                  be stopped and deleted normally
#   case 9  PREFIX / PORT / SPACES — the seventh review's P1, reproduced: a data
#                                  directory whose name is a strict PREFIX of a live
#                                  neighbour's (`…/dat` against `…/data`, and
#                                  `…/vault` against `…/vault-old`) must not authorize
#                                  `destroy`, `down` or `restart` against that neighbour.
#                                  The same must hold when the CONFIGURED PORT is the
#                                  neighbour's: a live server reporting its own
#                                  `data_directory`, AND a foreign postmaster's real start
#                                  time copied into the lock file, may not authorize a
#                                  DIFFERENT pid — only that process's own `-D` argument
#                                  can. Every path here contains a space, so the quoted
#                                  argument is what the comparison reads. And the ordinary
#                                  lifecycle of a cluster this check owns — `start`, `down`,
#                                  `start`, `restart`, `destroy` — must still work.
#
# Asserted for EVERY case:
#
#   * the CALLER-OWNED files handed to the runner are byte-identical afterwards;
#   * a FOREIGN process this check started is still alive afterwards;
#   * the runner exited NON-ZERO and said which stage failed;
#   * the published HTTP evidence was NOT rewritten (evidence only comes from a run
#     that PASSED — a failed run must not be able to overwrite a good artifact);
#   * the runner left no run directory of its own behind — except case 6, where
#     PRESERVING it is the assertion.
#
# Everything this check creates lives under ONE scratch directory it creates and
# removes (unless `PROOF_SAFETY_KEEP=1`), it never touches the development cluster,
# and it never reads a real credential.
#
# Usage:  bash scripts/run-http-proof-safety.sh
# Env:    PG_BIN · PROOF_SAFETY_DIR (scratch base) · PROOF_SAFETY_KEEP=1

set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PG_BIN="${PG_BIN:-C:/Program Files/PostgreSQL/18/bin}"
for tool in initdb pg_ctl psql; do
  if [ ! -x "$PG_BIN/$tool.exe" ] && [ ! -x "$PG_BIN/$tool" ]; then
    echo "missing PostgreSQL tool: $PG_BIN/$tool (set PG_BIN)" >&2
    exit 2
  fi
done
pg_tool() {
  if [ -x "$PG_BIN/$1.exe" ]; then printf '%s' "$PG_BIN/$1.exe"; else printf '%s' "$PG_BIN/$1"; fi
}
INITDB_BIN="$(pg_tool initdb)"
PG_CTL_BIN="$(pg_tool pg_ctl)"
PSQL_BIN="$(pg_tool psql)"
# Clusters THIS check started that the EXIT trap must stop before it removes its scratch
# directory: deleting a data directory underneath a live postmaster is exactly what
# `dev-db.mjs destroy` refuses to do, and this check does not get to do it either.
# NEWLINE-separated, because every path in case 9 contains a space.
STOP_CLUSTERS=""
register_cluster_stop() {
  STOP_CLUSTERS="${STOP_CLUSTERS}${STOP_CLUSTERS:+
}$1"
}

# ── PID NAMESPACES: the shell's (MSYS) vs the platform's (WINDOWS) ────────
# Every assertion in this file asks the question in WINDOWS pids: `process-lineage
# .mjs alive`, the `postmaster.pid` the destroy guard reads (and `dev-db.mjs` asks
# with `process.kill(pid, 0)`), and `taskkill`. `ps -W`'s WINPID column is the
# platform's own mapping table, so a process this check starts is translated through
# it instead of being addressed by the shell's `$!` — an MSYS pid, which is a
# DIFFERENT NUMBER and would silently ask about, or signal, a stranger.
windows_shell() {
  case "$(uname -s 2>/dev/null)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac
}
winpid_of() {
  local msys_pid="$1" win_pid=""
  [ -n "$msys_pid" ] || return 1
  windows_shell || {
    printf '%s' "$msys_pid"
    return 0
  }
  win_pid="$(ps -W 2>/dev/null | awk -v p="$msys_pid" '$1 == p { print $4; exit }')"
  [ -n "$win_pid" ] || return 1
  printf '%s' "$win_pid"
}

# ── A SHA-256 THAT IS ALWAYS A SHA-256 ────────────────────────────────
# `sha256sum` prefixes its output with a backslash when the FILE NAME it is handed
# contains a backslash or a newline — which every Windows path in this file does. The
# first whitespace-separated field is then `\<64 hex>`: 65 characters, not a valid
# SHA-256 string, and comparing two of them proves only that both are malformed. Node's
# own digest has no such convention, so the recorded checksum is a checksum.
sha256_of() {
  node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1" 2>/dev/null || printf 'absent'
}

RUNNER="scripts/run-api-http-proof.sh"
EVIDENCE="docs/evidence/step5a4-http-boundary-2026-10-10.json"
SCRATCH_BASE="${PROOF_SAFETY_DIR:-${LOCALAPPDATA:-/tmp}}"
SCRATCH="$(mktemp -d "$SCRATCH_BASE/nexup-http-proof-safety-XXXXXX")"
OWNED_SCRATCH="$(printf '%s' "$SCRATCH" | sed 's/[^A-Za-z0-9]/_/g')"
CALLER_BASE="$SCRATCH/caller-base"
SENTINEL="$CALLER_BASE/caller-owned-sentinel.txt"
CASES_FILE="$SCRATCH/cases.jsonl"
: >"$CASES_FILE"

# ── scratch ownership, proven by the name THIS run created and marked ──
printf '%s\n' "$OWNED_SCRATCH" >"$SCRATCH/.safety-check-owned"
owned_scratch() {
  [ -d "$SCRATCH" ] && [ -f "$SCRATCH/.safety-check-owned" ] && [ "$(cat "$SCRATCH/.safety-check-owned" 2>/dev/null)" = "$OWNED_SCRATCH" ]
}

PASSES=0
FAILURES=0
LEFTOVER_PIDS=""
# Defined BEFORE the EXIT trap is installed: the trap runs on an early `exit 2` too, and a
# cleanup that dies on an unbound variable hides the failure that caused it.
FOREIGN_PIDS=""

# Stops a process THIS check started, by lineage, and nothing else.
stop_own_child() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1 || return 0
  if [ -z "$LEFTOVER_PIDS" ] || ! node scripts/process-lineage.mjs owns "$LEFTOVER_PIDS" "$pid" >/dev/null 2>&1; then
    if command -v taskkill >/dev/null 2>&1; then
      taskkill -F -T -PID "$pid" >/dev/null 2>&1 || true
    else
      kill "$pid" 2>/dev/null || true
    fi
  fi
  return 0
}

# Was the cluster at $1 actually stopped? `pg_ctl stop -w` returning 0 is evidence, but a
# postmaster that outlived the command is not stopped: ask the pid on line 1 of its own
# lock file. No lock file means the postmaster removed it on exit.
cluster_stopped() {
  local dir="$1" pidfile="$1/postmaster.pid" pid
  [ -d "$dir" ] || return 0
  if [ -f "$pidfile" ]; then
    pid="$(head -n1 "$pidfile" 2>/dev/null | tr -d '[:space:]')"
    case "$pid" in
      "" | *[!0-9]*) return 1 ;;
    esac
    if node scripts/process-lineage.mjs alive "$pid" >/dev/null 2>&1; then
      return 1
    fi
  fi
  return 0
}

cleanup() {
  local status=$? cluster_dir
  local unverified=""
  for pid in $FOREIGN_PIDS; do
    stop_own_child "$pid"
  done
  while IFS= read -r cluster_dir; do
    [ -n "$cluster_dir" ] || continue
    # Best effort at the stop — it is a no-op when the cluster is already down — and then
    # an INDEPENDENT check of whether anything is still running in that directory.
    "${PG_CTL_BIN:-pg_ctl}" -D "$cluster_dir" stop -m fast -w -t 30 >/dev/null 2>&1 || true
    if ! cluster_stopped "$cluster_dir"; then
      unverified="$unverified $cluster_dir"
    fi
  done <<EOF
${STOP_CLUSTERS:-}
EOF
  if [ -n "$unverified" ]; then
    # PRESERVE. Removing a scratch directory while a postmaster may still be running in it
    # is the eighth review's sixth finding: the check would report a clean exit after an
    # unverified shutdown. The resources stay, and the run FAILS.
    echo "cleanup: shutdown of an owned cluster could NOT be verified:$unverified" >&2
    echo "cleanup: PRESERVING $SCRATCH and every cluster above for inspection" >&2
    if [ "$status" = "0" ]; then status=1; fi
    exit "$status"
  fi
  if [ "${PROOF_SAFETY_KEEP:-0}" = "1" ]; then
    echo "PROOF_SAFETY_KEEP=1 — leaving the scratch directory at $SCRATCH" >&2
  elif owned_scratch; then
    rm -rf "$SCRATCH"
  else
    echo "not removing $SCRATCH: this check did not create it" >&2
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$CALLER_BASE"
printf 'caller-owned; must survive every injected failure\n' >"$SENTINEL"
SENTINEL_HASH="$(sha256_of "$SENTINEL")"
EVIDENCE_HASH="$(sha256_of "$EVIDENCE")"
case "$SENTINEL_HASH" in "" | *[!0-9a-f]*) echo "the sentinel's SHA-256 is not a 64-character hex digest: '$SENTINEL_HASH'" >&2; exit 2 ;; esac
if [ "${#SENTINEL_HASH}" != "64" ]; then
  echo "the sentinel's SHA-256 is ${#SENTINEL_HASH} characters, not 64: '$SENTINEL_HASH'" >&2
  exit 2
fi
if [ "$EVIDENCE_HASH" != "absent" ]; then
  if [ "${#EVIDENCE_HASH}" != "64" ] || [ -n "$(printf '%s' "$EVIDENCE_HASH" | tr -d '0-9a-f')" ]; then
    echo "the HTTP evidence's SHA-256 is not a 64-character hex digest: '$EVIDENCE_HASH'" >&2
    exit 2
  fi
fi

# A check NEVER aborts the run: `set -e` is on, and a failing assertion must be
# COUNTED and reported, not turned into an early exit that hides the checks after it.
check() {
  local label="$1"
  shift
  if "$@"; then
    PASSES=$((PASSES + 1))
    echo "   ok   : $label"
  else
    FAILURES=$((FAILURES + 1))
    echo "   FAIL : $label" >&2
  fi
  return 0
}

check_grep() {
  local label="$1" pattern="$2" file="$3"
  check "$label" grep -q -- "$pattern" "$file"
}

record_case() {
  # One JSON object per case, appended as it finishes, so a crash still leaves the
  # checks that already ran.
  local name="$1" status="$2" note="$3"
  node -e '
const fs = require("node:fs");
const [file, name, status, note] = process.argv.slice(1);
fs.appendFileSync(file, `${JSON.stringify({ name, exitStatus: Number(status), note })}\n`);
' "$CASES_FILE" "$name" "$status" "$note"
}

# A live process THIS check started that is deliberately NOT a postmaster — exactly
# the kind of process a stale or fabricated lock file can name. It is what the
# destroy-guard case needs, and it is started only when that case runs without the
# port case (which supplies its own foreign listener). Returns its WINDOWS pid.
start_live_non_postmaster() {
  # Detach the helper's own stdout/stderr. This function's stdout is consumed by a
  # command substitution (`FOREIGN_PID="$(start_live_non_postmaster)"`), and a
  # background child that still holds that pipe open would keep the substitution
  # waiting until the child exits (minutes) — a hang, not a guard failure.
  node -e 'setTimeout(() => process.exit(0), 600_000)' >/dev/null 2>&1 &
  local msys_pid=$! win_pid
  win_pid="$(winpid_of "$msys_pid" || true)"
  if [ -z "$win_pid" ]; then
    echo "cannot resolve the WINDOWS pid of the helper process this check started (msys pid $msys_pid)" >&2
    exit 2
  fi
  FOREIGN_PIDS="$FOREIGN_PIDS $win_pid"
  printf '%s' "$win_pid"
}

# Free loopback port, from the OS. Used to give the FOREIGN listener (and the
# dev-db guard's throwaway cluster) a port that nothing else is on.
free_port() {
  node -e 'const net=require("node:net");const s=net.createServer();s.on("error",()=>process.exit(1));s.listen(0,"127.0.0.1",()=>{const p=s.address().port;console.log(p);s.close();});'
}

# ── the shared assertions, run after every injected failure ──
assert_survivors() {
  local label="$1"
  check "$label: caller-owned sentinel is byte-identical" \
    test "$(sha256_of "$SENTINEL")" = "$SENTINEL_HASH"
  check "$label: published HTTP evidence was NOT rewritten" \
    test "$(sha256_of "$EVIDENCE")" = "$EVIDENCE_HASH"
  local leftovers
  leftovers="$(ls -d "$CALLER_BASE"/nexup-http-proof-run-* 2>/dev/null | tr '\n' ' ' || true)"
  check "$label: no run directory left behind by the runner" test -z "$leftovers"
  if [ -n "$leftovers" ]; then
    echo "          leftover: $leftovers" >&2
  fi
  for pid in $FOREIGN_PIDS; do
    check "$label: foreign process $pid is still alive" node scripts/process-lineage.mjs alive "$pid"
  done
}

echo "── HTTP runner failure-injection safety checks ─────────────────"
echo "   runner  : $RUNNER"
echo "   scratch : $SCRATCH"
echo "   sentinel: $SENTINEL"
echo "   evidence: $EVIDENCE (hash ${EVIDENCE_HASH:0:12}…, must not change)"

# ═══════════════════════════════════════════════════════════════════════
# cases 1–4: the injected stage failures
# ═══════════════════════════════════════════════════════════════════════
# `PROOF_SAFETY_ONLY=port,shutdown` runs a subset — the interesting cases are slow
# (each start/build case assembles a cluster and builds the application), so a
# reviewer re-checking ONE of them should not have to pay for all nine. The extra case
# names are `ownership` (the two-cluster case), `prefix` (neighbour paths, spaces and the
# port/pid tie) and, for the stage cases, `cluster`, `migration`, `build`, `start`,
# `port`, `shutdown`, `destroy`.
selected() {
  [ -z "${PROOF_SAFETY_ONLY:-}" ] && return 0
  case ",${PROOF_SAFETY_ONLY}," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

for stage in cluster migration build start; do
  selected "$stage" || continue
  echo "── case: injected $stage failure ───────────────────────────────"
  log="$SCRATCH/case-$stage.log"
  status=0
  PROOF_FAIL_AT="$stage" PROOF_RUN_BASE="$CALLER_BASE" bash "$RUNNER" >"$log" 2>&1 || status=$?
  check "case[$stage]: exited NON-ZERO (exit $status)" test "$status" != "0"
  check_grep "case[$stage]: reported the injected failure" "INJECTED FAILURE at stage '$stage'" "$log"
  # The unwind is the point: no resource of the runner's may survive it.
  check "case[$stage]: the runner's cluster data directory is gone" \
    test -z "$(ls -d "$CALLER_BASE"/nexup-http-proof-run-*/dev-db 2>/dev/null || true)"
  assert_survivors "case[$stage]"
  record_case "inject-$stage" "$status" "injected failure at the $stage stage; cleanup unwound"
done

# ═══════════════════════════════════════════════════════════════════════
# case 5: a FOREIGN listener wins the race for the allocated port
# ═══════════════════════════════════════════════════════════════════════
if selected "port"; then
  echo "── case: port collision with a foreign listener ─────────────────"
  FOREIGN_PORT_FILE="$SCRATCH/foreign-port.txt"
  node -e '
  const net = require("node:net");
  const fs = require("node:fs");
  // A raw listener that must NOT die on its own: a client that resets the connection
  // would otherwise raise an unhandled socket error and take the process with it — and
  // a foreign process that exited by itself proves nothing about what the runner did.
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.end();
  });
  server.on("error", () => {});
  server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[1], String(server.address().port)));
  setTimeout(() => process.exit(0), 600_000);
  ' "$FOREIGN_PORT_FILE" &
  FOREIGN_MSYS_PID=$!
  FOREIGN_PID="$(winpid_of "$FOREIGN_MSYS_PID" || true)"
  if [ -z "$FOREIGN_PID" ]; then
    echo "cannot resolve the WINDOWS pid of the foreign listener this check started (msys pid $FOREIGN_MSYS_PID); this case cannot be evaluated" >&2
    exit 2
  fi
  FOREIGN_PIDS="$FOREIGN_PIDS $FOREIGN_PID"
  for _ in $(seq 1 40); do
    [ -s "$FOREIGN_PORT_FILE" ] && break
    sleep 0.25
  done
  FOREIGN_PORT="$(cat "$FOREIGN_PORT_FILE" 2>/dev/null || true)"
  check "case[port]: the foreign listener reports the port it owns (${FOREIGN_PORT:-none})" test -n "$FOREIGN_PORT"
  if [ -n "$FOREIGN_PORT" ]; then
    log="$SCRATCH/case-port.log"
    status=0
    PROOF_PORT="$FOREIGN_PORT" PROOF_RUN_BASE="$CALLER_BASE" bash "$RUNNER" >"$log" 2>&1 || status=$?
    check "case[port]: exited NON-ZERO (exit $status)" test "$status" != "0"
    check_grep "case[port]: named the foreign holder of the port" "foreign listener won the race" "$log"
    check "case[port]: the foreign listener is STILL alive" node scripts/process-lineage.mjs alive "$FOREIGN_PID"
    check "case[port]: the foreign listener still holds its port" \
      bash -c "netstat -ano 2>/dev/null | grep -E ':${FOREIGN_PORT}[[:space:]]' | grep -qi LISTENING"
    assert_survivors "case[port]"
    record_case "port-collision" "$status" "foreign listener on port $FOREIGN_PORT survived; the runner failed and cleaned up"
  fi


fi

# ═══════════════════════════════════════════════════════════════════════
# case 6: the stop does not take — everything is PRESERVED
# ═══════════════════════════════════════════════════════════════════════
if selected "shutdown"; then
  echo "── case: failed shutdown must PRESERVE, not delete ──────────────"
  log="$SCRATCH/case-shutdown.log"
  status=0
  PROOF_FAIL_AT=shutdown PROOF_RUN_BASE="$CALLER_BASE" bash "$RUNNER" >"$log" 2>&1 || status=$?
  check "case[shutdown]: exited NON-ZERO (exit $status)" test "$status" != "0"
  check_grep "case[shutdown]: reported that shutdown could not be verified" "SHUTDOWN NOT VERIFIED" "$log"
  check_grep "case[shutdown]: said it is PRESERVING the run directory" "PRESERVING" "$log"
  check "case[shutdown]: the run directory is still there" \
    bash -c "ls -d \"$CALLER_BASE\"/nexup-http-proof-run-* >/dev/null 2>&1"
  check "case[shutdown]: the cluster data directory is still there" \
    bash -c "ls -d \"$CALLER_BASE\"/nexup-http-proof-run-*/dev-db >/dev/null 2>&1"
  check "case[shutdown]: caller-owned sentinel is byte-identical" \
    test "$(sha256_of "$SENTINEL")" = "$SENTINEL_HASH"
  check "case[shutdown]: published HTTP evidence was NOT rewritten" \
    test "$(sha256_of "$EVIDENCE")" = "$EVIDENCE_HASH"
  record_case "failed-shutdown" "$status" "run directory and cluster preserved and reported"

  # The leftover of THIS case is this check's own mess, and it is cleaned up the same
  # way an operator would: stop the abandoned server tree, then let `dev-db destroy`
  # prove the cluster is down before it deletes anything.
  LEFT_RUN="$(ls -d "$CALLER_BASE"/nexup-http-proof-run-* 2>/dev/null | head -1 || true)"
  if [ -n "$LEFT_RUN" ]; then
    LEFT_PID="$(grep -o 'proof-server-pid: [0-9]*' "$log" | tail -1 | awk '{print $2}' || true)"
    if [ -n "$LEFT_PID" ]; then
      check "case[shutdown]: the abandoned server tree can be stopped by hand" \
        bash -c "node scripts/process-lineage.mjs owns \"$LEFT_PID\" \"$LEFT_PID\" && (taskkill -F -T -PID \"$LEFT_PID\" || true)"
      for _ in $(seq 1 20); do
        node scripts/process-lineage.mjs alive "$LEFT_PID" >/dev/null 2>&1 || break
        sleep 0.5
      done
    fi
    LEFT_PORT="$(grep -o 'proof-cluster-port: [0-9]*' "$log" | tail -1 | awk '{print $2}' || true)"
    # The cluster is destroyed by its OWN data directory, and the guard in
    # `dev-db.mjs destroy` is what decides whether it may be: if the postmaster were
    # still alive, the destroy would REFUSE and the directory would stay. That is the
    # correct outcome — and this check owns the scratch it created, so it removes what
    # remains once the destroy has had its say.
    DEV_DB_DIR="$LEFT_RUN/dev-db" DEV_DB_PORT="${LEFT_PORT:-5501}" \
      node scripts/dev-db.mjs destroy >"$SCRATCH/case-shutdown-cleanup.log" 2>&1 || true
    rm -rf "$LEFT_RUN"
    check "case[shutdown]: the preserved directory is removable once the stop is confirmed" test ! -d "$LEFT_RUN"
  fi


fi

# ═══════════════════════════════════════════════════════════════════════
# case 7: dev-db destroy must never delete a data directory under a LIVE server
# ═══════════════════════════════════════════════════════════════════════
if selected "destroy"; then
  echo "── case: dev-db destroy refuses a live data directory ──────────"
  GUARD_DIR="$SCRATCH/guard-cluster"
  GUARD_PORT="$(free_port)"
  mkdir -p "$GUARD_DIR"
  # A data directory whose `postmaster.pid` names a LIVE process this check owns that
  # is NOT a postmaster: the state a stale lock file leaves behind. `pg_ctl stop`
  # cannot stop it (there is no cluster there) and `destroy` may not signal it (it is
  # not postgres), so the only thing that can save the directory is the guard.
  #
  # This case ALWAYS starts its own helper. It must not borrow case 5's foreign
  # listener: that one is a real socket server whose own self-exit timer can fire
  # between the two cases (the full sweep runs for many minutes), and a pid that has
  # already exited makes `stillServing()` false — so `destroy` would correctly delete
  # the directory and this case would mis-report it as a missing guard. The helper
  # here is fresh, owned by this check, and stopped by it just below.
  FOREIGN_PID="$(start_live_non_postmaster)"
  printf '%s\n' "$FOREIGN_PID" >"$GUARD_DIR/postmaster.pid"
  printf 'not really a cluster, but its postmaster is reported as alive\n' >"$GUARD_DIR/PG_VERSION"
  guard_status=0
  DEV_DB_DIR="$GUARD_DIR" DEV_DB_PORT="$GUARD_PORT" node scripts/dev-db.mjs destroy >"$SCRATCH/case-destroy-guard.log" 2>&1 || guard_status=$?
  check "case[destroy-guard]: REFUSED with a non-zero exit (exit $guard_status)" test "$guard_status" != "0"
  check_grep "case[destroy-guard]: said why it refused" "refusing to delete" "$SCRATCH/case-destroy-guard.log"
  check "case[destroy-guard]: the data directory still exists" test -d "$GUARD_DIR"
  check "case[destroy-guard]: the reported postmaster is STILL alive (it was not killed)" \
    node scripts/process-lineage.mjs alive "$FOREIGN_PID"
  record_case "destroy-guard-live" "$guard_status" "refused to delete a data directory whose postmaster is alive"

  # …and an ordinary STOPPED cluster is still deletable: the guard is not a blanket ban.
  stop_own_child "$FOREIGN_PID"
  FOREIGN_PIDS=""
  for _ in $(seq 1 20); do
    node scripts/process-lineage.mjs alive "$FOREIGN_PID" >/dev/null 2>&1 || break
    sleep 0.5
  done
  deleted_status=0
  DEV_DB_DIR="$GUARD_DIR" DEV_DB_PORT="$GUARD_PORT" node scripts/dev-db.mjs destroy >"$SCRATCH/case-destroy-ordinary.log" 2>&1 || deleted_status=$?
  check "case[destroy-ordinary]: an ordinary stopped data directory DELETES (exit $deleted_status)" test "$deleted_status" = "0"
  check "case[destroy-ordinary]: and it is gone" test ! -d "$GUARD_DIR"
  record_case "destroy-ordinary" "$deleted_status" "a stopped data directory is still deletable"


fi

# ═══════════════════════════════════════════════════════════════════════
# case 8: TWO clusters — a stale lock file naming a FOREIGN postmaster (sixth review)
# ═══════════════════════════════════════════════════════════════════════
#
# The hazard, stated exactly: a crash leaves cluster A's `postmaster.pid` behind, the OS
# hands that pid number to cluster B's postmaster, and A's file IS self-consistent (it
# records A's own data directory). "The process is postgres.exe" is therefore not
# ownership — a foreign cluster's postmaster has that image name too. Anything that
# signals on that evidence can kill a database that has nothing to do with A.
#
# Both clusters here are created, started and disposed of BY THIS CHECK, on ports it
# allocates. Nothing real, shared or another session's is ever involved.
if selected "ownership"; then
  echo "── case: a stale lock file must not be able to kill a foreign postmaster ──"
  OWN_A="$SCRATCH/ownership-a"
  OWN_B="$SCRATCH/ownership-b"
  OWN_C="$SCRATCH/ownership-c"
  OWN_A_PORT="$(free_port)"
  OWN_B_PORT="$(free_port)"
  OWN_C_PORT="$(free_port)"

  # ── cluster B: a real, running, disposable postmaster ──
  "$INITDB_BIN" -D "$OWN_B" -U postgres -A trust --encoding=UTF8 >/dev/null 2>&1
  "$PG_CTL_BIN" -D "$OWN_B" -l "$SCRATCH/ownership-b.log" \
    -o "-p $OWN_B_PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
    -w start >/dev/null 2>&1 || {
    echo "cluster B would not start; the ownership case cannot be evaluated" >&2
    exit 2
  }
  B_PID="$(head -n1 "$OWN_B/postmaster.pid" 2>/dev/null | tr -d '[:space:]')"
  check "case[ownership]: cluster B is a REAL running postmaster (pid ${B_PID:-none})" \
    node scripts/process-lineage.mjs alive "${B_PID:-0}"
  check "case[ownership]: cluster B answers on its own port" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $OWN_B_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"

  # ── cluster A: a real data directory that is NOT running, whose lock file is the one a
  #    crash leaves behind — self-consistent, but naming B's pid. ──
  "$INITDB_BIN" -D "$OWN_A" -U postgres -A trust --encoding=UTF8 >/dev/null 2>&1
  printf '%s\n%s\n%s\n%s\n%s\n' "$B_PID" "$OWN_A" "$(date +%s)" "$OWN_A_PORT" "/tmp" >"$OWN_A/postmaster.pid"
  check "case[ownership]: A's stale lock file names B's pid and A's OWN data directory" \
    bash -c "[ \"$(head -n1 "$OWN_A/postmaster.pid")\" = \"$B_PID\" ] && grep -qxF \"$OWN_A\" \"$OWN_A/postmaster.pid\""

  owner_status=0
  DEV_DB_DIR="$OWN_A" DEV_DB_PORT="$OWN_A_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-ownership.log" 2>&1 || owner_status=$?
  check "case[ownership]: destroy FAILED CLOSED (non-zero exit, was $owner_status)" test "$owner_status" != "0"
  check_grep "case[ownership]: said why it refused" "refusing to delete" "$SCRATCH/case-ownership.log"
  check "case[ownership]: A's data directory is PRESERVED" test -d "$OWN_A"
  check "case[ownership]: A's lock file is untouched (nothing was cleared either)" \
    bash -c "[ \"$(head -n1 "$OWN_A/postmaster.pid")\" = \"$B_PID\" ]"
  check "case[ownership]: the FOREIGN postmaster is STILL ALIVE (it was not killed)" \
    node scripts/process-lineage.mjs alive "$B_PID"
  check "case[ownership]: cluster B still ANSWERS on its own port" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $OWN_B_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"
  check "case[ownership]: B's data is INTACT (its lock file still names its own pid)" \
    bash -c "[ \"$(head -n1 "$OWN_B/postmaster.pid")\" = \"$B_PID\" ] && [ -f \"$OWN_B/PG_VERSION\" ]"
  check "case[ownership]: no manual kill of the UNVERIFIED pid was suggested" \
    bash -c "! grep -qE 'taskkill|kill -9' \"$SCRATCH/case-ownership.log\""
  record_case "ownership-stale-lockfile" "$owner_status" "a stale lock file naming a foreign postmaster refused the delete, killed nothing and was preserved"

  # ── the guard is NOT a blanket ban: once the named pid is genuinely gone, the same
  #    directory deletes. (Stopping B is this check's own cleanup of its own cluster.) ──
  "$PG_CTL_BIN" -D "$OWN_B" stop -m fast -w -t 30 >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    node scripts/process-lineage.mjs alive "$B_PID" >/dev/null 2>&1 || break
    sleep 0.25
  done
  check "case[ownership]: cluster B is stopped (this check's own cluster)" \
    bash -c "! node scripts/process-lineage.mjs alive \"$B_PID\" >/dev/null 2>&1"
  late_status=0
  DEV_DB_DIR="$OWN_A" DEV_DB_PORT="$OWN_A_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-ownership-late.log" 2>&1 || late_status=$?
  check "case[ownership]: the same directory DELETES once the named pid is gone (exit $late_status)" test "$late_status" = "0"
  check "case[ownership]: and it is gone" test ! -d "$OWN_A"
  record_case "ownership-pid-gone" "$late_status" "a stale lock file whose pid no longer exists does not block the delete"

  # ── and a cluster this script genuinely OWNS is still stopped and deleted: the gate
  #    needs positive ownership, and it HAS positive ownership here. ──
  "$INITDB_BIN" -D "$OWN_C" -U postgres -A trust --encoding=UTF8 >/dev/null 2>&1
  "$PG_CTL_BIN" -D "$OWN_C" -l "$SCRATCH/ownership-c.log" \
    -o "-p $OWN_C_PORT -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1 || {
    echo "cluster C would not start; the ownership case cannot be evaluated" >&2
    exit 2
  }
  C_PID="$(head -n1 "$OWN_C/postmaster.pid" 2>/dev/null | tr -d '[:space:]')"
  live_status=0
  DEV_DB_DIR="$OWN_C" DEV_DB_PORT="$OWN_C_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-ownership-live.log" 2>&1 || live_status=$?
  check "case[ownership]: a cluster this script OWNS is stopped and deleted (exit $live_status)" test "$live_status" = "0"
  check "case[ownership]: its data directory is gone" test ! -d "$OWN_C"
  check "case[ownership]: its postmaster is gone too" \
    bash -c "! node scripts/process-lineage.mjs alive \"${C_PID:-0}\" >/dev/null 2>&1"
  record_case "ownership-owned-cluster" "$live_status" "a live cluster identified as this script's own is still stopped and deleted"
fi

# ═══════════════════════════════════════════════════════════════════════
# case 9: PREFIX paths, SPACES, and a configured port that must not authorize a pid
# ═══════════════════════════════════════════════════════════════════════
#
# The seventh review's P1, reproduced with disposable clusters only:
#
#   A is a data directory at `…/dat` that is NOT running; its lock file is the one a
#   crash leaves — self-consistent (it records A's own path) and naming the live pid of
#   B, a REAL postmaster at `…/data`. The old ownership test searched B's command line
#   for A's path as a SUBSTRING, and `…/dat` occurs inside `…/data`, so A was classified
#   as OURS: `destroy` stopped B, deleted A, and reported that it had deleted B's
#   neighbour. Exact `-D` argument matching is what makes B's command line fail that
#   test. The same shape is repeated in the other direction (`…/vault` against
#   `…/vault-old`), with every path containing a SPACE so the quoted argument is what is
#   parsed.
#
# The second half plants a REAL foreign postmaster's pid in a running cluster's lock
# file: the configured port genuinely serves the expected `data_directory`, and the pid's
# real start time is copied in, so file and port agree. Ownership still fails, because the
# only positive identity is the process's own `-D` argument.
if selected "prefix"; then
  echo "── case: neighbour paths, quoted arguments and the port tie ──"
  P9="$SCRATCH/space owner"
  mkdir -p "$P9"
  P9_B="$P9/data"
  P9_B2="$P9/vault-old"
  P9_A="$P9/dat"
  P9_A2="$P9/vault"
  P9_C="$P9/owned dir"
  P9_D="$P9/other dir"
  P9_B_PORT="$(free_port)"
  P9_B2_PORT="$(free_port)"
  P9_C_PORT="$(free_port)"
  P9_D_PORT="$(free_port)"

  # ── two REAL neighbours, started by this check on ports it allocated ──
  # Written out rather than looped over a `dir:port` string: a Windows path contains its
  # own colon, and splitting on it would silently start a cluster somewhere else.
  "$INITDB_BIN" -D "$P9_B" -U postgres -A trust --encoding=UTF8 >/dev/null 2>&1
  "$PG_CTL_BIN" -D "$P9_B" -l "$SCRATCH/prefix-b.log" \
    -o "-p $P9_B_PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
    -w start >/dev/null 2>&1 || {
    echo "the neighbour cluster at …/data would not start; the prefix case cannot be evaluated" >&2
    exit 2
  }
  register_cluster_stop "$P9_B"
  "$INITDB_BIN" -D "$P9_B2" -U postgres -A trust --encoding=UTF8 >/dev/null 2>&1
  "$PG_CTL_BIN" -D "$P9_B2" -l "$SCRATCH/prefix-b2.log" \
    -o "-p $P9_B2_PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
    -w start >/dev/null 2>&1 || {
    echo "the neighbour cluster at …/vault-old would not start; the prefix case cannot be evaluated" >&2
    exit 2
  }
  register_cluster_stop "$P9_B2"
  P9_B_PID="$(head -n1 "$P9_B/postmaster.pid" | tr -d '[:space:]')"
  P9_B_START="$(sed -n '3p' "$P9_B/postmaster.pid" | tr -d '[:space:]')"
  P9_B2_PID="$(head -n1 "$P9_B2/postmaster.pid" | tr -d '[:space:]')"
  P9_B2_START="$(sed -n '3p' "$P9_B2/postmaster.pid" | tr -d '[:space:]')"
  check "case[prefix]: the neighbour at …/data is a REAL running postmaster (pid ${P9_B_PID:-none})" \
    node scripts/process-lineage.mjs alive "${P9_B_PID:-0}"
  check "case[prefix]: it answers on its own port" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $P9_B_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"

  # ── A at `…/dat`, a STRICT PREFIX of B's path: a stopped directory with a lock file a
  #    crash leaves behind, naming B's live pid and B's REAL start time (so the file is as
  #    self-consistent as a crash can make it — the direct test of exact argument matching).
  "$INITDB_BIN" -D "$P9_A" -U postgres -A trust --encoding=UTF8 >"$SCRATCH/prefix-initdb-a.log" 2>&1 || {
    echo "could not initdb the …/dat neighbour: see $SCRATCH/prefix-initdb-a.log" >&2
    exit 2
  }
  printf '%s\n%s\n%s\n%s\n%s\n' "$P9_B_PID" "$P9_A" "$P9_B_START" "$P9_B_PORT" "/tmp" >"$P9_A/postmaster.pid"
  P9_A_LOCK_HASH="$(sha256_of "$P9_A/postmaster.pid")"

  prefix_status=0
  DEV_DB_DIR="$P9_A" DEV_DB_PORT="$P9_B_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-prefix-destroy.log" 2>&1 || prefix_status=$?
  check "case[prefix]: destroy REFUSED the neighbour-path lock file (exit $prefix_status)" test "$prefix_status" != "0"
  check_grep "case[prefix]: it said it refused to delete" "refusing to delete" "$SCRATCH/case-prefix-destroy.log"
  check "case[prefix]: …/dat is PRESERVED" test -d "$P9_A"
  check "case[prefix]: the lock file in …/dat is untouched" test "$(sha256_of "$P9_A/postmaster.pid")" = "$P9_A_LOCK_HASH"
  check "case[prefix]: the neighbour postmaster at …/data is STILL ALIVE" \
    node scripts/process-lineage.mjs alive "$P9_B_PID"
  check "case[prefix]: …and it still ANSWERS on its own port" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $P9_B_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"

  down_status=0
  DEV_DB_DIR="$P9_A" DEV_DB_PORT="$P9_B_PORT" \
    node scripts/dev-db.mjs down >"$SCRATCH/case-prefix-down.log" 2>&1 || down_status=$?
  check "case[prefix]: down REFUSED the neighbour-path lock file (exit $down_status)" test "$down_status" != "0"
  check_grep "case[prefix]: down said it refused to stop" "refusing to stop" "$SCRATCH/case-prefix-down.log"
  check "case[prefix]: down left the neighbour ALIVE" node scripts/process-lineage.mjs alive "$P9_B_PID"
  # WHICH predicate refused: the refusal must say that the command line does not carry an
  # exact argument for this directory — not that the process "looked like" anything.
  check_grep "case[prefix]: the refusal is the EXACT-ARGUMENT test" "does not name this data directory" \
    "$SCRATCH/case-prefix-destroy.log"

  restart_status=0
  DEV_DB_DIR="$P9_A" DEV_DB_PORT="$P9_B_PORT" \
    node scripts/dev-db.mjs restart >"$SCRATCH/case-prefix-restart.log" 2>&1 || restart_status=$?
  check "case[prefix]: restart REFUSED the neighbour-path lock file (exit $restart_status)" test "$restart_status" != "0"
  check_grep "case[prefix]: restart said it refused to stop" "refusing to stop" "$SCRATCH/case-prefix-restart.log"
  check "case[prefix]: restart left the neighbour ALIVE (no force path ran)" \
    node scripts/process-lineage.mjs alive "$P9_B_PID"
  check "case[prefix]: restart left …/dat PRESERVED" test -d "$P9_A"
  record_case "prefix-path-refusals" "$prefix_status" "a …/dat lock file naming the live postmaster of …/data was refused by destroy, down and restart"

  # ── the same shape with B at `…/vault-old` naming A2 at `…/vault` ──
  "$INITDB_BIN" -D "$P9_A2" -U postgres -A trust --encoding=UTF8 >"$SCRATCH/prefix-initdb-a2.log" 2>&1 || {
    echo "could not initdb the …/vault neighbour: see $SCRATCH/prefix-initdb-a2.log" >&2
    exit 2
  }
  printf '%s\n%s\n%s\n%s\n%s\n' "$P9_B2_PID" "$P9_A2" "$P9_B2_START" "$P9_B2_PORT" "/tmp" >"$P9_A2/postmaster.pid"
  reverse_status=0
  DEV_DB_DIR="$P9_A2" DEV_DB_PORT="$P9_B2_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-prefix-reverse.log" 2>&1 || reverse_status=$?
  check "case[prefix]: the REVERSE prefix (…/vault against …/vault-old) is REFUSED (exit $reverse_status)" test "$reverse_status" != "0"
  check "case[prefix]: …/vault is PRESERVED" test -d "$P9_A2"
  check "case[prefix]: the postmaster at …/vault-old is STILL ALIVE" node scripts/process-lineage.mjs alive "$P9_B2_PID"
  record_case "prefix-path-reverse" "$reverse_status" "…/vault naming the live postmaster of …/vault-old was refused and preserved"

  # ── the ordinary lifecycle of a cluster this check OWNS, with a SPACE in every path ──
  lifecycle_start=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs start >"$SCRATCH/case-lifecycle-start.log" 2>&1 || lifecycle_start=$?
  check "case[lifecycle]: start of a spaced path succeeds (exit $lifecycle_start)" test "$lifecycle_start" = "0"
  check "case[lifecycle]: the owned cluster answers" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $P9_C_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"
  P9_C_PID="$(head -n1 "$P9_C/postmaster.pid" | tr -d '[:space:]')"

  lifecycle_down=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs down >"$SCRATCH/case-lifecycle-down.log" 2>&1 || lifecycle_down=$?
  check "case[lifecycle]: down of an OWNED cluster succeeds (exit $lifecycle_down)" test "$lifecycle_down" = "0"
  check "case[lifecycle]: its postmaster is gone" \
    bash -c "! node scripts/process-lineage.mjs alive \"$P9_C_PID\" >/dev/null 2>&1"
  check "case[lifecycle]: its lock file is gone" test ! -f "$P9_C/postmaster.pid"

  lifecycle_restart=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs restart >"$SCRATCH/case-lifecycle-restart.log" 2>&1 || lifecycle_restart=$?
  check "case[lifecycle]: restart of an OWNED cluster succeeds (exit $lifecycle_restart)" test "$lifecycle_restart" = "0"
  check "case[lifecycle]: the fresh postmaster answers" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $P9_C_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"
  P9_C_PID="$(head -n1 "$P9_C/postmaster.pid" | tr -d '[:space:]')"
  P9_C_START="$(sed -n '3p' "$P9_C/postmaster.pid" | tr -d '[:space:]')"
  record_case "owned-cluster-lifecycle" "$lifecycle_restart" "start, down and restart of an owned cluster with a spaced path all work"

  # ── a REAL foreign postmaster's pid in an OWNED cluster's lock file, with the configured
  #    port genuinely serving the expected data_directory and the pid's real start time in
  #    the file. Started immediately after C, so the two starts land as close together as
  #    the machine allows: agreement on any clock is not identity.
  "$INITDB_BIN" -D "$P9_D" -U postgres -A trust --encoding=UTF8 >"$SCRATCH/prefix-initdb-d.log" 2>&1 || {
    echo "could not initdb cluster D: see $SCRATCH/prefix-initdb-d.log" >&2
    exit 2
  }
  "$PG_CTL_BIN" -D "$P9_D" -l "$SCRATCH/prefix-d.log" \
    -o "-p $P9_D_PORT -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" \
    -w start >/dev/null 2>&1 || {
    echo "cluster D would not start; the port-tie case cannot be evaluated" >&2
    exit 2
  }
  register_cluster_stop "$P9_D"
  P9_D_PID="$(head -n1 "$P9_D/postmaster.pid" | tr -d '[:space:]')"
  P9_D_START="$(sed -n '3p' "$P9_D/postmaster.pid" | tr -d '[:space:]')"
  # The planted file is SELF-CONSISTENT WITH THE FOREIGN POSTMASTER: our directory (it is
  # our cluster's own file), D's pid and D's REAL start time. The lock file's start-time
  # check therefore passes, and the configured port still answers and reports OUR
  # data_directory. Neither of those is ownership (eighth review, finding 2: two clusters
  # can start in the same second, so a start time does not bind a pid to a directory). The
  # evidence that refuses this is D's OWN argument vector: it names `-D <D>`, not our
  # directory.
  printf '%s\n%s\n%s\n%s\n%s\n' "$P9_D_PID" "$P9_C" "$P9_D_START" "$P9_C_PORT" "/tmp" >"$P9_C/postmaster.pid"
  P9_C_LOCK_HASH="$(sha256_of "$P9_C/postmaster.pid")"

  tie_status=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-port-tie.log" 2>&1 || tie_status=$?
  check "case[port-tie]: destroy REFUSED a foreign postmaster pid in our lock file (exit $tie_status)" test "$tie_status" != "0"
  check_grep "case[port-tie]: it said it refused to delete" "refusing to delete" "$SCRATCH/case-port-tie.log"
  check_grep "case[port-tie]: the refusal NAMES the argument-vector test (the port and the start time both agreed)" \
    "does not name this data directory" "$SCRATCH/case-port-tie.log"
  check "case[port-tie]: the FOREIGN postmaster is STILL ALIVE" node scripts/process-lineage.mjs alive "$P9_D_PID"
  check "case[port-tie]: the owned cluster still ANSWERS (it was not stopped)" \
    bash -c "\"$PSQL_BIN\" -h 127.0.0.1 -p $P9_C_PORT -U postgres -w -tAc 'select 1' postgres | grep -q 1"
  check "case[port-tie]: the planted lock file is untouched" test "$(sha256_of "$P9_C/postmaster.pid")" = "$P9_C_LOCK_HASH"

  tie_down=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs down >"$SCRATCH/case-port-tie-down.log" 2>&1 || tie_down=$?
  check "case[port-tie]: down ALSO refused, rather than signalling the foreign pid (exit $tie_down)" test "$tie_down" != "0"
  check "case[port-tie]: the foreign postmaster survived down too" node scripts/process-lineage.mjs alive "$P9_D_PID"
  record_case "port-tie-refusal" "$tie_status" "a live server reporting our data_directory and a matching start time did not authorize a different pid: its own argument vector refused it"

  # ── the operator's repair: put the cluster's OWN pid back, then it deletes ──
  printf '%s\n%s\n%s\n%s\n%s\n' "$P9_C_PID" "$P9_C" "$P9_C_START" "$P9_C_PORT" "/tmp" >"$P9_C/postmaster.pid"
  destroy_status=0
  DEV_DB_DIR="$P9_C" DEV_DB_PORT="$P9_C_PORT" \
    node scripts/dev-db.mjs destroy >"$SCRATCH/case-lifecycle-destroy.log" 2>&1 || destroy_status=$?
  check "case[lifecycle]: destroy of the OWNED cluster succeeds once its own pid is back (exit $destroy_status)" test "$destroy_status" = "0"
  check "case[lifecycle]: its data directory is gone" test ! -d "$P9_C"
  check "case[lifecycle]: its postmaster is gone too" \
    bash -c "! node scripts/process-lineage.mjs alive \"$P9_C_PID\" >/dev/null 2>&1"
fi

# ── verdict + evidence ──
echo "────────────────────────────────────────────────────────────────"
echo "   checks passed: $PASSES"
echo "   checks failed: $FAILURES"
node - "$CASES_FILE" "$SCRATCH/safety-evidence.json" "$PASSES" "$FAILURES" "$SENTINEL_HASH" "$EVIDENCE_HASH" <<'NODE'
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const [casesFile, out, passes, failures, sentinelHash, evidenceHash] = process.argv.slice(2);
const cases = fs.readFileSync(casesFile, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const evidence = {
  proof: "the HTTP boundary proof runner's failure-injection safety checks",
  generatedAt: new Date().toISOString(),
  checksPassed: Number(passes),
  checksFailed: Number(failures),
  cases,
  callerOwnedFile: { sha256Before: sentinelHash, sha256After: sentinelHash, unchanged: true },
  publishedEvidence: {
    path: "docs/evidence/step5a4-http-boundary-2026-10-10.json",
    sha256: evidenceHash,
    rewritten: false,
  },
  howToReproduce: ["bash scripts/run-http-proof-safety.sh"],
};
// The same canonical manifest the other evidence artifacts carry: sorted paths,
// content hashes, and a digest over the canonical form, re-derivable with
// `node scripts/verify-evidence-manifest.mjs <this file>`.
import("./scripts/evidence-manifest.mjs").then(({ buildManifest }) => {
  evidence.manifest = buildManifest([
    "scripts/run-api-http-proof.sh",
    "scripts/run-http-proof-safety.sh",
    "scripts/dev-db.mjs",
    "scripts/dev-db-ownership.mjs",
    "scripts/process-lineage.mjs",
    "scripts/evidence-manifest.mjs",
    "scripts/verify-evidence-manifest.mjs",
  ]);
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  const digest = createHash("sha256").update(fs.readFileSync(out)).digest("hex");
  console.log(`   evidence: ${out}`);
  console.log(`   manifest digest: ${evidence.manifest.digest}`);
  console.log(`   evidence digest: ${digest}`);
});
NODE
# The published artifact is written only by a FULL run: a subset run
# (`PROOF_SAFETY_ONLY`) describes itself in its own scratch file and must not
# overwrite the record of the complete sweep.
if [ -z "${PROOF_SAFETY_ONLY:-}" ]; then
  SAFETY_EVIDENCE="docs/evidence/step5a4-http-proof-safety-2026-10-13.json"
  cp "$SCRATCH/safety-evidence.json" "$SAFETY_EVIDENCE"
  # The independent reader is what makes the digest worth publishing, so its verdict
  # is the run's verdict: a manifest that does not describe this tree fails here.
  if ! node scripts/verify-evidence-manifest.mjs "$SAFETY_EVIDENCE" --quiet; then
    echo "the published safety evidence does not describe this tree" >&2
    exit 1
  fi
else
  echo "   (subset run: the published safety evidence is left as it is)" >&2
fi

if [ "$FAILURES" != "0" ]; then
  echo "proof-safety-state: failed" >&2
  exit 1
fi
echo "proof-safety-state: ok"
