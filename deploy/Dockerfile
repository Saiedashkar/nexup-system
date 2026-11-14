# ═══════════════════════════════════════════════════════════════════════════
# NEXUP COMMAND — the application image
# ═══════════════════════════════════════════════════════════════════════════
#
#   docker build -f deploy/Dockerfile -t nexup-command:<SHA> .
#
# Three stages, and the reason for each:
#
#   deps    installs the FULL dependency set from the committed lockfile. Prisma's
#           CLI is a dev dependency and the image keeps it on purpose: migrations
#           are run from this same image (`docker compose run --rm app npx prisma
#           migrate deploy`), so the schema and the client can never come from
#           different versions. The cost is image size, paid once.
#   build   generates the Prisma client and runs `next build`. It is given NO
#           database URL: anything this build needs at render time has to be
#           dynamic, and a build that starts depending on production rows fails
#           here instead of on the phone.
#   runner  copies only what `next start` reads, runs as a non-root user, and
#           carries a healthcheck that asks the app's own /login page.
#
# The image contains no secret: DATABASE_URL and AUTH_SECRET arrive as environment
# variables at run time, from /etc/nexup-command/app.env on the host.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# openssl is what Prisma's query engine links against on bookworm-slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
# The EDGE middleware reads its environment at BUILD time, so the trial lock is a
# build input as well as a runtime one. `--build-arg TRIAL_READ_ONLY=1` closes
# every API family; leaving it at 0 keeps the app writable, and the Node handlers
# still honour the runtime variable (src/lib/trial-lock.ts) whichever way this is
# set — measured both ways on this tree.
ARG TRIAL_READ_ONLY=0
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TRIAL_READ_ONLY=${TRIAL_READ_ONLY}
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 nextjs \
 && useradd --system --uid 10001 --gid nextjs --home /home/nextjs --create-home nextjs

# The full node_modules is intentional (see deps): `next start` needs the runtime
# packages and the migrate one-off needs the CLI. Nothing in it is world-writable.
COPY --from=deps  --chown=nextjs:nextjs /app/node_modules ./node_modules
# `prisma generate` runs in the build stage, after `deps` is snapshotted. Copy
# its generated client explicitly or the runner keeps @prisma/client without
# node_modules/.prisma and every database-backed route fails at runtime.
COPY --from=build --chown=nextjs:nextjs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nextjs:nextjs /app/.next        ./.next
COPY --from=build --chown=nextjs:nextjs /app/public       ./public
COPY --from=build --chown=nextjs:nextjs /app/prisma       ./prisma
COPY --from=build --chown=nextjs:nextjs /app/package.json ./package.json
COPY --from=build --chown=nextjs:nextjs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nextjs:nextjs /app/next.config.ts ./next.config.ts

# `next start` writes image-optimizer output under .next/cache. The container runs
# read-only (compose sets read_only: true), so that one path is mounted as tmpfs
# there; creating it here keeps ownership right for the non-root user.
RUN mkdir -p /app/.next/cache && chown -R nextjs:nextjs /app/.next/cache

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "--no-install", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
