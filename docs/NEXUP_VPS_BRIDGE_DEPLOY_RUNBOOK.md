# NEXUP VPS Bridge — Deployment Package & Runbook (Step 2/8)

**Status:** readiness artifact. Nothing in this document has been executed against
the VPS. It is the script for a supervised deployment window.

**Companion documents** (do not duplicate, read alongside):

- [`docs/NEXUP_VPS_BRIDGE.md`](./NEXUP_VPS_BRIDGE.md) — architecture, endpoint
  contract, auth model, error model, non-goals.
- `bridge/README.md` — build/test commands.

**Relationship to the code.** Every step below is derived from the artifacts on
disk: `bridge/`, `bridge/deploy/Dockerfile`,
`bridge/deploy/docker-compose.bridge.yml`, `bridge/deploy/nexup-bridge-supervisor.sh`,
`bridge/deploy/systemd/nexup-bridge-supervisor.service`,
`bridge/deploy/nexup-bridge.env.example`, and
`src/modules/workforce/bridge/signing.ts`. Where the code does **not** back a
promise, this runbook says so and gives a check instead of an assertion. Anything
the operator cannot verify is listed under
[§8 Known-accepted limitations](#8-known-accepted-limitations-do-not-relitigate-these-in-the-window).

---

## 0.0 The architecture as deployed (revised C) — read this first

The bridge is **not** a host process behind Caddy in front of a host Hermes. It is
an independent container that **shares the Hermes container's network namespace**:

```
  internet ──► Traefik (host netns, owns :80/:443) ──► 172.16.x.2:9220
                                                          │  (the OWNER's address)
  ┌─────────────────────── Hermes container network namespace ───────────────┐
  │  127.0.0.1:9119  hermes -p saieed serve --isolated   ◄── supervised      │
  │  0.0.0.0:9220    nexup-bridge  (shares this namespace, publishes NOTHING)│
  └──────────────────────────────────────────────────────────────────────────┘
  supervisor (systemd, host): owns the serve above and re-creates the bridge
                              whenever the Hermes container ID changes
```

Why it has to be this shape (each measured in Gate 0, not assumed):

1. **Hermes' only usable credential channel is a loopback bind.** With a
   non-loopback bind Hermes enters its gated auth mode, where `?token=` is
   `403` and only a browser-minted `?ticket=` works — unusable by a service.
   The serve must therefore stay on `127.0.0.1`, and sharing the namespace is
   what lets the bridge reach it.
2. **Traefik reaches a shared-namespace container at the OWNER's address.** A
   `network_mode: container:` container exposes no address of its own
   (`Networks = {}`), yet routes fine because the provider follows `NetworkMode`
   to the owner's endpoint. When the owner is removed, the route drops to 404
   while the dependent still reads `running` — an orphan the supervisor must
   re-create.
3. **Nothing is ever published on the host.** No `ports:` anywhere in the
   definition; the bridge is reachable only through Traefik and only inside that
   namespace.

### Carried policy decisions, and where they landed

| Item | Decision | Where it lives |
|---|---|---|
| **E4** client IP / `X-Forwarded-For` | Traefik cannot overwrite an arbitrary header with the peer address; it **appends** the peer to `X-Forwarded-For`. So the bridge is configured with `NEXUP_BRIDGE_CLIENT_IP_HEADER=x-forwarded-for` and reads the **RIGHTMOST** entry. Anything to its left is caller-supplied and cannot mint a fresh pre-auth bucket. The trusted boundary is named as a **network** (`172.16.0.0/16`), not one address, because Docker renumbers the network on every recreation | `client-identity.ts` (`EDGE_APPENDED_HEADERS`, CIDR matching), `config.ts` (off-loopback requires an explicit non-loopback boundary), tool **P1.8**, **P3.1** |
| **E5** SSE budget | The run stream must never be buffered by the edge, and the end-to-end budget is the bridge's own 120 s run timeout. The definition therefore carries **no** buffering middleware, and `x-accel-buffering: no` / `no-cache, no-transform` are set by the bridge itself | `docker-compose.bridge.yml` (labels), tool **P0.7b** |
| **E6** 256 KB body cap + security headers | Security headers are applied at the edge by a Traefik `headers` middleware (HSTS, nosniff, Referrer-Policy). The **body cap has no edge implementation**: Traefik core cannot limit a request body without a plugin, and the one built-in that can (`buffering`) is exactly the middleware E5 forbids. The bridge is therefore the control of record — `NEXUP_BRIDGE_MAX_BODY_BYTES=262144`, refused before any work | tool **P1.1** (gates the value), **P0.7b** (refuses buffering), §8 L11 |
| **E9** DNS / ACME | Deferred to the deployment stage: it needs a real certificate issuance for `<BRIDGE_HOSTNAME>` | §3 step 9, §5 R.5 |

**Placeholder convention.** `<ANGLE_BRACKETS>` mark values the operator supplies.
Secret-like values are **never** written into this document, into shell history,
into `journalctl` output, or into a ticket. Commands below verify secrets by
*length*, *presence* or *checksum* — never by printing them.

**Time budget.** Pre-flight 20–30 min · build+artifacts 10 min · install 15 min ·
smoke 15 min · rollback rehearsed 10 min. Budget one hour of Saeed's attention for
install+smoke, with pre-flight done beforehand.

---

## 0. Facts this runbook assumes (verify, do not trust)

| Fact | Source | Check |
|---|---|---|
| The bridge runs as its own container in the Hermes network namespace, publishing nothing | `bridge/deploy/docker-compose.bridge.yml` | P0.5a |
| It reaches Hermes at `ws://127.0.0.1:9119/api/ws` with a **fixed** session token, profile pinned `saieed` | `bridge/src/config.ts`; `bridge/deploy/nexup-bridge-supervisor.sh` | P1.4, P1.5, P4.12 |
| The off-loopback bind is refused unless `NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND=true` **and** the trusted edge is named off-loopback | `bridge/src/config.ts` | P0.6, P1.8 |
| The client address comes from the **rightmost** `X-Forwarded-For` entry, believed only from a trusted proxy network | `bridge/src/auth/client-identity.ts` | P1.8, P3.1 |
| Traefik terminates TLS on the bridge hostname and applies the security headers, with no buffering middleware | `docker-compose.bridge.yml` labels | P0.7a, P0.7b |
| A systemd supervisor owns the `saieed serve` lifecycle and re-creates the bridge when the Hermes container ID changes | `bridge/deploy/nexup-bridge-supervisor.sh` | P3.5, P4.11 |
| Bridge serves only `/v1/*`; no generic RPC, no query strings | `bridge/src/api/app.ts` L261, L312 | S3, S6 |
| The bridge never starts, stops or reconfigures Hermes, and never touches `default`/Adel | `bridge/src/main.ts`; the supervisor's profile allowlist | S14 (Hermes and the dashboard unchanged) |

## 1. PRE-FLIGHT

Run all of P0–P4 on the build machine and on the VPS. **Every check has a stated
pass signal. Do not proceed on a warning.**

### P0. Release artifact and deployment definition

Run the build half on the build machine; run the tool on the VPS.

```bash
cd <REPO_ROOT>/nexup-business-system/bridge
git -C <REPO_ROOT> rev-parse HEAD                 # record this SHA in the change record
git -C <REPO_ROOT> status --porcelain             # pass: no unexpected modifications
npx tsc -p tsconfig.json --noEmit                 # pass: no output, exit 0
npx vitest run --config vitest.config.ts          # pass: every suite green (incl. supervisor.test.sh)
npm run build                                     # pass: exit 0
npm run build:cli                                 # pass: exit 0
sha256sum dist/main.js                            # record (build input)
```

Then **build the image on the VPS** from the staged context (`/opt/nexup-bridge`
holds `Dockerfile` + `dist/main.js`) and **pin it by digest**:

```bash
docker build --pull -t nexup-bridge:<SHA> /opt/nexup-bridge
docker image inspect --format '{{index .RepoDigests 0}}' nexup-bridge:<SHA>   # record this digest
```

> **Recorded build (STEP 2 pre-deploy checkpoint).** The build INPUT, measured
> on the tree this commit captures:
>
> | | |
> |---|---|
> | Bundle | `bridge/dist/main.js` sha256 `1136425b17e1fa1204f1d74694db7580866b2d5f0216ccb8c6930c9ec73b4a4f`, **75,408 B** |
> | Build tag used at build time | `nexup-bridge:step2-1136425b17e1` |
>
> **Where the image digest lives — exactly one place.**
> `bridge/deploy/nexup-bridge.deploy.env.example`, installed as
> `/etc/nexup-bridge/deploy.env` (0600 root), holds
> `NEXUP_BRIDGE_IMAGE=<name>@sha256:…`. That installed file is the deployment's
> only image identity: `docker-compose.bridge.yml` interpolates it and embeds no
> fallback of its own, and the pre-flight reads the digest back from this same
> file rather than being told it separately:
>
> ```bash
> # the recorded build digest, from the one source
> DEPLOY=/etc/nexup-bridge/deploy.env
> EXPECTED=$(awk -F'@' '/^NEXUP_BRIDGE_IMAGE=/{print $2}' "$DEPLOY")
> IMAGE=$(awk -F= '/^NEXUP_BRIDGE_IMAGE=/{print $2}' "$DEPLOY")
>
> # P0.5b resolves the image the way the DEPLOYMENT does (`docker compose config`)
> # and refuses a digest that differs from --expected-digest, or an identity it
> # cannot resolve. --image/--expected-digest come from the file above, so there is
> # no second copy of the digest to keep in step.
> node dist/release-cli.js preflight --image "$IMAGE" --expected-digest "$EXPECTED"
> ```
>
> **It is a build-specific value, not a constant.** Any change to `bridge/src`
> produces a different `dist/main.js` and therefore a different image digest;
> when that happens, update the ONE source — the `NEXUP_BRIDGE_IMAGE` line in
> `nexup-bridge.deploy.env.example` (and re-install it) — and update the bundle row
> above in the same commit. Do not restate the digest anywhere else: a second copy
> is a second identity, and nothing compares it against the build record.

- **P0.1 Fail signal:** typecheck or any bridge test fails → stop. The method
  guard is proven by `tests/method-guard.test.ts`; a red suite means the
  compile-time allowlist guarantee is not evidenced for this commit.
- **P0.2 Image identity, not a loose bundle.** `dist/` is gitignored
  (`bridge/.gitignore`), so any `dist/main.js` already on disk was built at an
  unknown time. Rebuild from the recorded SHA, build the image from that exact
  file, and treat the **digest of the image** as the artifact identity. Run the
  tool with `--expected-digest <repo-digest-from-P0>` and `--image
  nexup-bridge@sha256:<...>`; **P0.2b** compares the host's copy against it and
  **P0.2c** confirms the allowlist refusal survived into the image.
- **P0.3 Toolchain availability.** `bridge/` has no `node_modules` of its own; the
  build, the tests and `docker build` resolve from the repository root. Run P0
  from a full checkout, or `npm i` at the repo root first.
- **P0.4 The host needs Docker, not Node.** There is **no** Node, npm or Caddy on
  this VPS, and none is installed: the bundle runs inside the image.
  **P0.4a** requires a reachable daemon, **P0.4b** requires Compose v2.
- **P0.5 The deployment definition is the artifact that must be read, not
  grepped.** **P0.5a** requires `network_mode: "container:${NEXUP_HERMES_CONTAINER:-hermes-agent-r3j1-hermes-agent-1}"`
  and refuses any published port (`ports:` with any non-empty value, or a bare
  `- "H:C"` item) — an *empty* `ports: []` publishes nothing and is accepted.
  **P0.5b** requires a digest-pinned image, `env_file: /etc/nexup-bridge/bridge.env`,
  a non-root `user:` declared in the definition (the image sets the same uid;
  both are kept — belt and braces), `read_only: true`, `cap_drop: [ALL]`,
  `no-new-privileges:true` and a `restart:` policy. The image identity is
  **resolved, not read off the page**: the check runs
  `docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml config` — the
  way the deployment and the supervisor's own `up -d` resolve it — and then
  requires the RESOLVED digest to equal `--expected-digest`. A digest that
  differs, a definition that embeds a fallback digest of its own, and an
  identity that cannot be resolved at all are each a NO-GO (fail closed: an
  unknown deployed identity is never a pass). The tool reads the **live**
  directives (comments ignored), and applies **last-wins** to a repeated scalar
  key *and* to a repeated label, the way compose itself merges them — so a later
  wrong `network_mode`, `image`, `user`, `cap_drop`, `env_file` or router label
  wins and is a NO-GO, while the correct value sitting in a comment satisfies
  nothing. A commented-looking correct line plus a live wrong one is exactly the
  false pass this parser exists to prevent.
- **P0.6 Loopback-only bind, with one narrow override.** A non-loopback
  `NEXUP_BRIDGE_HOST` fails closed unless `NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND=true`
  **and** `NEXUP_BRIDGE_TRUSTED_PROXIES` names a non-loopback boundary **and**
  `NEXUP_BRIDGE_CLIENT_IP_HEADER` is set explicitly. Off-loopback, the loopback
  default would trust no peer, so every caller would share ONE pre-auth bucket —
  one client could starve the rest. Prove both refusals inside the image (each run
  exits before `listen`; no port, no config, no state):

  ```bash
  # NOTE: no `--entrypoint`. Let the IMAGE's entrypoint run (`node
  # /app/dist/main.js`) and pass the overrides as `-e` only. Adding `--entrypoint
  # /usr/local/bin/node` REPLACES the entrypoint and therefore DROPS the bundle
  # argument: node starts a REPL, reads EOF and exits 0, so the run can never
  # observe a refusal and the check silently proves nothing (measured against the
  # real daemon during P0).
  docker run --rm \
    -e NEXUP_BRIDGE_HOST=0.0.0.0 -e NEXUP_BRIDGE_HMAC_SECRET=<syn> \
    -e NEXUP_BRIDGE_ALLOWED_KEY_IDS=nexup-vercel -e HERMES_SESSION_TOKEN=<syn> \
    -e HERMES_PROFILE=saieed -e NEXUP_BRIDGE_ALLOWED_PROFILES=saieed \
    -e HERMES_RPC_URL=ws://127.0.0.1:9119/api/ws \
    nexup-bridge@sha256:<DIGEST>; echo "exit=$?"
  # pass: exit=1, stderr mentions "loopback" and NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND
  #
  # Always bound the wait: `timeout 25 docker run …` — a config that DOES listen
  # would otherwise hold the shell open until it is killed by hand.
  ```

  Repeat with `-e NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND=true -e NEXUP_BRIDGE_TRUSTED_PROXIES=127.0.0.1,::1`:
  pass is `exit=1` with stderr naming `NEXUP_BRIDGE_TRUSTED_PROXIES`. (The tool
  does all three runs — both bind refusals **and** the off-scope profile refusal
  below — for you under `--exec-probes`.)

  **The third run: an off-scope profile.** `adel` names the same `/opt/data` root
  as `default`, so the image must refuse it by name:

  ```bash
  timeout 25 docker run --rm \
    -e NEXUP_BRIDGE_HOST=0.0.0.0 -e NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND=true \
    -e NEXUP_BRIDGE_TRUSTED_PROXIES=172.16.0.0/16 -e NEXUP_BRIDGE_CLIENT_IP_HEADER=x-forwarded-for \
    -e NEXUP_BRIDGE_HMAC_SECRET=<syn> -e NEXUP_BRIDGE_ALLOWED_KEY_IDS=nexup-vercel \
    -e HERMES_SESSION_TOKEN=<syn> -e NEXUP_BRIDGE_ALLOWED_PROFILES=saieed \
    -e HERMES_PROFILE=adel -e HERMES_RPC_URL=ws://127.0.0.1:9119/api/ws \
    nexup-bridge@sha256:<DIGEST>; echo "exit=$?"
  # pass: exit=1, stderr names NEXUP_BRIDGE_ALLOWED_PROFILES
  ```

  This refusal exists because the **real daemon disproved the earlier design**:
  before the allowlist was added, the image ACCEPTED `HERMES_PROFILE=adel` and
  served 401s, i.e. it was addressable off-scope. `default` is refused
  unconditionally (`assertAddressableProfile`); every other name must be listed in
  `NEXUP_BRIDGE_ALLOWED_PROFILES`, which is why P1.5 requires that list to be
  exactly `saieed`.
- **P0.7 The edge is Traefik, and its policy lives in the labels.**
  **P0.7a** requires the Traefik container to be running and the host to listen on
  both `:80` and `:443`. **P0.7b** reads the labels: a `Host(...)` rule for
  `<BRIDGE_HOSTNAME>`, `entrypoints=websecure`, `tls=true` with a
  `certresolver`, the service port `9220`, the `nexup-bridge-headers` security
  header middleware — and **no buffering middleware**, because response buffering
  would hold the SSE run frames (E5). Traefik core has no request-body limit
  without a plugin, so no edge body cap is asked for here; see §8 L11.

### P1. Environment and secret **names** (never values)

Host file: `/etc/nexup-bridge/bridge.env` (created in install from
`bridge/deploy/nexup-bridge.env.example`). Required names, all read by
`bridge/src/config.ts`:

`NEXUP_BRIDGE_ENABLED`, `NEXUP_BRIDGE_HOST`, `NEXUP_BRIDGE_PORT`,
`NEXUP_BRIDGE_HMAC_SECRET`, `NEXUP_BRIDGE_ALLOWED_KEY_IDS`,
`NEXUP_BRIDGE_TIMEOUT_MS`, `NEXUP_BRIDGE_MAX_OUTPUT_BYTES`,
`NEXUP_BRIDGE_MAX_CONCURRENCY`, `NEXUP_BRIDGE_RATE_LIMIT_PER_MINUTE`,
`NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE`, `NEXUP_BRIDGE_PREAUTH_GLOBAL_PER_MINUTE`,
`NEXUP_BRIDGE_CLOCK_SKEW_SECONDS`, `NEXUP_BRIDGE_MAX_BODY_BYTES`,
`HERMES_RPC_URL`, `HERMES_SESSION_TOKEN`, `HERMES_ORIGIN`, `HERMES_PROFILE`.

- **P1.1 `NEXUP_BRIDGE_MAX_BODY_BYTES` is the ONLY request-body cap (E6).** There
  is no edge body limit any more: Traefik core cannot cap a body without a plugin,
  and the built-in that can (`buffering`) would break the SSE run stream (§8 L11,
  tool **P0.7b**). If the variable is unset the code default is 262 144 B, which is
  the value the policy assumes. **Pass signal:** the variable is absent, or set to
  exactly `262144`. Any other value raises or lowers the real limit — change it
  deliberately and record why.
- **P1.2 File permissions.** The example documents `chmod 600` only in a comment;
  nothing enforces it, and the container reads the file as root-owned:

  ```bash
  stat -c '%a %U:%G' /etc/nexup-bridge/bridge.env   # pass: 600 root:root
  stat -c '%a %U:%G' /etc/nexup-bridge/hermes-session-token   # pass: 600 root:root
  ```
- **P1.3 Secret strength.** The code refuses only `< 16` characters
  (`config.ts` L116)  while the example recommends 32 random bytes (the weak-secret acceptance
  finding in §8 L5). Generate and assert **without printing**:

  ```bash
  openssl rand -hex 32                 # operator pastes into the env file
  awk -F= '/^NEXUP_BRIDGE_HMAC_SECRET=/{print length($2)}' /etc/nexup-bridge/bridge.env
  # pass: >= 64 (32 random bytes as hex). Anything shorter → regenerate.
  ```
- **P1.4 Key-id agreement both directions.** Bridge `NEXUP_BRIDGE_ALLOWED_KEY_IDS`
  must contain the key id Vercel signs with (`HERMES_RUNTIME_BRIDGE_KEY_ID`, default
  `nexup-vercel` — `hermes-config.ts` L304). **Pass signal:** the Vercel value
  appears in the comma-separated host list.
- **P1.5 Profile pinning.** `HERMES_PROFILE=saieed` only. The env example ships
  `saieed`; `HERMES_PROFILE=default` is refused at startup and the process exits 1
  (checked in S5). **Never write `default` into any file on the host.**
- **P1.6 Clock skew.** The signer and the bridge must agree within
  `NEXUP_BRIDGE_CLOCK_SKEW_SECONDS` (default 300 s). Compare
  `date -u +%s` on the signing host with the VPS; **pass:** difference < 60 s.
  A wrong host clock is the most common cause of a `REPLAY` 401 in smoke.
- **P1.7 Vercel side variables** (set at the same time as the transport flip,
  step I.10): `HERMES_RUNTIME_TRANSPORT=BRIDGE`, `HERMES_RUNTIME_BRIDGE_URL`,
  `HERMES_RUNTIME_BRIDGE_KEY_ID`, `HERMES_RUNTIME_BRIDGE_SECRET`,
  `HERMES_RUNTIME_PROFILE=saieed`. The app's `resolveHermesConfig` fails closed
  and simply does not register the runtime if any are missing
  (`hermes-config.ts` L264–268) — so a missing variable shows up as "runtime
  disabled", never as a fallback to another profile.

### P2. Hermes JSON-RPC method names (the one genuinely unverified item)

`src/modules/workforce/runtimes/hermes/hermes-protocol.ts` L190–197 records that
`gateway.ping` and `session.events.since` come from the operator's contract but
were **not present in the locally inspected Hermes build (v0.20.0)**.
`session.create`, `prompt.submit`, `session.status`, `session.history`,
`session.interrupt` and `llm.oneshot` were read from the source.

The five names the bridge actually **emits** (`hermesMethodsForOperation`) are
`gateway.ping` (health), `session.create` + `prompt.submit` (submit),
`session.status` (status) and `session.interrupt` (cancel). `session.history`
and `session.events.since` are allowlisted but **no operation emits them**, so
their absence cannot break this deployment.

```bash
hermes --version                       # record the version; verified target is v0.21.2
grep -rn "gateway.ping" <HERMES_SOURCE_DIR>
grep -rn "session.create\|prompt.submit\|session.status\|session.interrupt" <HERMES_SOURCE_DIR>
```

- **PASS:** all five emitted names exist in the installed Hermes source; the window
  then confirms it in **S10**.
- **DEGRADE — treat as NO-GO unless explicitly accepted (§6.5):** `gateway.ping`
  missing. The transport maps method-not-found (-32601) to `degraded`, so
  `/v1/health` returns HTTP **200** with `hermes:"degraded"` and
  `detail:"gateway.ping not supported"` — the readiness signal looks green while
  the liveness method is absent. **Runtime behaviour is deliberately left
  unchanged**, because altering the 200/503 boundary before the real method set is
  known would trade one ambiguity for another. Instead the gate carries the risk:
  **S10 must show `healthy`, or the operator records an explicit acceptance of
  `degraded`** — otherwise stop.
- **FAIL:** `session.create`, `prompt.submit`, `session.status` or
  `session.interrupt` missing or renamed → stop. The first real run would fail
  and the cancel path would be dead.

### P3. The four deployment-dependent audit findings, as explicit checks

| # | Finding | Exact check | Pass / fail signal |
|---|---|---|---|
| P3.1 | **Client identity behind the edge — resolved, not collapsed, and spoof-resistant (E4).** `bridge/src/server.ts` L89 still supplies only the *socket* address, but `bridge/src/api/app.ts` L245 passes it to `resolveClientIdentity` (`bridge/src/auth/client-identity.ts`). The forwarded address is believed **only** when the TCP peer is inside a configured trusted proxy **network** (`NEXUP_BRIDGE_TRUSTED_PROXIES`, here `172.16.0.0/16`), and for an edge-APPENDED header (`X-Forwarded-For`, which Traefik appends to) the **rightmost** entry is taken: everything to its left is caller-supplied. Any untrusted peer, repeated header or malformed value falls back to the socket address. The bridge publishes no port, so there is no path around the edge | tool **P3.1** (reads `app.ts`, `client-identity.ts` and the deployment definition); `grep -n "resolveClientIdentity" bridge/src/api/app.ts` | **Pass:** the identity chain is present as described, the definition publishes nothing, and the operator records the residual dependence on Traefik's append semantics (§8 L3). A leftmost read would hand every caller a fresh pre-auth bucket — if `client-identity.ts` loses the rightmost rule, that row fails and the deployment is a NO-GO |
| P3.2 | **Weak-secret acceptance.** `config.ts` L116 refuses only `< 16` chars | P1.3 (`length >= 64`, the tool's **P3.2** row re-reports that same decision) | **Pass:** ≥ 64 chars of hex from a CSPRNG. Fail → regenerate before install |
| P3.3 | **Pre-auth sweep order.** The *nonce store* order is correct (insertion == expiry). The caveat is `PreAuthGuard`: `sweepBuckets` breaks on the first live bucket while `consumeBucket` does not refresh insertion order, so stale buckets linger until the 10 k cap, and cap eviction can drop a live bucket — resetting that remote's budget | `npx vitest run tests/security.test.ts -t "refills over time and keeps its bucket state bounded"` (tool **P3.3** records it; no host action) | **Pass (accepted):** suite is green today. There is **no** test asserting a hot bucket survives eviction — record that as a known low-severity gap (§8 L4). No host action |
| P3.4 | **Byte-vs-character truncation.** `boundText` slices by characters (`hermes-spawn.ts` L23–26), so a multi-byte payload can exceed `NEXUP_BRIDGE_MAX_OUTPUT_BYTES` by up to ~4× | `grep -n "slice(0, maxBytes)" src/modules/workforce/runtimes/hermes/hermes-spawn.ts` (tool **P3.4**) | **Pass (accepted):** the line is character-based. Mitigation in the window: keep `NEXUP_BRIDGE_MAX_OUTPUT_BYTES=262144` (1 MB worst case) and confirm the run with the largest expected output succeeds in S11. No code change in the window |

### P4. Host state capture (the rollback reference)

Capture **before** touching anything; paste into the change record.

```bash
ss -ltnp | grep -E '(:9119|:9220|:4860)'                      # Hermes, bridge, dashboard
systemctl show -p MainPID -p ActiveEnterTimestamp <DASHBOARD_UNIT>
systemctl show -p MainPID -p ActiveEnterTimestamp <HERMES_UNIT_IF_ANY>
cp -a /etc/nexup-bridge/bridge.env /etc/nexup-bridge/bridge.env.bak-<DATE>   # if it exists
sha256sum /opt/nexup-bridge/dist/main.js                       # if a previous build exists
```

**Pass signals:** Hermes is listening on `127.0.0.1:9119` only (**not** `0.0.0.0`);
port 9220 is free; the dashboard unit is `active` and you have its PID and start
timestamp; the previous bundle digest is recorded.

**Fail signal:** Hermes is bound to a non-loopback address, or anything on `4860`
looks unhealthy **before** you start → stop. That is a pre-existing condition and
is not yours to fix in this window.

### Machine-assisted pre-flight

P0–P4 are encoded as a **read-only** checker so the window does not depend on
hand-typing them. Build it once and run it on the host:

```bash
cd <REPO_ROOT>/nexup-business-system/bridge
npm run build:cli                                   # → dist/release-cli.js (not committed)
node dist/release-cli.js preflight \
  --hermes-src /opt/hermes \
  --expected-digest <SHA256_FROM_P0>                # add --exec-probes for P0.6
node dist/release-cli.js hermes-compat \
  --hermes-src /opt/hermes                           # add --accept-degraded to record §6.5 DEGRADE
# On the VPS the image checks need the deployment environment sourced:
#   set -a; . /etc/nexup-bridge/deploy.env; set +a
```

The image-reading checks (P0.2a/P0.2b/P0.2c/P0.6) judge the identity the
**definition** resolves — `${NEXUP_BRIDGE_IMAGE}` after interpolating the
deployment environment, i.e. exactly what the deployment runs and what P0.5b
compares with the recorded build digest. `--image <ref>` is an override for
deliberately judging a *different* artifact, and is not needed for a normal run;
there is no unpinned fallback, so a definition whose image cannot be resolved
makes those checks NO-GO rather than quietly judging `nexup-bridge:latest`. That
fallback was measured on the real host: it failed four safety checks on a
correctly digest-pinned deployment, and would have *passed* them against a stray
`nexup-bridge:latest` built from an older bundle.

- **Read-only.** It only runs `docker version`, `docker compose version`,
  `docker inspect`, `docker image inspect`, `ss`, `stat`, `df`, `sha256sum`,
  `command -v`, `date`, `systemctl --version`, `systemctl is-enabled|is-active`,
  and — only with `--exec-probes` — three executions that change no state: a
  `grep` inside the image, two bridge runs that exit before `listen`, and one TCP
  connection to the serve endpoint from inside the Hermes container. Nothing is
  started, stopped, created, written or configured.
- **Exit codes:** `0` PASS · `1` NO-GO · `2` usage error. The verdict
  (`PREFLIGHT: PASS|FAIL`, `HERMES-COMPAT: PASS|FAIL`) is the last line.
- **Fail closed, and a warning stops the run.** A check that FAILS is a NO-GO at
  *any* severity: §1 says do not proceed on a warning, and an advisory row that
  fails **is** a warning — it is reported as a gated failure, not a note. A check
  that merely *cannot run* is a NO-GO only when it is safety-critical: omitting
  `--exec-probes` leaves P0.6 *could-not-run* and the whole run FAILs, while the
  advisory rows that legitimately cannot run here (P0.1 build gate, P0.3
  toolchain, P1.7 Vercel) are reported and do not gate.
- **Never prints secrets.** It reads `bridge.env` for names, key ids, line count
  and the *length* of the HMAC secret, and prints no values; anything registered
  as secret is redacted from text and `--json` output.
- The `hermes-compat` command **is** P2: it prints the METHOD / EXPECTED / FOUND /
  VERDICT matrix and returns NO-GO if `session.create`, `prompt.submit`,
  `session.status` or `session.interrupt` is missing or renamed; a missing
  `gateway.ping` is reported distinctly as degraded (§6.5).
- Off-host, the same checks replay a recorded host with
  `--fixture fixtures/release/<name>.json` (see `bridge/README.md`) — that is how
  the probes are exercised without touching the VPS. `--json` emits the same
  report for the change record.

#### Running the checker on a host that has no Node (the Phase E method)

The VPS is a minimal host: no Node, no npm, no checkout of this repository. The
checker is a self-contained bundle, but it still needs *an* interpreter, and the
only one guaranteed to exist is the one inside the pinned image. **Never install
Node on the VPS** — the deployment would then depend on a toolchain it does not
ship, and the checker would run on a different Node than the bridge does.

One-time staging. All of it lives under `/tmp`, all of it is disposable, none of
it is part of the deployment:

```bash
# 1. the bridge's OWN interpreter, copied out of the pinned image. `docker create`
#    + `docker cp` works on every docker this runbook supports; the container is
#    never started and is removed immediately.
docker create --name nexup-pf-extract "$NEXUP_BRIDGE_IMAGE"
docker cp nexup-pf-extract:/usr/local/bin/node /tmp/nexup-pf/node
docker rm nexup-pf-extract
/tmp/nexup-pf/node --version          # e.g. v22.x — the runtime's own major

# 2. the checker itself. The image deliberately ships no release tooling (P0.4a),
#    so dist/release-cli.js is staged separately, from the build machine, and
#    digest-compared like every other artifact (§2).
scp bridge/dist/release-cli.js <VPS_HOST>:/tmp/nexup-stage/nexup-bridge/release-cli.js

# 3. the Hermes source. It lives INSIDE the Hermes container, which is not touched
#    except by a read-only `docker cp`; the copy is ~1.3 GB and takes ~1 min.
docker cp hermes-agent-r3j1-hermes-agent-1:/opt/hermes /tmp/nexup-hermes-src
```

Then run the two commands of “Machine-assisted pre-flight” with
`/tmp/nexup-pf/node` in place of `node`:

```bash
cd /tmp/nexup-stage/nexup-bridge
set -a; . /etc/nexup-bridge/deploy.env; set +a        # NOT optional: see P0.5b
/tmp/nexup-pf/node release-cli.js preflight \
  --hermes-src /tmp/nexup-hermes-src \
  --expected-digest <SHA256_FROM_P0> \
  --exec-probes
/tmp/nexup-pf/node release-cli.js hermes-compat --hermes-src /tmp/nexup-hermes-src
```

- **Why `set -a; . /etc/nexup-bridge/deploy.env; set +a`:** the compose-grammar
  check interpolates the *real* definition, whose `image:` is
  `${NEXUP_BRIDGE_IMAGE:?…}` with no fallback. In a clean environment that
  command exits 1 with `required variable NEXUP_BRIDGE_IMAGE is missing a value`
  — the definition working as designed, not a defect — so the recorded invocation
  sources the same file the unit loads.
- **Why `--hermes-src /tmp/nexup-hermes-src`:** the default `/opt/hermes` exists
  only inside the Hermes container.
- **`--expected-digest` takes the `sha256:` value P0 recorded**, not the image tag.
- **It stays read-only.** The Node-less method adds no mutation of its own:
  `docker cp` out of a container, and the one container it creates is removed in
  the next command and never started.
- **Cleanup is part of the method — and it removes the tooling**, so run it after
  the LAST run you need, never before one:
  ```bash
  rm -rf /tmp/nexup-pf /tmp/nexup-stage /tmp/nexup-hermes-src
  ```
  That deletes the host's only Node. `/tmp` is cleared on reboot regardless, and
  the deployment uses none of it: the bridge runs from the image and the
  supervisor from `/usr/local/bin`.

### Pre-flight gate

Proceed to install only if P0, P1, P2 (PASS or recorded DEGRADE), P3 (all four
recorded) and P4 are complete. Any FAIL → stop (§6).

---

## 2. ARTIFACTS

| Artifact | Source on the build machine | Destination on the VPS | Copy how |
|---|---|---|---|
| Bridge bundle | `bridge/dist/main.js` (built in P0) | `/opt/nexup-bridge/dist/main.js` | `scp`, digest compared after copy |
| Image definition | `bridge/deploy/Dockerfile` | `/opt/nexup-bridge/Dockerfile` | `scp` |
| Deployment definition | `bridge/deploy/docker-compose.bridge.yml` | `/opt/nexup-bridge/docker-compose.bridge.yml` | `scp` |
| Supervisor | `bridge/deploy/nexup-bridge-supervisor.sh` | `/usr/local/bin/nexup-bridge-supervisor` (0755 root) | `scp` |
| Supervisor unit | `bridge/deploy/systemd/nexup-bridge-supervisor.service` | `/etc/systemd/system/nexup-bridge-supervisor.service` | `scp`, then `daemon-reload` |
| Env template | `bridge/deploy/nexup-bridge.env.example` | `/etc/nexup-bridge/bridge.env` | **created on the host** from the example; the secret is generated on the host and never leaves it |
| Deployment env | `bridge/deploy/nexup-bridge.deploy.env.example` | `/etc/nexup-bridge/deploy.env` (0600 root) | `install`, then set the image digest + hostname; **the one place the image identity lives** (step 6) |
| Session token | the operator's fixed value | `/etc/nexup-bridge/hermes-session-token` (0600 root) **and** mirrored into `bridge.env` | typed by the operator; never printed |

```bash
sha256sum bridge/dist/main.js                          # local digest, recorded in P0
scp bridge/dist/main.js <VPS_HOST>:/tmp/main.js.upload
ssh <VPS_HOST> 'install -o root -g root -m 0644 /tmp/main.js.upload /opt/nexup-bridge/dist/main.js && rm /tmp/main.js.upload'
ssh <VPS_HOST> 'sha256sum /opt/nexup-bridge/dist/main.js'   # must equal the local digest
```

- **Pass signal:** the two digests are byte-identical.
- **Mismatch → stop.** Do not build or start from an unverified artifact.
- The previous image stays in the local image store under its old tag/digest; that
  is rollback R.3.
- Nothing in `dist/` is committed (`bridge/.gitignore`), and the Vercel app never
  bundles the bridge: the VPS copy is the only deployment of it.

## 3. INSTALL / ENABLE

Ordered. **Do not enable the supervisor before §4 passes**, and do not flip Vercel
until the bridge is proven. Each step lists its expected output.

1. **Directories:** `install -d -o root -g root -m 0755 /opt/nexup-bridge /etc/nexup-bridge`
   *Expected:* no output.
2. **Bundle, definitions and supervisor** in place with the digests verified (§2).
   *Expected:* matching sha256 for the bundle.
3. **The fixed session token** — this is what makes the serve endpoint usable. The
   value must be **fixed** (the same one on every start); a per-start token means
   re-keying the bridge on every restart.
   ```bash
   install -d -m 0700 /etc/nexup-bridge
   umask 077; openssl rand -hex 32 > /etc/nexup-bridge/hermes-session-token
   chmod 0600 /etc/nexup-bridge/hermes-session-token   # never print it, never commit it
   ```
   *Expected:* `stat -c '%a %U:%G' /etc/nexup-bridge/hermes-session-token` → `600 root:root`.
4. **Env file:** `install -o root -g root -m 0600 /etc/nexup-bridge/bridge.env.example /etc/nexup-bridge/bridge.env`,
   then fill the HMAC secret, the **same** session token, and the P1 values.
   *Expected:* later `stat` shows `600 root:root` (P1.2).
5. **Build the image and schedule it** (§2/P0). *Expected:* a new `sha256:`
   image digest from `docker image inspect`.
6. **Deployment environment — created, not improvised.** This file is
   **required**: the definition interpolates `NEXUP_BRIDGE_IMAGE` from it, and
   the unit loads it (`EnvironmentFile=`), so a missing file stops the service
   before it can reconcile anything.
   ```bash
   install -o root -g root -m 0600 bridge/deploy/nexup-bridge.deploy.env.example \
     /etc/nexup-bridge/deploy.env
   # then set, in that file (0600 root):
   #   NEXUP_BRIDGE_IMAGE=nexup-bridge@sha256:<DIGEST_FROM_STEP_5>
   #   NEXUP_BRIDGE_HOSTNAME=<BRIDGE_HOSTNAME>
   #   NEXUP_HERMES_CONTAINER=<name>   (omit: the shipped default is the real one)
   stat -c '%a %U:%G' /etc/nexup-bridge/deploy.env   # pass: 600 root:root
   ```
   *Expected:* `docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml
   config` resolves with no `variable is not set` warning, and its `image:` line
   names the digest above. **Prove the negative too** — the unit must NOT start
   without this file (the required `EnvironmentFile=` makes activation fail):
   ```bash
   systemd-run --property=EnvironmentFile=/etc/nexup-bridge/absent.env /bin/true; echo "exit=$?"
   # pass: exit != 0, "Failed to load environment files" — the same failure mode a
   # missing deploy.env produces for nexup-bridge-supervisor.service
   ```
7. **Supervisor environment and unit.** `supervisor.env` carries the three values
   this deployment was measured to need; the unit itself now also defaults the two
   that a missing key used to break (see the `Environment=` lines), but write them
   down anyway so the file describes the deployment that is actually running:
   ```bash
   install -o root -g root -m 0600 /dev/null /etc/nexup-bridge/supervisor.env
   install -m 0644 bridge/deploy/systemd/nexup-bridge-supervisor.service /etc/systemd/system/
   install -m 0755 bridge/deploy/nexup-bridge-supervisor.sh /usr/local/bin/nexup-bridge-supervisor
   systemctl daemon-reload
   ```
   Then, in that file (0600 root), all three lines:
   ```bash
   #   HERMES_PROFILE=saieed
   #   HOME=/                     # systemd gives the service no usable HOME and
   #                              # ProtectHome=true hides root's, so the docker
   #                              # CLI cannot resolve the compose plugin and the
   #                              # recovery path fails "not a docker command"
   #   SERVE_START_ATTEMPTS=30    # a cold `hermes serve` takes ~10 s to accept a
   #                              # connection; the 5x1 s default declared it dead
   ```
   *Expected:* no output. The unit reads BOTH
   `/etc/nexup-bridge/supervisor.env` and `/etc/nexup-bridge/deploy.env` (step 6)
   — the second is what lets its recovery path run `docker compose up -d` with the
   image reference interpolated. **`HOME=/` is not cosmetic and must not be
   "cleaned up":** the systemd hardening (`ProtectHome=true`, `CapabilityBoundingSet=`)
   is kept deliberately, and `HOME=/` is what makes the docker CLI work *under* it.
   The unit itself now carries both as `Environment=` defaults, so confirm the copy
   that landed actually has them:
   ```bash
   grep -c '^Environment=' /etc/systemd/system/nexup-bridge-supervisor.service   # pass: 2
   ```
   Do **not** try to prove this with `systemctl show -p Environment`: it reports the
   unit's `Environment=` only and never resolves `EnvironmentFile=`, so it shows
   nothing for `HERMES_PROFILE` and would read as a failure on a working host.
   The proof that the running process has the values is in step 9.
8. **Pre-start sanity, without publishing anything.** With the env sourced:
   ```bash
   set -a; . /etc/nexup-bridge/bridge.env; set +a
   HERMES_PROFILE=default docker run --rm -e HERMES_PROFILE=default nexup-bridge@sha256:<DIGEST>; echo "exit=$?"
   ```
   *Expected:* `exit=1` with stderr refusing `default`. This is the proof that the
   `default` profile cannot be addressed — it never reaches `listen`. (Also S5.)
9. **Start the supervisor** (it starts the serve, then creates the bridge):
   ```bash
   systemctl enable --now nexup-bridge-supervisor
   journalctl -u nexup-bridge-supervisor -n 30 --no-pager
   ```
   *Expected:* `SERVE-DOWN -> starting serve with fixed token` then `SERVE-UP`, then
   `BRIDGE-OK` (or `BRIDGE-STALE -> re-creating` on the first pass), and
   `systemctl is-active nexup-bridge-supervisor` → `active`. **No token value
   appears in the journal** — if one does, stop (§6).

   Then prove the two measured settings reached the PROCESS (this is the check
   the unit's own `Environment=` cannot make: `EnvironmentFile=` is resolved at
   exec, so only `/proc` shows the result). Pass = `HOME=/` **and**
   `SERVE_START_ATTEMPTS=30`, measured on the real host:
   ```bash
   MP=$(systemctl show -p MainPID --value nexup-bridge-supervisor)
   tr '\0' '\n' < /proc/$MP/environ | grep -E '^(HOME|SERVE_START_ATTEMPTS)='
   ```
10. **Verify what is exposed:**
    ```bash
    docker inspect -f '{{.HostConfig.NetworkMode}}' nexup-bridge   # container:<hermes id>
    docker inspect -f '{{json .NetworkSettings.Networks}}' nexup-bridge   # {} — no address of its own
    ss -ltnp | grep -E '(:9220|:9119)' || echo "neither port is on the host (correct)"
    ```
    *Expected:* the shared-namespace mode, no address, and **neither** port on the
    host. *Fail signal:* `0.0.0.0:9220` or any `:9119` on the host → stop (§6).
11. **Prove the route end to end — unsigned first, on the real hostname:**
    ```bash
    curl -sS -o /dev/null -w '%{http_code}\n' https://<BRIDGE_HOSTNAME>/v1/health
    ```
    *Expected:* `401` (re-checked as **S3**), and a certificate issued for
    `<BRIDGE_HOSTNAME>` (E9). A `200` means the auth path is not in front of the
    route — stop immediately. A `404` means the router did not attach: check
    `docker inspect` labels and that Traefik can see the owner's endpoint.
12. **Flip Vercel (last):** set the five variables from P1.7 in the production
    environment and redeploy. *Expected:* the app's workforce health endpoint
    reports the runtime as configured with transport `BRIDGE` and profile
    `saieed`. Keep the previous value of `HERMES_RUNTIME_TRANSPORT` recorded —
    it is rollback R.1.

## 4. SMOKE TEST

**These steps were executed locally** in this order against the **compiled
bundle**, with a stub Hermes JSON-RPC endpoint on loopback. Every “Expected
output” below is an observation from that run, not a prediction. One hop the rig
could not cover: TLS, the Traefik route and the shared network namespace, because
it spoke plain HTTP to `127.0.0.1` — so S1 proves the edge path only once it runs
against `https://<BRIDGE_HOSTNAME>`.

Hermes contact escalates: **S1–S9 open no Hermes socket at all**, so a failure
there costs nothing; S10 connects; S11 creates a real session on profile
`saieed`; S12 interrupts one.

**Signing helper.** Copy `signing.ts`'s canonical string exactly
(`src/modules/workforce/bridge/signing.ts` L52–79, canonical string L57):
`METHOD \n path \n timestamp \n nonce \n sha256hex(body)`, HMAC-SHA256 hex, four
lowercase header names. Write it to `/tmp/nexup-smoke.mjs` (`chmod 600`, delete
after the window); it reads the secret from the environment and never prints it.

```js
// /tmp/nexup-smoke.mjs — smoke client for the bridge's documented contract
import { createHash, createHmac, randomBytes } from "node:crypto";
const base = process.env.SMOKE_BASE_URL;               // https://<BRIDGE_HOSTNAME>
const keyId = process.env.SMOKE_KEY_ID;                // must be in NEXUP_BRIDGE_ALLOWED_KEY_IDS
const secret = process.env.NEXUP_BRIDGE_HMAC_SECRET;   // sourced from bridge.env; never printed

// `signedPath` is normally the request path. S4 passes the path WITHOUT the query
// on purpose, so a rejection proves the bridge refuses the query string rather
// than folding it into the signature (signing the query gives a misleading 401).
const sign = (method, signedPath, body = "", overrides = {}) => {
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = overrides.nonce ?? randomBytes(16).toString("hex");
  const canonical = [method.toUpperCase(), signedPath, timestamp, nonce,
    createHash("sha256").update(body, "utf8").digest("hex")].join("\n");
  return {
    "x-nexup-key-id": keyId,
    "x-nexup-timestamp": timestamp,
    "x-nexup-nonce": nonce,
    "x-nexup-signature": createHmac("sha256", secret).update(canonical, "utf8").digest("hex"),
  };
};

const call = async (method, path, { body, headers, signedPath } = {}) => {
  const text = body === undefined ? "" : JSON.stringify(body);
  const res = await fetch(`${base}${path}`, {
    method,
    headers: headers ?? { ...sign(method, signedPath ?? path, text), ...(text ? { "content-type": "application/json" } : {}) },
    body: text || undefined,
  });
  const raw = await res.text();
  console.log(`${method} ${path} -> ${res.status}  cache-control=${res.headers.get("cache-control")}`);
  console.log(raw.slice(0, 300));
  return { status: res.status, raw };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mode = process.argv[2];

if (mode === "capabilities") await call("GET", "/v1/capabilities");
if (mode === "unsigned") console.log(`unsigned -> ${(await fetch(`${base}/v1/health`)).status}`);
if (mode === "query") await call("GET", "/v1/capabilities?x=1", { signedPath: "/v1/capabilities" });
if (mode === "tampered") {
  const headers = sign("GET", "/v1/capabilities");
  const last = headers["x-nexup-signature"].slice(-1);
  headers["x-nexup-signature"] = headers["x-nexup-signature"].slice(0, -1) + (last === "a" ? "b" : "a");
  await call("GET", "/v1/capabilities", { headers });
}
if (mode === "stale")
  await call("GET", "/v1/capabilities", {
    headers: sign("GET", "/v1/capabilities", "", { timestamp: String(Math.floor(Date.now() / 1000) - 600) }),
  });
if (mode === "replay") {
  const headers = sign("GET", "/v1/capabilities");
  await call("GET", "/v1/capabilities", { headers });
  await call("GET", "/v1/capabilities", { headers });
}
if (mode === "health") await call("GET", "/v1/health");
if (mode === "profile")
  await call("POST", "/v1/runs", {
    body: { instruction: "smoke", profile: "saieed", correlation: { actorId: "smoke", traceId: "smoke-profile" } },
  });
if (mode === "run") {
  const { raw } = await call("POST", "/v1/runs", {
    body: { instruction: "Reply with the single word: bridge-smoke", correlation: { actorId: "smoke", traceId: `smoke-${Date.now()}` } },
  });
  const runId = JSON.parse(raw).runId;
  const streamPath = `/v1/runs/${runId}/stream`;
  const res = await fetch(`${base}${streamPath}`, { headers: sign("GET", streamPath, "") });
  console.log(`stream -> ${res.status} content-type=${res.headers.get("content-type")} cache-control=${res.headers.get("cache-control")} x-accel-buffering=${res.headers.get("x-accel-buffering")}`);
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    const text = decoder.decode(chunk);
    process.stdout.write(text);
    if (text.includes("event: complete") || text.includes("event: error")) break;
  }
}
if (mode === "cancel") {
  const { raw } = await call("POST", "/v1/runs", {
    body: {
      instruction: "Count slowly to two hundred, one line per second, and do not stop early.",
      correlation: { actorId: "smoke", traceId: `smoke-cancel-${Date.now()}` },
    },
  });
  const runId = JSON.parse(raw).runId;
  await sleep(1500); // let session.create land so the interrupt has a target
  await call("POST", `/v1/runs/${runId}/cancel`);
  await call("GET", `/v1/runs/${runId}`);
}
```

Environment for every step: `set -a; . /etc/nexup-bridge/bridge.env; set +a` and
`export SMOKE_BASE_URL=https://<BRIDGE_HOSTNAME> SMOKE_KEY_ID=<KEY_ID>`.

| Step | Command | Expected output (observed locally) | Proves |
|---|---|---|---|
| **S1** signed request through the real path (TLS + proxy + signature) | `node /tmp/nexup-smoke.mjs capabilities` | `200`; body has `profile:"saieed"`, `pinnedProfile:true`, `operations:["health","submit","status","cancel"]`, `hermesMethods:[…]`, `excludedMethods:["llm.oneshot"]`, `lifecycleManaged:false` | Signing works end-to-end; the pinned profile is reported; no caller-supplied method exists |
| **S2** `Cache-Control: no-store` on JSON | same call, read `cache-control=` | `no-store` | `server.ts` L60 |
| **S3** unsigned request fails closed | `node /tmp/nexup-smoke.mjs unsigned` | `401` | Auth is in front of every route |
| **S4** query string rejected | `node /tmp/nexup-smoke.mjs query` | `400` with `error.code:"BAD_REQUEST"`, `message:"Query strings are not accepted by the bridge API"` | `app.ts` L312. The helper signs the path **without** the query; signing the query instead returns `401 SIGNATURE_INVALID`, which is a different and misleading signal |
| **S5** tampered signature rejected | `node /tmp/nexup-smoke.mjs tampered` | `401` with `error.code:"SIGNATURE_INVALID"`, `message:"Bridge signature did not match"` | Constant-time HMAC comparison, `signing.ts` L70–76 |
| **S6** stale timestamp rejected | `node /tmp/nexup-smoke.mjs stale` | `401` with `error.code:"REPLAY"`, `message:"Signed request timestamp is outside the acceptance window"` | The skew window is checked **before** the HMAC (`signature.ts` L52–58) |
| **S7** replayed nonce rejected | `node /tmp/nexup-smoke.mjs replay` | #1 `200`; #2 `401` with `error.code:"REPLAY"`, `message:"Bridge nonce was already used"` | The nonce is consumed **after** the HMAC, once (`signature.ts` L61–68) |
| **S8** `default` profile is never addressable | I.8, re-run now: `docker run --rm -e HERMES_PROFILE=default nexup-bridge@sha256:<DIGEST>; echo $?` | `exit=1` + `HERMES_PROFILE "default" … is unsafe or forbidden`; **no listener starts** | `assertAddressableProfile` refuses `default` at config time |
| **S9** caller-supplied profile refused | `node /tmp/nexup-smoke.mjs profile` | `403` with `error.code:"FORBIDDEN_PROFILE"`; body says the bridge pins the profile server-side | `profile-policy.ts` L26–32 |
| **S10** readiness (first Hermes contact) | `node /tmp/nexup-smoke.mjs health` | `200` with `bridge:"ok"` and `hermes:"healthy"`, `detail:"gateway.ready"`. If `gateway.ping` is unsupported instead: `200` with `hermes:"degraded"`, `detail:"gateway.ping not supported"` — **that is a NO-GO unless P2 recorded it and the operator accepts it explicitly** (§6.5) | Live Hermes reachability on loopback; **read `detail`, never the status code alone** |
| **S11** run + SSE streaming (creates a real session on `saieed`) | `node /tmp/nexup-smoke.mjs run` | submit `201` with `status:"RUNNING"`; then `stream -> 200`, `content-type=text/event-stream`, `cache-control=no-cache, no-transform`, `x-accel-buffering=no`; frames `event: delta` … ending in `event: complete` with `status:"succeeded"` | Deltas forward, the terminal frame ends the stream, compression/buffering stay off at the edge |
| **S12** cancel → `session.interrupt` | `node /tmp/nexup-smoke.mjs cancel` | `POST /v1/runs/<id>/cancel -> 200 {"status":"CANCELLED"}`, then `GET /v1/runs/<id> -> 200 {"status":"CANCELLED"}`. If the turn had already finished, cancel is a harmless no-op returning the terminal status — re-run S12 with a longer instruction | The cancel path reaches Hermes' interrupt (observed on the wire in the local stub rig as `session.interrupt {session_id:…}`) |
| **S13** audit + leak check | `docker logs nexup-bridge --tail 50 \| grep -c '"action"'` then inspect one line; and `journalctl -u nexup-bridge-supervisor -n 50 --no-pager \| grep -c "$(cat /etc/nexup-bridge/hermes-session-token)"` | JSON lines with `keyId`, `outcome`, `runId`, `profile:"saieed"`, `durationMs`; **zero** occurrences of the HMAC secret, the Hermes session token, or the prompt text — including in the supervisor journal, which must never echo the token | §7 observability; any secret in a log → §6.10 |
| **S14** nothing else moved | `ss -ltnp \| grep -E '(:9119|:4860)'` and compare `MainPID`/`ActiveEnterTimestamp` with P4 | identical to P4 | Hermes and the dashboard were untouched |

**Readiness semantics (runtime unchanged; enforced by the gate).** S10 is the
only readiness signal this deployment trusts, and its three states mean:

- **`healthy`** — Hermes answered the liveness method. Green: proceed.
- **`degraded`** — the bridge is up and reachable but Hermes did not answer the
  liveness method it was sent (`gateway.ping` unsupported or failed). The HTTP
  status is still `200`, so the status code alone must never be the gate: this is
  a **NO-GO** unless the operator records an explicit acceptance (§6.5). It is a
  different condition from `unavailable`.
- **`unavailable`** — `503`: Hermes is not reachable at all. Roll back (§6.6).

**Allowlist refusal of a non-approved method and `llm.oneshot`.** These are not
reachable through the HTTP surface — that is the invariant, not a gap, so there is
no HTTP probe for them. The deployment-time evidence is (a) the guard is present
*in the shipped bundle* (P0.2 grep), (b) S1 lists `llm.oneshot` under
`excludedMethods` and omits it from `hermesMethods`, and (c) the guard suite is
green on the same commit:

```bash
# in the image, not on the host (the host has no bundle and no Node)
docker run --rm --entrypoint /bin/sh nexup-bridge@sha256:<DIGEST> \
  -c "grep -c 'is not permitted by the NEXUP bridge' /app/dist/main.js"   # >= 1
npx vitest run tests/method-guard.test.ts -t "llm.oneshot"                # green (build machine)
```

In the local stub rig the outbound wire carried only `gateway.ping`,
`session.create`, `prompt.submit` and `session.interrupt` across every test above
— `llm.oneshot` never appeared once. A caller-supplied `method` field is ignored
today (strict rejection is §8 L10); it can never become the emitted method,
because the method plan is derived in code from the shared protocol.

**Smoke gate:** S1–S14 all as expected, or a recorded, understood deviation. Any
unexpected status/code → §6.

---

## 5. ROLLBACK

Fastest first. R.1 and R.2 need no VPS access at all.

- **R.1 (≈1 min, no host change) — Vercel kill switch.** Restore the recorded
  previous value of `HERMES_RUNTIME_TRANSPORT` (or remove the bridge variables)
  and redeploy. `resolveHermesConfig` then fails closed and the runtime is not
  registered; workforce jobs report the runtime as unavailable. **This is the
  primary rollback and it does not touch the VPS.**
- **R.2 (≈1 min) — withdraw the route, keep everything alive.** Stop only the
  bridge container: `docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml stop`.
  The serve keeps running and Hermes is untouched; without the route there is no
  reachable bridge at all. (Strictly better than stopping the supervisor, which
  would also take the serve down.)
- **R.3 — restore the previous image.** Re-pin `NEXUP_BRIDGE_IMAGE` in
  `/etc/nexup-bridge/deploy.env` — the ONE place the identity is written — to the
  previously deployed digest (it is still in the local image store) and
  re-apply:
  ```bash
  install -o root -g root -m 0600 \
    /etc/nexup-bridge/deploy.env /etc/nexup-bridge/deploy.env.pre-<DATE>
  # edit NEXUP_BRIDGE_IMAGE=…@sha256:<PREVIOUS> in /etc/nexup-bridge/deploy.env
  set -a; . /etc/nexup-bridge/deploy.env; set +a
  docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml up -d
  docker image inspect --format '{{index .RepoDigests 0}}' "$NEXUP_BRIDGE_IMAGE"
  # the reverted identity must be the one the pre-flight then confirms (P0.5b)
  docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml config | grep '^ *image:'
  ```
  There is no copy of the digest in the compose file to revert as well: if the
  two ever disagree, the definition is the wrong one to edit.
  No previous digest → `systemctl disable --now nexup-bridge-supervisor` and stay
  on R.1.
- **R.4 — restore the previous env.** `install -o root -g root -m 0600 /etc/nexup-bridge/bridge.env.bak-<DATE> /etc/nexup-bridge/bridge.env`
  then `docker compose -f /opt/nexup-bridge/docker-compose.bridge.yml up -d` (an
  `env_file` change needs a container re-create, not a restart).
- **R.5 — withdraw the edge (E9).** Remove the bridge service from the definition
  (or `docker compose ... down`), so the router and its certificate are no longer
  referenced. If a certificate was issued for `<BRIDGE_HOSTNAME>`, leave it; it is
  harmless. Traefik itself is **not** restarted at any point.
- **R.6 — confirm the blast radius was zero.**
  ```bash
  ss -ltnp | grep -E '(:9119|:4860)'                       # same as P4
  systemctl show -p MainPID -p ActiveEnterTimestamp <DASHBOARD_UNIT>   # same as P4
  grep -rn "default" /etc/nexup-bridge/bridge.env          # expected: no output
  ```
  *Expected:* Hermes on `127.0.0.1:9119` only, dashboard PID/start time unchanged,
  the string `default` appears nowhere in the bridge configuration.
- **No data rollback exists or is needed.** The bridge holds no database, performs
  no migration and writes no files (`ProtectSystem=strict`); the app's Prisma
  schema is untouched by this deployment. Nonce/rate-limit state is in memory and
  disappears with the process (§8 L1).

---

## 6. ABORT CRITERIA

Stop and roll back if any of these occur. **Every criterion names the step that
detects it** — there is no criterion that rests on an unperformed check.

| # | Stop if | Detected by | Then |
|---|---|---|---|
| 1 | Hermes or the bridge is reachable on a non-loopback address, or `0.0.0.0:9220` / `[::]:9220` appears | **S14** (with **P0.6** for the bind refusal) | R.2, then R.1 |
| 2 | Anything about the dashboard on **port 4860** differs from the P4 capture — PID, start time or health | **S14** vs **P4** | R.1. Do not touch 4860 |
| 3 | Any step would need to use, restart or inspect profile `default`, or `default` would have to be written into a file | **S8**, **S9**, **P1.5** | Stop; nothing to roll back |
| 4 | The digest on the host does not match the recorded build digest | **§2** post-copy compare (**P0.2**) | Re-copy; if it still differs, R.2 then R.1 |
| 5 | **P2 FAIL**, or **S10** reports `hermes:"degraded"` without a recorded, explicitly accepted reason | **P2**, **S10** | R.1 — leave the transport off rather than trade on a false-green readiness signal |
| 6 | **S10** returns `503`, or `hermes:"unavailable"` persists | **S10** | R.2 then R.1 |
| 7 | A request that should succeed is refused — **S1** not `200` with a fresh clock — and the cause is not identified within 10 minutes (key-id mismatch **P1.4**, wrong secret, host clock **P1.6**) | **S1** with **P1.4**/**P1.6**, contrasted with **S6** | R.1 |
| 8 | The perimeter does not reject as documented: **S3** returns `200`, **S4** does not return `400`, or **S5**/**S6**/**S7** return `200` where they must not | **S3**, **S4**, **S5**, **S6**, **S7** | R.1 immediately. A `200` on **S3** is the most severe outcome in this runbook |
| 9 | **S12** does not return `200`/`CANCELLED`, or the Hermes session keeps running after the stream is closed | **S12** (with **S11** for the stream close) | R.1 |
| 10 | Any secret value appears in `journalctl`, a terminal scrollback, a ticket or a screenshot | **S13**, **P1.2** | R.1, then rotate the secret; assume it is compromised |
| 11 | The window is closing with **S1–S14** unfinished | The **§4** smoke gate | R.1 rather than leaving a half-verified transport enabled |
| 12 | The operator is unsure whether a step is safe | Any step of **S1–S14** (the gate itself is the backstop) | Stop. The bridge is optional; the cost of stopping is zero and the cost of guessing is not |

---

## 7. INVARIANT → EVIDENCE MAP (what the deployment is allowed to claim)

Verified by reading the code, not by running it. Use this when writing the change
record so the write-up does not over-claim.

| Invariant | Where |
|---|---|
| HMAC-SHA256, single canonical implementation for both sides | `src/modules/workforce/bridge/signing.ts` L52–79 (canonical string L57, HMAC L62, verify L79); constant-time compare L70–76 |
| Timestamp / skew window | `bridge/src/auth/signature.ts` L52–58; `bridge/src/config.ts` L180 |
| Nonce single-use, consumed **after** HMAC | `signature.ts` L61–68; `bridge/src/auth/nonce-store.ts` |
| Pre-auth rate limit before any HMAC work | `bridge/src/auth/pre-auth-guard.ts`; `bridge/src/api/app.ts` L274 |
| Per-key rate limit after auth | `bridge/src/auth/rate-limit.ts`; `app.ts` L316 |
| Bounded request body | `bridge/src/server.ts` L19–45; `config.ts`; **the bridge is the only cap** (no edge body limit exists — §8 L11) |
| Pinned profile, re-checked per request | `config.ts` L146–152; `hermes-config.ts` L108–135; both transports |
| `default` forbidden | `hermes-config.ts` L114, L133; `config.ts` L149–152 |
| No generic RPC, no query strings | `app.ts` L261, L312 |
| Method allowlist **on the outbound path** | `bridge/src/hermes/allowlist.ts`; `method-guard.ts` L85–101; `client.ts` L61–79 |
| `llm.oneshot` excluded | `allowlist.ts` L28 |
| Loopback-only bind by default; off-loopback only with an explicit opt-in **and** a named, non-loopback edge boundary | `config.ts` (`NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND`, `NEXUP_BRIDGE_TRUSTED_PROXIES`, `NEXUP_BRIDGE_CLIENT_IP_HEADER`) |
| Loopback-only Hermes URL | `config.ts` L129 |
| `no-store` / SSE `no-cache, no-transform` + `x-accel-buffering: no` | `server.ts` L60, L108, L110 |
| Edge: no response buffering (SSE), HSTS/nosniff/Referrer-Policy | `bridge/deploy/docker-compose.bridge.yml` labels; tool P0.7b |
| Client address: rightmost edge-appended `X-Forwarded-For` entry, trusted proxies as CIDR | `bridge/src/auth/client-identity.ts` |
| Fixed session token, never in argv or logs; serve lifecycle and bridge re-parenting owned outside Hermes | `bridge/deploy/nexup-bridge-supervisor.sh`; tool P3.5 |
| Nothing published on the host: no `ports:`, no `:9220`/`:9119` listener | `docker-compose.bridge.yml`; tool P0.5a, P4.1, P4.2 |
| Secret redaction (logs, audit, wire) | `bridge/src/redaction.ts`; `main.ts` L41–44; `app.ts` L291, L355 |
| Audit line per request and per run | `app.ts` L277 (pre-auth denial), L322 (allowed), L344 (denied); `run-manager.ts` `finalize` |
| Container hardening (non-root uid, `read_only`, `cap_drop: [ALL]`, no-new-privileges, dropped service user) | `bridge/deploy/Dockerfile`; `docker-compose.bridge.yml`; tool P0.5b |
| Supervisor unit hardening (non-root-capable, `ProtectSystem=strict`, no caps) | `bridge/deploy/systemd/nexup-bridge-supervisor.service` |

---

## 8. KNOWN-ACCEPTED LIMITATIONS (do not re-litigate these in the window)

| # | Limitation | Why it is accepted |
|---|---|---|
| L1 | Nonce/rate-limit state is process-local, so a restart inside the 300 s window re-permits one replayed request | Restart is not attacker-triggerable (`Restart=on-failure` only, no exposed control); bounded by the skew window |
| L2 | Metrics exist only in memory — **there is no `/metrics` HTTP route** (`metrics.ts` has `renderPrometheus`, nothing registers it) | Observability in the window is `journalctl` + the audit lines; do not promise a metrics endpoint |
| L3 | Client identity now depends on Traefik's `X-Forwarded-For` semantics: the bridge takes the **rightmost** entry and believes it only from `NEXUP_BRIDGE_TRUSTED_PROXIES` (here `172.16.0.0/16`, the Docker network the namespace lives on). A peer that is not trusted, a repeated header, or a malformed value degrades to the socket address | The rightmost entry is the one Traefik appended, so a caller-prepended address cannot mint a fresh pre-auth bucket; the fallback is a real per-peer bucket, never a shared or unbounded one. The boundary is a NETWORK because Docker renumbers it on every recreation; **P1.8** + **P3.1** cover both halves. E4 is settled in code and tested locally; the live header shape is re-measured at the RECOVERY VERIFIED checkpoint |
| L4 | No test asserts that a live pre-auth bucket survives cap eviction | Bounded (10 k) and low impact; captured as hardening debt |
| L5 | HMAC secrets between 16 and 63 chars are accepted by the code | Pre-flight P1.3 imposes the real policy; a startup minimum is a code change for later |
| L6 | Neither unit sets seccomp / `SystemCallFilter`; the container relies on `cap_drop: [ALL]`, `read_only`, `no-new-privileges` and a non-root uid | The bundle contains no `node:child_process` (verified: the import is tree-shaken out) and nothing on the request path can spawn; a seccomp profile is hardening debt, not a deployment blocker |
| L7 | `boundText` truncates by characters, not bytes | Mitigated by keeping `MAX_OUTPUT_BYTES` sane and confirming S11 |
| L8 | Audit lines go to journald with no rotation/integrity policy | Operational item, not a deployment blocker |
| L9 | Hermes session token travels in the WebSocket URL query (Hermes' own auth mechanism) | Bridge-side redaction cannot cover Hermes' logs; the token never leaves the shared namespace, and the supervisor passes it to the serve process by variable NAME so it never enters any argv |
| L10 | Unknown request-body fields are ignored rather than rejected (`profile` is the exception and is rejected) | Contract-safe: no caller-supplied field can become the emitted method or the addressed profile, and the method plan is derived in code; strict schema rejection is hardening debt, not a gate item |
| L11 | **There is no request-body cap at the edge.** Traefik core cannot limit a body without a plugin, and the only built-in that can (`buffering`) must not be used here because it would buffer the SSE run stream | The bridge caps every body at `NEXUP_BRIDGE_MAX_BODY_BYTES=262144` and answers `413` before doing any work, and **P1.1** gates that exact value. A larger cap is a deliberate change, never a drift |
| L12 | Recreating the Hermes container breaks the bridge until the supervisor reconciles (default interval 10 s), and the serve endpoint is briefly absent | Measured, expected behaviour of a shared namespace; the supervisor is idempotent and re-creates the bridge through the compose file (P3.5, P4.11), and recovery is re-verified at the RECOVERY VERIFIED checkpoint |

---

## 9. DO-NOT

1. **Do not expose Hermes publicly.** No port-forward, no `0.0.0.0` bind, no
   second proxy path. Hermes stays on `127.0.0.1:9119`.
2. **Never publish the bridge.** The definition has no `ports:`; the off-loopback
   bind inside the shared namespace is the only override, and it exists solely so
   Traefik can reach the bridge at the owner's address. Only Traefik may own
   `:80`/`:443`, and nothing may publish `:9220` or `:9119`.
3. **Profile `saieed` only.** Exactly one profile is addressed, pinned at
   configuration time, and a caller-supplied profile is rejected.
4. **`default` is Adel's profile.** Never use it, never modify it, never restart
   it, never inspect it destructively. Do not write the string into any bridge
   file. The code refuses it; the operator must too.
5. **Never touch the managed Hermes deployment.** No edit to
   `/docker/hermes-agent-r3j1/docker-compose.yml`, no image change, no
   `docker restart` of the Hermes container, no change to port 4860 or the
   dashboard. The supervisor starts and probes the `saieed` serve; that is all.
6. **No secrets in git — ever.** Not in a commit, a diff, a screenshot, a ticket
   or a chat. The env example carries placeholders only. Verify any paste before
   sending it.
7. **No database migration, no Prisma change, no Supabase/DB contact.** The
   bridge has no database; this deployment must not introduce one.
8. **No `npm install` or toolchain change on the VPS.** There is no Node on the
   host: the bundle runs inside the image, and the image is built from the
   already-built bundle.
9. **No Hermes lifecycle management by the bridge.** The bridge only connects.
   The ONLY process allowed to start the `saieed` serve is the operator-owned
   supervisor, and it may only start it — never stop it, never reconfigure it,
   never address `default`.
10. **No generic RPC, no caller-supplied method or profile, no shell execution.**
    If a task seems to need one, it is out of scope.
11. **Do not enable the bridge for production traffic** (`systemctl enable`,
    Vercel flip) before §4 smoke passes.
12. **Do not leave `/tmp/nexup-smoke.mjs` or a shell session holding sourced
    secrets** after the window: `rm -f /tmp/nexup-smoke.mjs`, close the shell.
