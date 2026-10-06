#!/usr/bin/env bash
#
# Behavioural tests for `deploy/nexup-bridge-supervisor.sh`.
#
# The supervisor is the one component whose job is to survive things going
# wrong (the serve dies; the Hermes container is re-created onto another
# network), so its DECISIONS are tested here rather than described: `docker` is
# replaced by a function that records every call, `sleep` is a no-op, and the
# reconcile pass runs against a scripted world.
#
# What this proves locally:
#   * idempotence — a matching world produces ZERO mutating docker calls;
#   * ordering — the stale bridge is removed BEFORE the new one is created;
#   * the token is read from the root-only file and never enters any argv;
#   * every prerequisite failure is fail-closed and mutation-free.
#
# What it CANNOT prove (and therefore must be re-verified on the VPS at the
# RECOVERY VERIFIED checkpoint): that the docker/exec/compose commands behave as
# recorded here against a live daemon.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${1:-$HERE/../deploy/nexup-bridge-supervisor.sh}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CALLS="$WORK/calls.log"
: >"$CALLS"

PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); printf 'ok   %s\n' "$1"; }
fail() {
  FAILED=$((FAILED + 1))
  printf 'FAIL %s\n' "$1"
  printf '       %s\n' "${2:-}"
}

expect_eq() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2], got [$3]"; fi
}

expect_contains() { # name haystack needle
  case "$2" in
    *"$3"*) pass "$1" ;;
    *) fail "$1" "[$2] does not contain [$3]" ;;
  esac
}

expect_absent() { # name haystack needle
  case "$2" in
    *"$3"*) fail "$1" "[$2] unexpectedly contains [$3]" ;;
    *) pass "$1" ;;
  esac
}

count_matching() { # needle
  grep -F -c -- "$1" "$CALLS" 2>/dev/null || true
}

# ── the scripted world ───────────────────────────────────────────────────────
OWNER_ID=""
OWNER_RUNNING="true"
BRIDGE_MODE=""
BRIDGE_RUNNING="false"
SERVE_UP="false"
SERVE_START_OK="true"
COMPOSE_RC="0"

# Stub `sleep` so the serve-start poll does not cost real seconds.
sleep() { :; }

docker() {
  printf '%s\n' "$*" >>"$CALLS"
  local verb="${1:-}"
  shift || true
  case "$verb" in
    inspect)
      # inspect -f '<format>' <name>
      local format="${2:-}" name="${3:-}"
      case "$format" in
        *State.Running*)
          if [ "$name" = "$BRIDGE_CONTAINER" ]; then
            printf '%s\n' "$BRIDGE_RUNNING"
            [ "$BRIDGE_RUNNING" = "true" ] || return 1
          else
            printf '%s\n' "$OWNER_RUNNING"
            [ "$OWNER_RUNNING" = "true" ] || return 1
          fi
          ;;
        *HostConfig.NetworkMode*) [ -n "$BRIDGE_MODE" ] && printf '%s\n' "$BRIDGE_MODE" ;;
        *Id*)
          if [ -z "$OWNER_ID" ]; then return 1; fi
          printf '%s\n' "$OWNER_ID"
          ;;
      esac
      return 0
      ;;
    exec)
      if [ "${1:-}" = "-d" ]; then
        # The serve start: only succeeds if the world says it should.
        if [ "$SERVE_START_OK" = "true" ]; then SERVE_UP="true"; fi
        return 0
      fi
      # The serve probe.
      [ "$SERVE_UP" = "true" ]
      return $?
      ;;
    rm) return 0 ;;
    compose) return "$COMPOSE_RC" ;;
  esac
  return 0
}

# ── load the supervisor's functions (no loop) ────────────────────────────────
[ -r "$SCRIPT" ] || {
  printf 'FAIL supervisor script not readable at %s\n' "$SCRIPT"
  exit 1
}
NEXUP_SUPERVISOR_LIB_ONLY=1 . "$SCRIPT"
set +eu

TOKEN_FILE="$WORK/token"
TOKEN_VALUE="fixed-serve-token-value-0123456789abcdef"
printf '%s' "$TOKEN_VALUE" >"$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

COMPOSE_FILE="$WORK/docker-compose.bridge.yml"
printf 'services: {}\n' >"$COMPOSE_FILE"

BRIDGE_CONTAINER="nexup-bridge"
HERMES_CONTAINER="hermes-agent-r3j1-hermes-agent-1"
HERMES_BIN="/opt/hermes/.venv/bin/hermes"
HERMES_PYTHON="/opt/hermes/.venv/bin/python"
SERVE_START_ATTEMPTS=3

reset_world() {
  : >"$CALLS"
  OWNER_ID="owner-id-1"
  OWNER_RUNNING="true"
  BRIDGE_MODE="container:owner-id-1"
  BRIDGE_RUNNING="true"
  SERVE_UP="true"
  SERVE_START_OK="true"
  COMPOSE_RC="0"
}

run_reconcile() {
  local token
  token="$(token_value)"
  RECONCILE_OUT="$(reconcile_once "$token" 2>&1)"
  RECONCILE_RC=$?
}

# ── 1. idempotence ───────────────────────────────────────────────────────────
reset_world
run_reconcile
expect_eq "idempotent: reconcile succeeds" "0" "$RECONCILE_RC"
expect_eq "idempotent: no container is removed" "0" "$(count_matching 'rm -f')"
expect_eq "idempotent: compose is not brought up" "0" "$(count_matching 'compose -f')"
expect_eq "idempotent: the serve is not restarted" "0" "$(count_matching 'exec -d')"
expect_contains "idempotent: reports the bridge as matching" "$RECONCILE_OUT" "BRIDGE-OK"
expect_contains "idempotent: reports the serve as up" "$RECONCILE_OUT" "SERVE-UP ok"

# ── 2. a dead serve is restarted with the FIXED token, never in argv ─────────
reset_world
SERVE_UP="false"
run_reconcile
expect_eq "serve-down: reconcile succeeds" "0" "$RECONCILE_RC"
expect_eq "serve-down: the serve is started exactly once" "1" "$(count_matching 'exec -d')"
expect_contains "serve-down: announces the restart" "$RECONCILE_OUT" "SERVE-DOWN -> starting serve with fixed token"
expect_contains "serve-down: confirms the endpoint came up" "$RECONCILE_OUT" "SERVE-UP (attempt"
expect_contains "serve-down: pins the profile" "$(cat "$CALLS")" "-p saieed serve --isolated --host 127.0.0.1 --port 9119"
expect_contains "serve-down: passes the token by NAME, not by value" "$(cat "$CALLS")" "-e HERMES_DASHBOARD_SESSION_TOKEN"
expect_absent "serve-down: the token value never reaches argv" "$(cat "$CALLS")" "$TOKEN_VALUE"
expect_absent "serve-down: the token value never reaches the log" "$RECONCILE_OUT" "$TOKEN_VALUE"
expect_eq "serve-down: the bridge is left alone" "0" "$(count_matching 'compose -f')"

# The probe must stay credential-free: it opens a socket, it does not call the API.
expect_absent "serve-down: the probe sends no token" "$(cat "$CALLS")" "$TOKEN_VALUE"
expect_absent "serve-down: the probe touches no API path" "$(cat "$CALLS")" "api/ws"

# ── 3. the token is the same one every time (fixed, not per-start) ───────────
expect_eq "token: value comes from the token file verbatim" "$TOKEN_VALUE" "$(token_value)"
expect_eq "token: value is stable across reads" "$(token_value)" "$(token_value)"

# ── 4. a re-created owner re-parents the bridge, in the right ORDER ──────────
reset_world
OWNER_ID="owner-id-2"
BRIDGE_MODE="container:owner-id-1"
run_reconcile
expect_eq "re-parent: reconcile succeeds" "0" "$RECONCILE_RC"
expect_contains "re-parent: notices the stale namespace" "$RECONCILE_OUT" "BRIDGE-STALE"
expect_eq "re-parent: removes the orphan" "1" "$(count_matching 'rm -f nexup-bridge')"
expect_eq "re-parent: brings the bridge back up" "1" "$(count_matching 'compose -f')"
remove_line="$(grep -n -F 'rm -f nexup-bridge' "$CALLS" | head -1 | cut -d: -f1)"
up_line="$(grep -n -F 'compose -f' "$CALLS" | head -1 | cut -d: -f1)"
if [ -n "$remove_line" ] && [ -n "$up_line" ] && [ "$remove_line" -lt "$up_line" ]; then
  pass "re-parent: the dependent is removed before the replacement is created"
else
  fail "re-parent: ordering" "rm at line [${remove_line:-none}], compose up at line [${up_line:-none}]"
fi

# ── 5. the owner is named by its STABLE name, never by ID or IP ──────────────
reset_world
OWNER_ID="owner-id-3"
BRIDGE_MODE="container:owner-id-2"
run_reconcile
expect_contains "naming: inspects the stable container name" "$(cat "$CALLS")" "inspect -f {{.Id}} hermes-agent-r3j1-hermes-agent-1"
# The replacement container is created by the COMPOSE FILE, which is the only
# artifact that names the namespace owner and carries the route labels. The
# supervisor must never build the container itself: a hand-built one would bake
# in the owner ID (which changes on every recreation) and could drift from the
# routing definition.
expect_contains "naming: re-creates through the compose file" "$(cat "$CALLS")" "compose -f $COMPOSE_FILE up -d"
expect_absent "naming: never binds a namespace by hand" "$(cat "$CALLS")" "--network"
expect_absent "naming: no container IP is hard-coded" "$(cat "$CALLS")" "172.16."
expect_absent "naming: no previous owner ID is reused as a target" "$(cat "$CALLS")" "container:owner-id-2"

# ── 6. an absent or stopped owner is left completely alone ───────────────────
reset_world
OWNER_ID=""
run_reconcile
expect_eq "no-hermes: reconcile returns success" "0" "$RECONCILE_RC"
expect_contains "no-hermes: says so" "$RECONCILE_OUT" "NO-HERMES"
expect_eq "no-hermes: no mutation" "0" "$(count_matching 'rm -f')"
expect_eq "no-hermes: no compose" "0" "$(count_matching 'compose -f')"
expect_eq "no-hermes: no exec" "0" "$(count_matching 'exec')"

reset_world
OWNER_RUNNING="false"
run_reconcile
expect_contains "stopped-hermes: says so" "$RECONCILE_OUT" "NO-HERMES"
expect_eq "stopped-hermes: no mutation" "0" "$(count_matching 'rm -f')"
expect_eq "stopped-hermes: no serve start" "0" "$(count_matching 'exec -d')"

# ── 7. a failed recreate is REPORTED, not silently swallowed ─────────────────
reset_world
OWNER_ID="owner-id-4"
BRIDGE_MODE="container:owner-id-1"
COMPOSE_RC="1"
run_reconcile
expect_eq "failed-recreate: reconcile reports failure" "1" "$RECONCILE_RC"
expect_contains "failed-recreate: names the stale bridge" "$RECONCILE_OUT" "BRIDGE-STALE"

# ── 8. the serve never comes up: reported, bounded, not a crash ──────────────
reset_world
SERVE_UP="false"
SERVE_START_OK="false"
run_reconcile
expect_eq "serve-stuck: reconcile reports failure" "1" "$RECONCILE_RC"
expect_contains "serve-stuck: gives up loudly" "$RECONCILE_OUT" "SERVE-START-FAILED"
expect_eq "serve-stuck: attempts are bounded by SERVE_START_ATTEMPTS" "1" "$(count_matching 'exec -d')"

# ── 9. fail-closed prerequisites: no token, no mutation ──────────────────────
#
# Two contracts, both measured against the real daemon:
#   * `token_value` is read through `$( )`, which captures STDOUT, so its
#     diagnosis MUST go to stderr — otherwise `main` exits 1 with no output at
#     all, which is exactly what happened on the VPS before this was fixed.
#   * no docker call may be made in any of the three failure modes.
for case in missing empty short; do
  : >"$CALLS"
  rm -f "$TOKEN_FILE"
  case "$case" in
    missing) : ;;
    empty) : >"$TOKEN_FILE" ;;
    short) printf 'tooshort' >"$TOKEN_FILE" ;;
  esac
  err="$(token_value 2>&1)"
  rc=$?
  expect_eq "token-$case: refused" "1" "$rc"
  expect_contains "token-$case: explains why" "$err" "FATAL"
  expect_eq "token-$case: no docker call made" "0" "$(count_matching '')"
  out="$(main --once 2>&1)"
  rc=$?
  expect_eq "token-$case: main exits non-zero" "1" "$rc"
  expect_contains "token-$case: main tells the operator why" "$out" "FATAL session token"
  expect_absent "token-$case: main leaks no token" "$out" "$TOKEN_VALUE"
  expect_eq "token-$case: main made no docker call" "0" "$(count_matching '')"
done
printf '%s' "$TOKEN_VALUE" >"$TOKEN_FILE"

# ── 10. main() refuses the forbidden profile and missing prerequisites ───────
(
  : >"$CALLS"
  HERMES_PROFILE="default"
  main --once >/dev/null 2>&1
  exit $?
)
rc=$?
expect_eq "profile-default: main exits non-zero" "1" "$rc"
expect_eq "profile-default: no serve was started" "0" "$(count_matching 'exec -d')"

(
  : >"$CALLS"
  ALLOWED_PROFILES="saieed"
  HERMES_PROFILE="adel"
  main --once >/dev/null 2>&1
  exit $?
)
rc=$?
expect_eq "profile-adel: main exits non-zero" "1" "$rc"
expect_eq "profile-adel: no serve was started" "0" "$(count_matching 'exec -d')"

(
  : >"$CALLS"
  COMPOSE_FILE="$WORK/absent.yml"
  main --once >/dev/null 2>&1
  exit $?
)
rc=$?
expect_eq "compose-missing: main exits non-zero" "1" "$rc"
expect_eq "compose-missing: no mutation" "0" "$(count_matching 'rm -f')"

# ── 11. nothing in the script reaches into the managed Hermes deployment ─────
script_body="$(cat "$SCRIPT")"
expect_absent "scope: the Hermes compose is never touched" "$script_body" "/docker/hermes-agent-r3j1"
expect_absent "scope: the default/Adel profile is never addressed" "$script_body" "-p default"
expect_absent "scope: the token is never echoed" "$script_body" 'log "$token"'

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
