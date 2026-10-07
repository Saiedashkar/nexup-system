#!/usr/bin/env bash
#
# NEXUP Bridge supervisor (revised C).
#
# This script is the OPERATOR-OWNED half of the bridge deployment: it lives
# outside the managed Hermes container, outside the bridge image, and outside
# the Hermes compose file, and it owns exactly two things:
#
#   1. the `hermes -p saieed serve --isolated --host 127.0.0.1 --port 9119`
#      process inside the Hermes container — the loopback endpoint the bridge
#      authenticates to with a FIXED session token;
#   2. the lifecycle of the bridge container, which shares the Hermes
#      container's network namespace and therefore cannot outlive it: when the
#      Hermes container is recreated, the old namespace is gone, the bridge is a
#      `running` ORPHAN whose route no longer resolves, and it must be
#      re-created so it joins the new namespace (both directions measured in
#      Gate 0).
#
# It never starts, stops, reconfigures or re-creates Hermes itself, never
# touches the Hermes compose file, never reads or writes `/opt/data`, never
# addresses the `default` (Adel) profile, and never prints the session token.
#
# Run it as a systemd service (`deploy/systemd/nexup-bridge-supervisor.service`);
# `NEXUP_SUPERVISOR_LIB_ONLY=1` sources the functions without running the loop,
# which is how `tests/supervisor.test.sh` exercises the reconcile decisions
# against a stubbed `docker`.

set -euo pipefail

# ── configuration (overridable from the unit's EnvironmentFile) ──────────────
DOCKER="${DOCKER:-docker}"

# The docker CLI resolves its plugins (notably `compose`) through $HOME, and this
# script's ONE recovery action is `docker compose up -d`. A systemd service has no
# usable HOME of its own and the unit sets `ProtectHome=true`, so plugin lookup
# failed and compose was reported as "not a docker command" — measured on the real
# host. `/` is readable under ProtectHome=true and holds no `.docker/cli-plugins`
# of its own, so the system-wide plugin path is found again. An operator's own
# HOME is never disturbed.
HOME="${HOME:-/}"
export HOME

# Stable NAME or alias. Never an ID and never an IP: the ID changes on every
# recreation, and Docker renumbers the network with it.
HERMES_CONTAINER="${HERMES_CONTAINER:-hermes-agent-r3j1-hermes-agent-1}"
BRIDGE_CONTAINER="${BRIDGE_CONTAINER:-nexup-bridge}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/nexup-bridge/docker-compose.bridge.yml}"

# Root-only file (0600) holding the fixed HERMES_DASHBOARD_SESSION_TOKEN. Also
# present in /etc/nexup-bridge/bridge.env, which is the bridge's copy: the two
# MUST match, and neither is ever logged.
TOKEN_FILE="${TOKEN_FILE:-/etc/nexup-bridge/hermes-session-token}"
MIN_TOKEN_CHARS="${MIN_TOKEN_CHARS:-16}"

# The one profile in scope. `default` is Adel and is refused outright.
HERMES_PROFILE="${HERMES_PROFILE:-saieed}"
ALLOWED_PROFILES="${ALLOWED_PROFILES:-saieed}"

HERMES_HOME="${HERMES_HOME:-/opt/data}"
HERMES_BIN="${HERMES_BIN:-/opt/hermes/.venv/bin/hermes}"
HERMES_PYTHON="${HERMES_PYTHON:-/opt/hermes/.venv/bin/python}"
SERVE_HOST="${SERVE_HOST:-127.0.0.1}"
SERVE_PORT="${SERVE_PORT:-9119}"

RECONCILE_INTERVAL="${RECONCILE_INTERVAL:-10}"
# 30, not 5: a cold `hermes serve` was measured at ~10 s to accept a TCP
# connection on the real host, so the old 5x1 s budget declared a healthy serve
# dead and re-started it forever. 30 attempts ≈ 30 s of budget, which the unit
# spends sleeping, not working.
SERVE_START_ATTEMPTS="${SERVE_START_ATTEMPTS:-30}"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "FATAL $*"
  exit 1
}

container_running() {
  [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

owner_id() {
  "$DOCKER" inspect -f '{{.Id}}' "$HERMES_CONTAINER" 2>/dev/null || true
}

# `container:<id>` when the bridge shares a namespace, or anything else / empty
# when it does not (absent, stopped, or on its own network).
bridge_network_mode() {
  "$DOCKER" inspect -f '{{.HostConfig.NetworkMode}}' "$BRIDGE_CONTAINER" 2>/dev/null || true
}

# Is something ACCEPTING connections on the serve endpoint? A TCP connect is the
# only probe that distinguishes "the process exists" from "the endpoint works",
# and it invokes no RPC method.
serve_up() {
  "$DOCKER" exec "$HERMES_CONTAINER" "$HERMES_PYTHON" -c \
    "import socket;socket.create_connection(('$SERVE_HOST',$SERVE_PORT),2).close()" >/dev/null 2>&1
}

# Diagnostics from `token_value` go to STDERR on purpose: it is read through
# `$( )`, which captures stdout, so a message written on stdout is swallowed and
# the operator sees a bare non-zero exit with no explanation. Measured against
# the real daemon: `--once` with an unreadable token file exited 1 silently.
token_die() {
  printf '%s FATAL %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

token_value() {
  [ -r "$TOKEN_FILE" ] || {
    token_die "session token file $TOKEN_FILE is not readable (expected root-owned, mode 0600)"
    return 1
  }
  local token
  token="$(cat "$TOKEN_FILE")" || {
    token_die "session token file $TOKEN_FILE could not be read"
    return 1
  }
  [ -n "$token" ] || {
    token_die "session token file $TOKEN_FILE is empty"
    return 1
  }
  [ "${#token}" -ge "$MIN_TOKEN_CHARS" ] || {
    token_die "session token in $TOKEN_FILE has ${#token} characters; at least $MIN_TOKEN_CHARS are required"
    return 1
  }
  printf '%s' "$token"
}

start_serve() {
  local token="$1"
  log "SERVE-DOWN -> starting serve with fixed token (profile=$HERMES_PROFILE host=$SERVE_HOST port=$SERVE_PORT)"
  # The token is passed as a BARE variable name so `docker exec` copies it from
  # this process's environment: the value never appears in any argv, and
  # therefore never in `ps` output on the host or in the container.
  HERMES_DASHBOARD_SESSION_TOKEN="$token" "$DOCKER" exec -d \
    -e HERMES_DASHBOARD_SESSION_TOKEN \
    -e HERMES_HOME="$HERMES_HOME" \
    "$HERMES_CONTAINER" \
    "$HERMES_BIN" -p "$HERMES_PROFILE" serve --isolated --host "$SERVE_HOST" --port "$SERVE_PORT"

  local attempt=0
  while [ "$attempt" -lt "$SERVE_START_ATTEMPTS" ]; do
    if serve_up; then
      log "SERVE-UP (attempt $((attempt + 1)))"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  log "SERVE-START-FAILED after $SERVE_START_ATTEMPTS attempts: the serve endpoint is still closed"
  return 1
}

recreate_bridge() {
  local reason="$1"
  log "RECONCILE $reason -> re-creating $BRIDGE_CONTAINER so it joins the current namespace"
  # `docker rm -f` of a namespace owner is NOT refused while a dependent exists
  # (measured), so the dependent is removed first here, explicitly.
  "$DOCKER" rm -f "$BRIDGE_CONTAINER" >/dev/null 2>&1 || true
  "$DOCKER" compose -f "$COMPOSE_FILE" up -d
}

# One idempotent pass. Returns 0 when the world matches the configuration, 1
# when something it tried to fix did not come up (the loop simply retries).
reconcile_once() {
  local token="$1"

  local id
  id="$(owner_id)"
  if [ -z "$id" ]; then
    log "NO-HERMES container '$HERMES_CONTAINER' is absent; nothing to reconcile (no mutation)"
    return 0
  fi
  if ! container_running "$HERMES_CONTAINER"; then
    log "NO-HERMES container '$HERMES_CONTAINER' is not running; leaving it alone"
    return 0
  fi

  local failed=0

  if serve_up; then
    log "SERVE-UP ok (host=$SERVE_HOST port=$SERVE_PORT)"
  else
    start_serve "$token" || failed=1
  fi

  local mode
  mode="$(bridge_network_mode)"
  if [ "$mode" = "container:$id" ]; then
    log "BRIDGE-OK target=$HERMES_CONTAINER id=$id mode=$mode (no mutation)"
  else
    log "BRIDGE-STALE target=$HERMES_CONTAINER was=$mode expected=container:$id"
    recreate_bridge "bridge-is-stale" || failed=1
  fi

  return "$failed"
}

main() {
  case ",$ALLOWED_PROFILES," in
    *",$HERMES_PROFILE,"*) ;;
    *) die "HERMES_PROFILE '$HERMES_PROFILE' is not in the allowed set ($ALLOWED_PROFILES)" ;;
  esac
  [ "$HERMES_PROFILE" = "default" ] && die "HERMES_PROFILE=default is Adel and is out of scope"

  command -v "$DOCKER" >/dev/null 2>&1 || die "'$DOCKER' is not on PATH"
  [ -r "$COMPOSE_FILE" ] || die "compose file $COMPOSE_FILE is not readable"

  # Fail-closed WITHOUT relying on `set -e`: an unusable token must stop here,
  # not fall through as an empty string that gets handed to `docker exec -e`
  # (measured: with `set -e` disabled the loop happily started a serve with no
  # token at all).
  local token
  token="$(token_value)" || exit 1

  log "SUPERVISOR start profile=$HERMES_PROFILE owner=$HERMES_CONTAINER compose=$COMPOSE_FILE interval=${RECONCILE_INTERVAL}s"

  if [ "${1:-}" = "--once" ]; then
    reconcile_once "$token"
    return $?
  fi

  while true; do
    reconcile_once "$token" || log "RECONCILE incomplete; retrying in ${RECONCILE_INTERVAL}s"
    sleep "$RECONCILE_INTERVAL"
  done
}

if [ "${NEXUP_SUPERVISOR_LIB_ONLY:-0}" != "1" ]; then
  main "$@"
fi
