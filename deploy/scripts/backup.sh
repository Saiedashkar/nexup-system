#!/usr/bin/env bash
# BACKUP ONE DATABASE — a custom-format dump plus its checksum, nothing else.
#
#   PG_DUMP=/path/to/pg_dump \
#   PGHOST=127.0.0.1 PGPORT=5435 PGUSER=postgres PGPASSWORD=… \
#   DATABASE_NAME=command DUMP_DIR=/var/backups/nexup-command \
#   ./deploy/scripts/backup.sh
#
# On the trial host the database has no published port, so the same dump is taken
# through the container instead of a socket:
#
#   docker compose -f deploy/compose.yml exec -T db \
#     pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > "$DUMP_DIR/command-$(date +%F-%H%M).dump"
#
# What it refuses: to write a dump that is empty, to overwrite an existing file, to
# run without a target database name, and to leave more than KEEP files behind.

set -euo pipefail

: "${DATABASE_NAME:?DATABASE_NAME is required (e.g. command)}"
DUMP_DIR="${DUMP_DIR:-/var/backups/nexup-command}"
KEEP="${KEEP:-7}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"

command -v "$PG_DUMP" >/dev/null 2>&1 || { echo "✗ pg_dump not found: $PG_DUMP" >&2; exit 1; }
mkdir -p "$DUMP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$DUMP_DIR/${DATABASE_NAME// /_}-$stamp.dump"
[ -e "$target" ] && { echo "✗ refusing to overwrite $target" >&2; exit 1; }

tmp="$target.part"
echo "→ dumping $DATABASE_NAME to $tmp"
"$PG_DUMP" -Fc -d "$DATABASE_NAME" > "$tmp"

bytes="$(wc -c < "$tmp" | tr -d ' ')"
if [ "$bytes" -lt 1024 ]; then
  rm -f "$tmp"
  echo "✗ dump is only ${bytes} bytes — treating it as a failure, nothing kept" >&2
  exit 1
fi

mv "$tmp" "$target"
sha="$(sha256sum "$target" | cut -d' ' -f1)"
echo "✓ $target"
echo "  bytes    : $bytes"
echo "  sha256   : $sha"
echo "  rows     : $("$PSQL" -Atc "select 'users='||(select count(*) from \"User\")||' clients='||(select count(*) from \"Client\")||' projects='||(select count(*) from \"ProjectRecord\")" -d "$DATABASE_NAME" 2>/dev/null || echo 'unavailable')"
echo "$sha  $(basename "$target")" >> "$DUMP_DIR/SHA256SUMS"

# Retention: keep the newest $KEEP dumps, never delete anything else in the folder.
mapfile -t old < <(ls -1t "$DUMP_DIR"/*.dump 2>/dev/null | tail -n "+$((KEEP + 1))" || true)
for f in "${old[@]:-}"; do
  [ -n "$f" ] && echo "  pruning $f" && rm -f "$f"
done
