# nexup-vps-bridge

The authenticated bridge between NEXUP (Vercel) and a loopback-only Hermes
runtime on the VPS. See [`../docs/NEXUP_VPS_BRIDGE.md`](../docs/NEXUP_VPS_BRIDGE.md)
for the architecture and
[`../docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md`](../docs/NEXUP_VPS_BRIDGE_DEPLOY_RUNBOOK.md)
for the deployment procedure.

## Commands

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm run test        # vitest run --config vitest.config.ts  (includes the supervisor harness)
npm run build       # esbuild bundle -> dist/main.js (resolves the @ alias)
npm run build:cli   # esbuild bundle -> dist/release-cli.js
npm start           # node dist/main.js
```

## How it is deployed (revised C)

The bridge is its own container that **shares the Hermes container's network
namespace** (`network_mode: container:<hermes>`), so it reaches the loopback
`serve` Hermes listens on at `ws://127.0.0.1:9119/api/ws` with a **fixed**
`HERMES_DASHBOARD_SESSION_TOKEN`. Nothing is published on the host — no `ports:`
anywhere — and Traefik reaches the bridge at the owner container's address.

| Artifact | Role |
|---|---|
| [`deploy/Dockerfile`](deploy/Dockerfile) | the image (non-root, no writable path, self-contained bundle) |
| [`deploy/docker-compose.bridge.yml`](deploy/docker-compose.bridge.yml) | the deployment definition: shared namespace, no published ports, Traefik labels, hardening |
| [`deploy/nexup-bridge-supervisor.sh`](deploy/nexup-bridge-supervisor.sh) | the operator-owned supervisor: starts/keeps the `saieed serve` and re-creates the bridge whenever the Hermes container ID changes |
| [`deploy/systemd/nexup-bridge-supervisor.service`](deploy/systemd/nexup-bridge-supervisor.service) | the unit that runs the supervisor |
| [`deploy/nexup-bridge.env.example`](deploy/nexup-bridge.env.example) | `/etc/nexup-bridge/bridge.env` (0600 root): bind opt-in, edge boundary, secrets |
| [`deploy/nexup-bridge.deploy.env.example`](deploy/nexup-bridge.deploy.env.example) | `/etc/nexup-bridge/deploy.env` (0600 root): the image digest + bridge hostname the definition interpolates — the ONE place the deployed image identity lives |

The supervisor's decisions are tested locally by
[`tests/supervisor.test.sh`](tests/supervisor.test.sh) (run from
`tests/supervisor.test.ts`), which drives the real script with a stubbed `docker`
and asserts idempotence, re-parenting order, and that the session token never
reaches an argument or a log line.

## Release probes (read-only)

The P0–P4 pre-flight and the P2 Hermes method-compatibility probe from the
runbook are encoded as one read-only CLI. It executes no state change and prints no
secret values; a failed check is a NO-GO at any severity (do not proceed on a
warning), and a safety check that cannot run fails the run (fail closed). A check
that cannot run is reported without gating only when it is advisory and off-host by
design (P0.1, P0.3, P1.7, P4.10).

```bash
npm run build:cli
# Both identity arguments come from the ONE source — the installed deployment env.
DEPLOY=/etc/nexup-bridge/deploy.env
node dist/release-cli.js preflight \
  --image "$(awk -F= '/^NEXUP_BRIDGE_IMAGE=/{print $2}' "$DEPLOY")" \
  --expected-digest "$(awk -F'@' '/^NEXUP_BRIDGE_IMAGE=/{print $2}' "$DEPLOY")" \
  --bridge-hostname <BRIDGE_HOSTNAME> \
  --hermes-src <READ_ONLY_COPY_OF_THE_HERMES_TREE> \
  [--exec-probes]

node dist/release-cli.js hermes-compat --hermes-src <DIR> [--accept-degraded]
```

`--exec-probes` enables the three checks that execute something, none of which
changes state: a `grep` inside the image (P0.2c), two bridge runs that exit before
`listen` to prove the bind guard (P0.6), and one TCP connection to the serve
endpoint inside the Hermes container (P4.12).

The Hermes tree now lives **inside** the container, so P2 needs a read-only copy:
`docker cp <hermes>:/opt/hermes /tmp/nexup-hermes-src && node dist/release-cli.js
preflight --hermes-src /tmp/nexup-hermes-src … ; rm -rf /tmp/nexup-hermes-src`.

Exit codes are `0` PASS, `1` NO-GO, `2` usage error; the verdict is the last line.
Off-host, replay a recorded host with `--fixture fixtures/release/<name>.json`
(e.g. `host-pass.json`, `host-fail-safety.json`, `hermes-degraded.json`) — that is
how the probes are exercised without touching the VPS.

## Guarantees

- Hermes stays loopback-only; the bridge never exposes it, and no port is
  published on the host.
- No generic RPC passthrough and no caller-supplied profile or method.
- A strict Hermes method allowlist (`llm.oneshot` is excluded).
- Signed, replay-protected requests with rate limiting and audit logging.
- The client address comes from the rightmost edge-appended `X-Forwarded-For`
  entry, believed only from a trusted proxy network.
- No Hermes lifecycle management in the bridge: the supervisor owns the serve and
  the bridge container, and the managed Hermes image, compose and dashboard are
  never modified. `default` (Adel) is never addressed.
