# AI Workforce — Phase 2B Status

## Status

**runtime-compatible and live-verified against Hermes v0.21.2**

Phase 2B (the agent-runtime dispatch seam + the Hermes adapter and its transport
set) is no longer merely "transport-ready". It has been exercised end-to-end
against a real Hermes Agent install, and the runtime is compatible with it.

## What was verified

Live smoke test against an isolated runtime on the VPS:

- Hermes **v0.21.2**
- isolated profile **`saieed`** (the `default` profile was never addressed)
- backend bound to **`127.0.0.1:9119`** (loopback only)
- authenticated WebSocket on **`/api/ws`**
- `gateway.ready` received
- `gateway.ping` returned `{ "ok": true }`
- `session.create(profile="saieed")` succeeded; returned metadata confirmed
  `profile_name: "saieed"`
- model `deepseek/deepseek-v4.1-flash`, provider `nous`
- `prompt.submit` accepted with status `streaming`
- live JSON-RPC `method:"event"` frames received

No destructive, finance or publishing actions ran. The pre-existing shared
Hermes process on port `4860` was not modified.

## Completion contract (important)

The manual smoke script stopped when an expected response marker appeared in the
stream. **Production code must not do that.** Completion is driven by the real
terminal event / terminal session state:

- the transport registers its terminal-event waiter **before** sending
  `prompt.submit`, so a fast turn cannot complete before it is listening;
- it resolves on `message.complete` (or the `error` event), filtered by
  `session_id` — see `src/modules/workforce/runtimes/hermes/hermes-rpc-transport.ts`;
- the VPS bridge and the app-side `HermesBridgeTransport` both preserve this
  contract and never match response text.

## Transports

| Transport | Kind | Status |
|---|---|---|
| `HermesRpcTransport` | `RPC` | **VERIFIED** primary — WebSocket JSON-RPC 2.0 on `/api/ws` |
| `HermesBridgeTransport` | `BRIDGE` | **NEW** — the authenticated NEXUP VPS bridge path (see `NEXUP_VPS_BRIDGE.md`) |
| `HermesCliOneshotTransport` | `CLI_ONESHOT` | VERIFIED fallback/diagnostic |
| `HermesHttpTransport` / `HermesCliTransport` | `HTTP` / `CLI` | QUARANTINED scaffolding, never defaults |

## Notes

- The adapter addresses exactly one pinned profile (`saieed`); `default` is
  refused by `assertAddressableProfile`.
- Nothing here is merged to `master`; this work lives on the feature branch.
