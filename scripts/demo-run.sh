#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# NEXUP AI WORKFORCE — start the app against the LOCAL demo environment
# ═══════════════════════════════════════════════════════════════════════
#
# Loads the git-ignored `.demo/env` written by `scripts/demo-env.mjs` and runs
# the real application. Those exported variables WIN over `.env` / `.env.local`:
#
#   DATABASE_URL                 → the isolated cluster (the legacy client too)
#   AI_WORKFORCE_DATABASE_URL    → the same cluster
#   AI_WORKFORCE_TEST_TRANSPORT  → the deterministic runtime (no paid credits)
#   AUTH_SECRET                  → the demo's generated secret
#
# so nothing here can reach the production Supabase host.
#
# Usage:  bash scripts/demo-run.sh        # Ctrl+C to stop
# Env:    DEMO_PORT (from .demo/env, default 3300)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .demo/env ]; then
  echo "No .demo/env yet — create the demo environment first:" >&2
  echo "  node scripts/demo-env.mjs" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
. ./.demo/env
set +a

echo "── NEXUP local demo ───────────────────────────────────────────"
echo "   URL        http://127.0.0.1:${DEMO_PORT}/login"
echo "   login      ${NEXUP_DEMO_EMAIL}   (password in .demo/credentials.txt)"
echo "   database   ${AI_WORKFORCE_DATABASE_URL}"
echo "   runtime    deterministic TEST transport (no paid credits, no production)"
echo "   stop       Ctrl+C"
echo ""

exec npx next dev --webpack -p "${DEMO_PORT}"
