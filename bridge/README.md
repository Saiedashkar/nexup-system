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

## Guarantees

- Hermes stays loopback-only; the bridge never exposes it.
- No generic RPC passthrough and no caller-supplied profile or method.
- A strict Hermes method allowlist (`llm.oneshot` is excluded).
- Signed, replay-protected requests with rate limiting and audit logging.
- No Hermes lifecycle management and no arbitrary shell execution.
