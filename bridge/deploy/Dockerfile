# NEXUP Bridge image (revised C).
#
# The bridge runs as its OWN container that shares the Hermes container's
# network namespace, so it reaches the loopback `serve` Hermes listens on
# without Hermes ever leaving loopback. Nothing binds a host port: the bridge
# has no published port anywhere, and Traefik reaches it at the OWNER
# container's address (Traefik follows `NetworkMode`).
#
# Build context is the staged deploy directory on the VPS, NOT the repository:
#
#   /opt/nexup-bridge/
#     ├── Dockerfile
#     └── dist/main.js          # the bundled artifact, digest recorded in P0
#
# so the build needs no checkout, no package manager and no network install:
# `dist/main.js` is self-contained (P0.4b asserts it requires only node
# builtins).
#
#   docker build --pull -t nexup-bridge:<git-sha> /opt/nexup-bridge
#
# Then pin the built image BY DIGEST in docker-compose.bridge.yml; the digest is
# the artifact identity the pre-flight compares (P0.2b).

FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
COPY dist/main.js /app/dist/main.js

# Numeric, non-root, and identical to `user:` in the compose file so both
# artifacts agree. The container needs no writable path at all (the compose
# mounts read-only / and a tmpfs at /tmp).
USER 10001:10001

# No HEALTHCHECK: the bridge exposes no unauthenticated endpoint, so a probe
# would have to sign a request. Liveness is observed from outside instead —
# `docker inspect ne... .State.Running` by the supervisor, and the Traefik
# router plus the P4.1/P4.2 checks at deploy time.
ENTRYPOINT ["/usr/local/bin/node", "/app/dist/main.js"]
