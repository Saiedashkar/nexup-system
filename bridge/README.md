# nexup-vps-bridge

The authenticated bridge between NEXUP (Vercel) and a loopback-only Hermes
runtime on the VPS. See [`../docs/NEXUP_VPS_BRIDGE.md`](../docs/NEXUP_VPS_BRIDGE.md)
for the full architecture and runbook.

## Commands

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm run test        # vitest run --config vitest.config.ts
npm run build       # esbuild bundle -> dist/main.js (resolves the @ alias)
npm start           # node dist/main.js
```

## Release probes (read-only, Step 2/8)

The P0–P4 pre-flight and the P2 Hermes method-compatibility probe from
[`../docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md`](../docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md)
are encoded as one read-only CLI. It executes no state change and prints no secret
values; a safety check that cannot run fails the run (fail closed).

```bash
npm run build:cli   # esbuild bundle -> dist/release-cli.js
node dist/release-cli.js preflight --hermes-src /opt/hermes --expected-digest <SHA256_FROM_P0> [--exec-probes]
node dist/release-cli.js hermes-compat --hermes-src /opt/hermes [--accept-degraded]
```

Exit codes are `0` PASS, `1` NO-GO, `2` usage error; the verdict is the last line.
Off-host, replay a recorded host with `--fixture fixtures/release/<name>.json`
(e.g. `host-pass.json`, `host-fail-safety.json`, `hermes-degraded.json`) — that is
how the probes are exercised without touching the VPS.


## Guarantees

- Hermes stays loopback-only; the bridge never exposes it.
- No generic RPC passthrough and no caller-supplied profile or method.
- A strict Hermes method allowlist (`llm.oneshot` is excluded).
- Signed, replay-protected requests with rate limiting and audit logging.
- No Hermes lifecycle management and no arbitrary shell execution.
