# Secure NEXUP VPS Bridge

## Purpose

NEXUP on Vercel reaches a Hermes runtime that lives on the VPS and is bound to
**loopback only**. The bridge is the single, narrow, authenticated surface
between them.

```
NEXUP / Vercel  ──HTTPS + SSE──▶  Bridge (VPS, 127.0.0.1:9220)
                                       │  JSON-RPC /api/ws (loopback auth)
                                       ▼
                                  Hermes  127.0.0.1:9119
```

The bridge is **not** a generic proxy. It exposes a fixed NEXUP run API and maps
each operation to a hard-coded Hermes method sequence against one pinned profile.

## 1. Runtime / stack

- Node.js 22 + TypeScript, bundled to a single CommonJS file with esbuild.
- Node built-ins only at runtime (`node:http`, `node:crypto`); no framework.
- It **reuses** the app's verified Hermes modules (`hermes-rpc-transport.ts`,
  `hermes-protocol.ts`, `hermes-spawn.ts`) and the shared signing primitive
  (`src/modules/workforce/bridge/signing.ts`), so the two sides cannot drift.
- Separate workspace: `bridge/`. It is never bundled into the Next build.

## 2. Endpoint contract (`/v1`, NEXUP-owned)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/runs` | Submit a run → `201 { runId, streamUrl, status }` |
| `GET` | `/v1/runs/:id/stream` | SSE stream (`delta` / `complete` / `error`) |
| `GET` | `/v1/runs/:id` | Status snapshot |
| `POST` | `/v1/runs/:id/cancel` | Cancel (maps to `session.interrupt`) |
| `GET` | `/v1/health` | Bridge + Hermes liveness (`gateway.ping`) |
| `GET` | `/v1/capabilities` | Static: pinned profile, operations, limits |

There is **no `/rpc` passthrough**: no caller-supplied `method`, no
caller-supplied `profile`. A `profile` field in a body is rejected
(`FORBIDDEN_PROFILE`).

## 3. Auth / signing model

Every request is signed with HMAC-SHA256 by the shared signer:

- headers: `x-nexup-key-id`, `x-nexup-timestamp`, `x-nexup-nonce`, `x-nexup-signature`
- canonical string: `METHOD \n path \n timestamp \n nonce \n sha256hex(body)`
- verification uses a constant-time comparison; unknown key ids are rejected
- the timestamp must be within `NEXUP_BRIDGE_CLOCK_SKEW_SECONDS` (replay window)
- each `(keyId, nonce)` is single-use within the window (bounded TTL nonce store)
- TLS terminates at the reverse proxy; the bridge listens on loopback only
- the Hermes session token lives **only** in the bridge

## 4. Streaming design

- one WebSocket per run to Hermes; deltas are forwarded as SSE frames
- completion is the terminal event / terminal state, never text matching
- a bounded replay buffer lets a late SSE client catch up
- client disconnect (or `abort`) interrupts the Hermes session
- output is bounded by `NEXUP_BRIDGE_MAX_OUTPUT_BYTES`

## 5. Error model

Uniform envelope `{ "error": { code, message, retryable, detail? } }` with codes
`BAD_REQUEST`, `UNAUTHORIZED`, `SIGNATURE_INVALID`, `REPLAY`, `FORBIDDEN_PROFILE`,
`METHOD_NOT_ALLOWED`, `RUN_NOT_FOUND`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`,
`HERMES_TIMEOUT`, `HERMES_UNAVAILABLE`, `HERMES_PROTOCOL_ERROR`, `INTERNAL`.
Hermes transport kinds map onto these codes in one place
(`bridge/src/api/errors.ts`).

## 6. Deployment topology

- reverse proxy (Caddy) terminates TLS on `:443` and proxies to `127.0.0.1:9220`
- the bridge runs under systemd as a non-root user with sandboxing
- Hermes stays on `127.0.0.1:9119`; only `:443` and `:22` are reachable externally
- the bridge never starts, stops or reconfigures Hermes

## 7. Secret storage

- VPS: `/etc/nexup-bridge/bridge.env` (`chmod 600`, owner `nexup-bridge`), loaded
  by systemd; see `bridge/deploy/nexup-bridge.env.example`
- Vercel: `HERMES_RUNTIME_BRIDGE_URL`, `HERMES_RUNTIME_BRIDGE_KEY_ID`,
  `HERMES_RUNTIME_BRIDGE_SECRET`, and `HERMES_RUNTIME_TRANSPORT=BRIDGE`
- secrets never enter git; `resolveBridgeConfig` reports only their PRESENCE

## 8. Observability

- structured JSON logs (stdout → journald): ids, statuses, timings, byte counts
- an append-only audit line per request/run (who/keyId, action, runId, profile,
  outcome, status, duration)
- counters and gauges on the loopback metrics registry
- `/v1/health` for liveness

## 9. Failure isolation

- Hermes down → `503 HERMES_UNAVAILABLE`, no bridge crash
- bounded concurrency; excess is `429` rather than queued without limit
- per-run session with `close_on_disconnect`; a bridge restart cannot affect the
  shared process on `4860` or the `default` profile
- signature/rate/replay checks run before any Hermes socket is opened

## 10. Runbook

There is **no host Node process** any more. The bridge is its own container that
shares the Hermes container's network namespace, and an operator-owned systemd
supervisor owns both the `saieed serve` endpoint and the bridge's lifecycle. The
authoritative, step-by-step procedure is
[`NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md`](./NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md); the
shape is:

```bash
# build (build machine)
cd nexup-business-system/bridge && npm run build && npm run build:cli

# stage + build + pin the image (VPS: /opt/nexup-bridge holds Dockerfile + dist/main.js)
docker build --pull -t nexup-bridge:<SHA> /opt/nexup-bridge
docker image inspect --format '{{index .RepoDigests 0}}' nexup-bridge:<SHA>

# secrets: HMAC + the FIXED session token (never printed, never in argv)
install -m 0600 deploy/nexup-bridge.env.example /etc/nexup-bridge/bridge.env
umask 077; openssl rand -hex 32 > /etc/nexup-bridge/hermes-session-token

# supervisor: owns the serve, re-creates the bridge when the Hermes ID changes
install -m 0755 deploy/nexup-bridge-supervisor.sh /usr/local/bin/nexup-bridge-supervisor
install -m 0644 deploy/systemd/nexup-bridge-supervisor.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now nexup-bridge-supervisor

# verify: nothing is published, and the edge answers
ss -ltn | grep -E '9119|9220'   # expected: NO output — both live inside the container
curl -sS https://<BRIDGE_HOSTNAME>/v1/health   # 401 without a signature
journalctl -u nexup-bridge-supervisor -f
```

## 11. Rollback

- the whole path is opt-in: leave `HERMES_RUNTIME_TRANSPORT` unchanged (RPC) and
  nothing routes to the bridge
- kill switch: unset/disable the bridge transport in Vercel and redeploy; jobs
  fall back cleanly with `RUNTIME_UNAVAILABLE`
- bridge rollback is a systemd restart to the previous `main.js`; no migrations

## 12. Non-goals

No public Hermes port; no generic/arbitrary RPC proxy; no caller-supplied method
or profile; no arbitrary shell execution; no Hermes lifecycle management; no
access to `default`; no changes to the shared Hermes process on `4860`.
