# NEXUP VPS Bridge — Deployment Package & Runbook (Step 2/8)

**Status:** readiness artifact. Nothing in this document has been executed against
the VPS. It is the script for a supervised deployment window.

**Companion documents** (do not duplicate, read alongside):

- [`docs/NEXUP_VPS_BRIDGE.md`](./NEXUP_VPS_BRIDGE.md) — architecture, endpoint
  contract, auth model, error model, non-goals.
- `bridge/README.md` — build/test commands.

**Relationship to the code.** Every step below is derived from the artifacts on
disk: `bridge/`, `bridge/deploy/Caddyfile`, `bridge/systemd/nexup-bridge.service`,
`bridge/deploy/nexup-bridge.env.example`, and
`src/modules/workforce/bridge/signing.ts`. Where the code does **not** back a
promise, this runbook says so and gives a check instead of an assertion. Anything
the operator cannot verify is listed under
[§8 Known-accepted limitations](#8-known-accepted-limitations-do-not-relitigate-these-in-the-window).

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
| Bridge binds `127.0.0.1:9220`, loopback only, no override | `bridge/src/config.ts` L157–162; `bridge/src/main.ts` L86 | P0.6 |
| Hermes is reached at `ws://127.0.0.1:9119/api/ws`, profile pinned `saieed` | `bridge/src/config.ts` L123–152 | P1.4, P1.5 |
| Bridge serves only `/v1/*`; no generic RPC, no query strings | `bridge/src/api/app.ts` L261, L312 | S3, S6 |
| The shipped unit runs `/opt/nexup-bridge/dist/main.js` as user `nexup-bridge` | `bridge/systemd/nexup-bridge.service` | P0.5 |
| Caddy terminates TLS and proxies to loopback; no compression, `flush_interval -1` | `bridge/deploy/Caddyfile` | P0.7 |
| The bridge never starts, stops or reconfigures Hermes | `bridge/src/main.ts` (no lifecycle calls anywhere) | S14 (Hermes and the dashboard unchanged) |

---

## 1. PRE-FLIGHT

Run all of P0–P4 on the build machine and on the VPS. **Every check has a stated
pass signal. Do not proceed on a warning.**

### P0. Workspace, build and artifact integrity

```bash
cd <REPO_ROOT>/nexup-business-system/bridge
git -C <REPO_ROOT> rev-parse HEAD                 # record this SHA in the change record
git -C <REPO_ROOT> status --porcelain             # pass: no unexpected modifications
node --version                                    # pass: v22.x (bundle target is node22)
npx tsc -p tsconfig.json --noEmit                 # pass: no output, exit 0
npx vitest run --config vitest.config.ts          # pass: every suite green
npm run build                                     # pass: exit 0, esbuild is silent on success
sha256sum dist/main.js                            # record the digest
```

- **P0.1 Fail signal:** typecheck or any bridge test fails → stop. The method
  guard is proven by `tests/method-guard.test.ts`; a red suite means the
  compile-time allowlist guarantee is not evidenced for this commit.
- **P0.2 Do not ship a pre-existing bundle.** `dist/` is gitignored
  (`bridge/.gitignore`), so any `dist/main.js` already on disk was built at an
  unknown time. Rebuild from the recorded SHA and treat the **pre-existing**
  digest as invalid. As an integrity probe, confirm the guard survived bundling:

  ```bash
  grep -c "is not permitted by the NEXUP bridge" dist/main.js   # pass: >= 1
  ```

  A local rebuild from a clean tree reproduced the on-disk digest byte for byte,
  so the digest is a usable identity for the artifact: record it here and compare
  it again after the copy in §2.
- **P0.3 Toolchain availability.** `bridge/` has no `node_modules` of its own; the
  build and tests resolve `esbuild`/`vitest` from the repository root
  (`npx --no-install esbuild --version` → `0.28.2` locally). Run P0 from a full
  checkout, or `npm i` at the repo root first.
- **P0.4 VPS needs no package manager.** The bundle is self-contained CommonJS;
  the VPS needs only `/usr/bin/node` ≥ 22. Do not `npm install` on the VPS.
- **P0.5 Unit paths.** The systemd unit sets
  `WorkingDirectory=/opt/nexup-bridge` and
  `ExecStart=/usr/bin/node /opt/nexup-bridge/dist/main.js`. The artifact must
  therefore land at `/opt/nexup-bridge/dist/main.js`. (Note: the short runbook in
  `docs/NEXUP_VPS_BRIDGE.md` §10 copies to `/opt/nexup-bridge/` — that path is
  stale; this document is authoritative.)
- **P0.6 Loopback-only bind is enforced in code, with no override:** a
  non-loopback `NEXUP_BRIDGE_HOST` returns `enabled:false`. Prove it on the host
  before deploying (this starts **no** listener — it exits before `listen`):

  ```bash
  set -a; . /etc/nexup-bridge/bridge.env; set +a
  NEXUP_BRIDGE_HOST=0.0.0.0 node dist/main.js; echo "exit=$?"
  # pass: exit=1 and stderr: NEXUP_BRIDGE_HOST must be loopback (the bridge is not published directly)
  ```
- **P0.7 Caddy version.** The Caddyfile uses `request_body { max_size 256KB }`,
  which requires **Caddy ≥ 2.10**.

  ```bash
  caddy version            # pass: v2.10 or later
  caddy validate --config /etc/caddy/Caddyfile   # pass: "Valid configuration"
  ```
  **Fail signal:** unknown directive `request_body` → the edge body cap is not
  applied; upgrade Caddy or lower `NEXUP_BRIDGE_MAX_BODY_BYTES` and accept that
  the edge cap is absent. Do not silently drop the line.

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

- **P1.1 `NEXUP_BRIDGE_MAX_BODY_BYTES` is read by the code but is absent from
  the example env file** (audit gap 9). If it is unset the default is 262 144 B,
  which matches Caddy's `max_size 256KB`. **Pass signal:** either the variable is
  set to 262144, or the operator records "default in use". Any other value must be
  reconciled with Caddy or the larger body is silently truncated at the edge.
- **P1.2 File permissions.** The example documents `chmod 600` only in a comment;
  nothing enforces it:

  ```bash
  stat -c '%a %U:%G' /etc/nexup-bridge/bridge.env   # pass: 600 nexup-bridge:nexup-bridge
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
| P3.1 | **Proxy-collapsed client identity.** `bridge/src/server.ts` L89 takes `remote` from `req.socket.remoteAddress`, so behind Caddy every request is `127.0.0.1`: the pre-auth "per-remote" bucket is effectively one global bucket, and audit `remote` is the proxy | `grep -n "remoteAddress\|x-forwarded" bridge/src/server.ts` | **Expected: only the socket line, no `x-forwarded`.** Treat as *confirmed by design*. Pass only if the operator records this as accepted behaviour (§8 L3) and understands the pre-auth budget is shared (120/min total, not per client). A fix means trusting a proxy-set header that the edge **overwrites** — do not do that in the window |
| P3.2 | **Weak-secret acceptance.** `config.ts` L116 refuses only `< 16` chars | P1.3 (`length >= 64`) | **Pass:** ≥ 64 chars of hex from a CSPRNG. Fail → regenerate before install |
| P3.3 | **Pre-auth sweep order.** The *nonce store* order is correct (insertion == expiry). The caveat is `PreAuthGuard`: `sweepBuckets` breaks on the first live bucket while `consumeBucket` does not refresh insertion order, so stale buckets linger until the 10 k cap, and cap eviction can drop a live bucket — resetting that remote's budget | `npx vitest run tests/security.test.ts -t "refills over time and keeps its bucket state bounded"` | **Pass (accepted):** suite is green today. There is **no** test asserting a hot bucket survives eviction — record that as a known low-severity gap (§8 L4). No host action |
| P3.4 | **Byte-vs-character truncation.** `boundText` slices by characters (`hermes-spawn.ts` L23–26), so a multi-byte payload can exceed `NEXUP_BRIDGE_MAX_OUTPUT_BYTES` by up to ~4× | `grep -n "slice(0, maxBytes)" src/modules/workforce/runtimes/hermes/hermes-spawn.ts` | **Pass (accepted):** the line is character-based. Mitigation in the window: keep `NEXUP_BRIDGE_MAX_OUTPUT_BYTES=262144` (1 MB worst case) and confirm the run with the largest expected output succeeds in S11. No code change in the window |

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
```

- **Read-only.** It only runs `node --version`, `caddy version`, `caddy validate`,
  `ss`, `stat`, `df`, `sha256sum`, `command -v`, `id`, `date`, `systemctl show`,
  and — only with `--exec-probes` — one `node …/main.js` run that exits before
  `listen`. Nothing is started, stopped, written or configured.
- **Exit codes:** `0` PASS · `1` NO-GO · `2` usage error. The verdict
  (`PREFLIGHT: PASS|FAIL`, `HERMES-COMPAT: PASS|FAIL`) is the last line.
- **Fail closed.** A safety check that cannot run is a NO-GO, not a pass: omitting
  `--exec-probes` leaves P0.6 *could-not-run* and the whole run FAILs.
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

### Pre-flight gate

Proceed to install only if P0, P1, P2 (PASS or recorded DEGRADE), P3 (all four
recorded) and P4 are complete. Any FAIL → stop (§6).

---

## 2. ARTIFACTS

| Artifact | Source on the build machine | Destination on the VPS | Copy how |
|---|---|---|---|
| Bridge bundle | `bridge/dist/main.js` (built in P0) | `/opt/nexup-bridge/dist/main.js` | `scp`, digest compared after copy |
| systemd unit | `bridge/systemd/nexup-bridge.service` | `/etc/systemd/system/nexup-bridge.service` | `scp`, then `daemon-reload` |
| Caddy site | `bridge/deploy/Caddyfile` | merged into `/etc/caddy/Caddyfile` (or `/etc/caddy/conf.d/nexup-bridge.caddy`) | `scp` + `caddy validate` |
| Env template | `bridge/deploy/nexup-bridge.env.example` | `/etc/nexup-bridge/bridge.env` | **created on the host** from the example; the secret is generated on the host and never leaves it |
| Hermes session token | Hermes host configuration (`HERMES_DASHBOARD_SESSION_TOKEN`) | mirrored into `bridge.env` | typed by the operator; never printed |

```bash
sha256sum bridge/dist/main.js                          # local digest, recorded in P0
scp bridge/dist/main.js <VPS_HOST>:/tmp/main.js.upload
ssh <VPS_HOST> 'install -o root -g root -m 0755 /tmp/main.js.upload /opt/nexup-bridge/dist/main.js && rm /tmp/main.js.upload'
ssh <VPS_HOST> 'sha256sum /opt/nexup-bridge/dist/main.js'   # must equal the local digest
```

- **Pass signal:** the two digests are byte-identical.
- **Mismatch → stop.** Do not start a service from an unverified artifact.
- Keep the previous bundle as `/opt/nexup-bridge/dist/main.js.prev` (rollback R.3).
- Nothing in `dist/` is committed (`bridge/.gitignore`), and the Vercel app never
  bundles the bridge: the VPS copy is the only deployment of it.

---

## 3. INSTALL / ENABLE

Ordered. **Do not enable the unit before the smoke test passes** (I.9), and do not
flip Vercel until the bridge is proven (I.10). Each step lists its expected output.

1. **Create the service user** (idempotent):
   ```bash
   id nexup-bridge || useradd --system --no-create-home --shell /usr/sbin/nologin nexup-bridge
   ```
   *Expected:* `uid=… (nexup-bridge) gid=…` on the second run.
2. **Directories:** `install -d -o root -g root -m 0755 /opt/nexup-bridge/dist /etc/nexup-bridge`
   *Expected:* no output.
3. **Bundle** in place with the digest verified (§2). *Expected:* matching sha256.
4. **Env file:** `install -o nexup-bridge -g nexup-bridge -m 0600 /etc/nexup-bridge/bridge.env.example /etc/nexup-bridge/bridge.env`, then edit in place to fill the two secrets and confirm P1 values. *Expected:* later `stat` shows `600 nexup-bridge:nexup-bridge`.
5. **Unit:** `install -m 0644 bridge/systemd/nexup-bridge.service /etc/systemd/system/nexup-bridge.service && systemctl daemon-reload` *Expected:* no output.
6. **Pre-start sanity, without listening.** With the env sourced:
   ```bash
   set -a; . /etc/nexup-bridge/bridge.env; set +a
   HERMES_PROFILE=default node /opt/nexup-bridge/dist/main.js; echo "exit=$?"
   ```
   *Expected:* `exit=1` and stderr `[nexup-bridge] disabled: HERMES_PROFILE "default" is unsafe or forbidden (default is never addressable)`. This is the proof that the `default` profile cannot be addressed — it never reaches `listen`. (Also covered in S5.)
7. **Start:** `systemctl start nexup-bridge`
   *Expected:* `systemctl is-active nexup-bridge` → `active`.
8. **Verify what it bound and whom it serves:**
   ```bash
   systemctl status nexup-bridge --no-pager | head -15
   journalctl -u nexup-bridge -n 20 --no-pager
   ss -ltnp | grep 9220
   ```
   *Expected:* one JSON log line `"msg":"bridge listening"` with
   `host:"127.0.0.1"`, `port:9220`, `profile:"saieed"`; `ss` shows
   `127.0.0.1:9220` **only**.
   *Fail signal:* any `0.0.0.0:9220` / `[::]:9220` → stop now (§6).
9. **Enable:** `systemctl enable nexup-bridge` (only after §4 smoke passes)
   *Expected:* symlink created in `multi-user.target.wants`.
10. **Publish the edge:** place the Caddy site, `caddy validate --config /etc/caddy/Caddyfile`,
    `systemctl reload caddy`.
    *Expected:* `Valid configuration`; `systemctl is-active caddy` → `active`.
    **Test reachability unsigned — this must fail closed:**
    ```bash
    curl -sS -o /dev/null -w '%{http_code}\n' https://<BRIDGE_HOSTNAME>/v1/health
    ```
    *Expected:* `401` (re-checked as **S3**). A `200` means the auth path is not in
    front of the route — stop immediately.
11. **Flip Vercel (last):** set the five variables from P1.7 in the production
    environment and redeploy. *Expected:* the app's workforce health endpoint
    reports the runtime as configured with transport `BRIDGE` and profile
    `saieed`. Keep the previous value of `HERMES_RUNTIME_TRANSPORT` recorded —
    it is rollback R.1.
12. **Disable the build machine's stale bundle from the record:** not applicable;
    just note that only the digest from §2 is deployed.

---

## 4. SMOKE TEST

**These steps were executed locally** in this order against the **compiled
bundle**, with a stub Hermes JSON-RPC endpoint on loopback. Every “Expected
output” below is an observation from that run, not a prediction. One hop the rig
could not cover: TLS and the Caddy proxy, because it spoke plain HTTP to
`127.0.0.1` — so S1 proves the proxy path only once it runs against
`https://<BRIDGE_HOSTNAME>`.

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
| **S8** `default` profile is never addressable | I.6, re-run now: `HERMES_PROFILE=default node /opt/nexup-bridge/dist/main.js; echo $?` | `exit=1` + `HERMES_PROFILE "default" … is unsafe or forbidden`; **no listener starts** | `assertAddressableProfile` refuses `default` at config time |
| **S9** caller-supplied profile refused | `node /tmp/nexup-smoke.mjs profile` | `403` with `error.code:"FORBIDDEN_PROFILE"`; body says the bridge pins the profile server-side | `profile-policy.ts` L26–32 |
| **S10** readiness (first Hermes contact) | `node /tmp/nexup-smoke.mjs health` | `200` with `bridge:"ok"` and `hermes:"healthy"`, `detail:"gateway.ready"`. If `gateway.ping` is unsupported instead: `200` with `hermes:"degraded"`, `detail:"gateway.ping not supported"` — **that is a NO-GO unless P2 recorded it and the operator accepts it explicitly** (§6.5) | Live Hermes reachability on loopback; **read `detail`, never the status code alone** |
| **S11** run + SSE streaming (creates a real session on `saieed`) | `node /tmp/nexup-smoke.mjs run` | submit `201` with `status:"RUNNING"`; then `stream -> 200`, `content-type=text/event-stream`, `cache-control=no-cache, no-transform`, `x-accel-buffering=no`; frames `event: delta` … ending in `event: complete` with `status:"succeeded"` | Deltas forward, the terminal frame ends the stream, compression/buffering stay off at the edge |
| **S12** cancel → `session.interrupt` | `node /tmp/nexup-smoke.mjs cancel` | `POST /v1/runs/<id>/cancel -> 200 {"status":"CANCELLED"}`, then `GET /v1/runs/<id> -> 200 {"status":"CANCELLED"}`. If the turn had already finished, cancel is a harmless no-op returning the terminal status — re-run S12 with a longer instruction | The cancel path reaches Hermes' interrupt (observed on the wire in the local stub rig as `session.interrupt {session_id:…}`) |
| **S13** audit + leak check | `journalctl -u nexup-bridge -n 50 --no-pager \| grep -c '"action"'` then inspect one line | JSON lines with `keyId`, `outcome`, `runId`, `profile:"saieed"`, `durationMs`; **zero** occurrences of the HMAC secret, the Hermes session token, or the prompt text | §7 observability; any secret in the log → §6.10 |
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
grep -c "is not permitted by the NEXUP bridge" /opt/nexup-bridge/dist/main.js  # >= 1
npx vitest run tests/method-guard.test.ts -t "llm.oneshot"                     # green
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
- **R.2 (≈1 min) — stop the bridge.** `systemctl stop nexup-bridge`. Hermes is a
  separate process that the bridge never manages; stopping the bridge cannot
  affect it.
- **R.3 — restore the previous bundle.**
  ```bash
  install -o root -g root -m 0755 /opt/nexup-bridge/dist/main.js.prev /opt/nexup-bridge/dist/main.js
  sha256sum /opt/nexup-bridge/dist/main.js      # must equal the digest recorded in P4
  systemctl start nexup-bridge
  ```
  No bundle history → `systemctl disable --now nexup-bridge` and stay on R.1.
- **R.4 — restore the previous env.** `install -o nexup-bridge -g nexup-bridge -m 0600 /etc/nexup-bridge/bridge.env.bak-<DATE> /etc/nexup-bridge/bridge.env` then `systemctl restart nexup-bridge`.
- **R.5 — withdraw the edge.** Remove the Caddy site block, `caddy validate`, `systemctl reload caddy`. If a certificate was issued for `<BRIDGE_HOSTNAME>`, leave it; it is harmless.
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
| Bounded request body | `bridge/src/server.ts` L19–45; `config.ts` L181; Caddyfile `request_body 256KB` |
| Pinned profile, re-checked per request | `config.ts` L146–152; `hermes-config.ts` L108–135; both transports |
| `default` forbidden | `hermes-config.ts` L114, L133; `config.ts` L149–152 |
| No generic RPC, no query strings | `app.ts` L261, L312 |
| Method allowlist **on the outbound path** | `bridge/src/hermes/allowlist.ts`; `method-guard.ts` L85–101; `client.ts` L61–79 |
| `llm.oneshot` excluded | `allowlist.ts` L28 |
| Loopback-only bind, no override | `config.ts` L157–162 |
| Loopback-only Hermes URL | `config.ts` L129 |
| `no-store` / SSE `no-cache, no-transform` + `x-accel-buffering: no` | `server.ts` L60, L108, L110 |
| Edge: no compression, `flush_interval -1`, HSTS/nosniff | `bridge/deploy/Caddyfile` |
| Secret redaction (logs, audit, wire) | `bridge/src/redaction.ts`; `main.ts` L41–44; `app.ts` L291, L355 |
| Audit line per request and per run | `app.ts` L277 (pre-auth denial), L322 (allowed), L344 (denied); `run-manager.ts` `finalize` |
| Unit hardening (non-root, `ProtectSystem=strict`, no caps) | `bridge/systemd/nexup-bridge.service` |

---

## 8. KNOWN-ACCEPTED LIMITATIONS (do not re-litigate these in the window)

| # | Limitation | Why it is accepted |
|---|---|---|
| L1 | Nonce/rate-limit state is process-local, so a restart inside the 300 s window re-permits one replayed request | Restart is not attacker-triggerable (`Restart=on-failure` only, no exposed control); bounded by the skew window |
| L2 | Metrics exist only in memory — **there is no `/metrics` HTTP route** (`metrics.ts` has `renderPrometheus`, nothing registers it) | Observability in the window is `journalctl` + the audit lines; do not promise a metrics endpoint |
| L3 | Behind Caddy the bridge sees `127.0.0.1` as the client, so pre-auth limits are shared and audit `remote` is the proxy | Fixing it means trusting a forwarded header and proving the edge overwrites it — out of scope for the window |
| L4 | No test asserts that a live pre-auth bucket survives cap eviction | Bounded (10 k) and low impact; captured as hardening debt |
| L5 | HMAC secrets between 16 and 63 chars are accepted by the code | Pre-flight P1.3 imposes the real policy; a startup minimum is a code change for later |
| L6 | The unit sets no seccomp / `SystemCallFilter` | The bundle contains no `node:child_process` (verified: the import is tree-shaken out) and nothing on the request path can spawn; container-level hardening would be the next step, not a deployment blocker |
| L7 | `boundText` truncates by characters, not bytes | Mitigated by keeping `MAX_OUTPUT_BYTES` sane and confirming S11 |
| L8 | Audit lines go to journald with no rotation/integrity policy | Operational item, not a deployment blocker |
| L9 | Hermes session token travels in the WebSocket URL query (Hermes' own auth mechanism) | Bridge-side redaction cannot cover Hermes' logs; the token never leaves loopback |
| L10 | Unknown request-body fields are ignored rather than rejected (`profile` is the exception and is rejected) | Contract-safe: no caller-supplied field can become the emitted method or the addressed profile, and the method plan is derived in code; strict schema rejection is hardening debt, not a gate item |

---

## 9. DO-NOT

1. **Do not expose Hermes publicly.** No port-forward, no `0.0.0.0` bind, no
   second proxy path. Hermes stays on `127.0.0.1:9119`.
2. **Loopback only** for the bridge: `NEXUP_BRIDGE_HOST` must be `127.0.0.1`
   (the code refuses anything else) and only Caddy may publish `:443`.
3. **Profile `saieed` only.** Exactly one profile is addressed, pinned at
   configuration time, and a caller-supplied profile is rejected.
4. **`default` is Adel's profile.** Never use it, never modify it, never restart
   it, never inspect it destructively. Do not write the string into any bridge
   file. The code refuses it; the operator must too.
5. **Never touch the existing Hermes/dashboard process or port 4860.** No
   `systemctl restart` of it, no config edit, no version change.
6. **No secrets in git — ever.** Not in a commit, a diff, a screenshot, a ticket
   or a chat. The env example carries placeholders only. Verify any paste before
   sending it.
7. **No database migration, no Prisma change, no Supabase/DB contact.** The
   bridge has no database; this deployment must not introduce one.
8. **No `npm install` or toolchain change on the VPS.** Ship the built bundle.
9. **No Hermes lifecycle management.** The bridge only connects; it never starts,
   stops or reconfigures Hermes.
10. **No generic RPC, no caller-supplied method or profile, no shell execution.**
    If a task seems to need one, it is out of scope.
11. **Do not enable the bridge for production traffic** (`systemctl enable`,
    Vercel flip) before §4 smoke passes.
12. **Do not leave `/tmp/nexup-smoke.mjs` or a shell session holding sourced
    secrets** after the window: `rm -f /tmp/nexup-smoke.mjs`, close the shell.
