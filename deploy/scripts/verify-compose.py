#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
# NEXUP COMMAND — static invariants of the deployment package
# ═══════════════════════════════════════════════════════════════════════════
#
#   python deploy/scripts/verify-compose.py
#
# WHY THIS EXISTS
#
# The isolation this stack promises is a claim about two networks: the database
# exists only on the `internal` network, and only the app is attached to the
# proxy's `edge` network, so no container on the edge can open a socket to
# Postgres. Proving that at run time needs a Docker engine and a container placed
# on the edge network. Where no engine exists, this script proves the part that
# is decidable from the files themselves, and refuses to claim more.
#
# WHAT IT PROVES (from the files, no engine):
#   · no service publishes a port, so nothing is reachable from the host;
#   · `internal` is `internal: true` and `edge` is `external: true`;
#   · the db service is on `internal` and on nothing else;
#   · the app is the ONLY service on `edge`;
#   · the app waits for a healthy db, runs read-only, drops all capabilities;
#   · the app image is a pinned reference, never `latest`;
#   · the Dockerfile is built with TRIAL_READ_ONLY as an ARG and runs non-root.
#
# WHAT IT CANNOT PROVE (and says so on success):
#   · that the image builds, that the containers start and stay healthy;
#   · that a container on `edge` really fails to resolve/reach Postgres.
# Those need `docker build` + `docker compose up` on a host with an engine.
#
# It reads the real YAML (PyYAML) instead of pattern-matching the text, because a
# regex cannot tell `internal: true` from `internal: true` inside a comment.

import json
import pathlib
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - operator machine without PyYAML
    sys.stderr.write("PyYAML is required to parse the compose file (pip install pyyaml).\n")
    sys.exit(2)

HERE = pathlib.Path(__file__).resolve().parent
COMPOSE = HERE.parent / "compose.yml"
DOCKERFILE = HERE.parent / "Dockerfile"

compose = yaml.safe_load(COMPOSE.read_text(encoding="utf-8")) or {}
dockerfile = DOCKERFILE.read_text(encoding="utf-8")

services = compose.get("services") or {}
networks = compose.get("networks") or {}
results = []


def check(name, ok, detail):
    results.append((name, bool(ok), detail))


def nets_of(service):
    n = (services.get(service) or {}).get("networks")
    if isinstance(n, list):
        return n
    if isinstance(n, dict):
        return list(n.keys())
    return []


# ── no published port anywhere ───────────────────────────────────────────────
for name, svc in services.items():
    svc = svc or {}
    check(
        f"{name}: no published port",
        "ports" not in svc and "expose" not in svc,
        "no ports:/expose: key" if "ports" not in svc else f"found ports: {svc.get('ports')}",
    )

# ── the two networks mean what the comments say ──────────────────────────────
check(
    "network internal is internal: true",
    (networks.get("internal") or {}).get("internal") is True,
    f"internal: {(networks.get('internal') or {}).get('internal')}",
)
check(
    "network edge is external: true",
    (networks.get("edge") or {}).get("external") is True,
    f"external: {(networks.get('edge') or {}).get('external')}",
)

# ── the database lives on internal and nowhere else ─────────────────────────
db_networks = nets_of("db")
check(
    "db is attached to internal only",
    db_networks == ["internal"],
    f"db networks = {db_networks}",
)
check(
    "db is NOT on the edge network",
    "edge" not in db_networks,
    "not attached to edge" if "edge" not in db_networks else "db would be reachable from the proxy network",
)

# ── the app is the only thing the proxy can see ─────────────────────────────
edge_members = [n for n in services if "edge" in nets_of(n)]
check(
    "edge network has exactly one member: app",
    edge_members == ["app"],
    f"edge members = {edge_members}",
)

app_networks = nets_of("app")
check(
    "app joins internal and edge",
    "internal" in app_networks and "edge" in app_networks,
    f"app networks = {app_networks}",
)

# ── hardening that actually ships ───────────────────────────────────────────
app = services.get("app") or {}
check("app runs read-only", app.get("read_only") is True, f"read_only = {app.get('read_only')}")
check(
    "app drops all capabilities",
    isinstance(app.get("cap_drop"), list) and "ALL" in app["cap_drop"],
    f"cap_drop = {app.get('cap_drop')}",
)
check(
    "app has no-new-privileges",
    isinstance(app.get("security_opt"), list) and "no-new-privileges:true" in app["security_opt"],
    f"security_opt = {app.get('security_opt')}",
)
check(
    "app waits for a healthy db",
    ((app.get("depends_on") or {}).get("db") or {}).get("condition") == "service_healthy",
    f"condition = {((app.get('depends_on') or {}).get('db') or {}).get('condition')}",
)
app_image = app.get("image") or ""
check(
    "app image is a pinned reference, not latest",
    isinstance(app_image, str)
    and ":latest" not in app_image
    and ("${COMMAND_IMAGE" in app_image or "@sha256:" in app_image),
    f"image = {app_image}",
)
check(
    "app healthcheck asks the app's own /login",
    "/login" in json.dumps(app.get("healthcheck") or {}),
    "healthcheck path",
)
check(
    "trial lock defaults to closed at run time",
    ":-1" in str((app.get("environment") or {}).get("TRIAL_READ_ONLY", "")),
    f"TRIAL_READ_ONLY = {(app.get('environment') or {}).get('TRIAL_READ_ONLY')}",
)
db_volumes = (services.get("db") or {}).get("volumes") or []
check(
    "db data is on a named volume",
    any("pgdata:" in str(v) for v in db_volumes),
    f"volumes = {db_volumes}",
)

# ── the image: the trial lock is a build input, and it is not root ──────────
check(
    "Dockerfile takes TRIAL_READ_ONLY as a build arg",
    re.search(r"^ARG\s+TRIAL_READ_ONLY=", dockerfile, re.M) is not None
    and re.search(r"TRIAL_READ_ONLY=\$\{TRIAL_READ_ONLY\}", dockerfile) is not None,
    "ARG + ENV wired for the edge middleware",
)
user_match = re.search(r"^USER\s+(\S+)", dockerfile, re.M)
user_line = user_match.group(1) if user_match else None
check(
    "runner is not root",
    bool(user_line) and user_line not in ("root", "0"),
    f"USER {user_line or '(absent)'}",
)
check("image has a HEALTHCHECK", re.search(r"^HEALTHCHECK\s", dockerfile, re.M) is not None, "HEALTHCHECK present")

# ── report ─────────────────────────────────────────────────────────────────
failed = [r for r in results if not r[1]]
for name, ok, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name} — {detail}")
print(f"\n{len(results) - len(failed)}/{len(results)} static invariants hold.")

if failed:
    sys.stderr.write("\nStatic verification failed; do not deploy this package.\n")
    sys.exit(1)

print(
    "\n".join(
        [
            "",
            "NOT PROVEN BY THIS RUN (needs a Docker engine, see deploy/README.md §Verification):",
            "  · the image builds and the containers reach healthy;",
            "  · a container on the edge network really cannot resolve or reach Postgres.",
            "This run proves only what the files themselves decide: the db is on no network",
            "the proxy belongs to, no service publishes a port, and only the app is on edge.",
        ]
    )
)
