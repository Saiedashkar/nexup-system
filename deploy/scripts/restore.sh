#!/usr/bin/env bash
# RESTORE ONE DUMP — into a scratch database unless the operator insists twice.
#
#   PG_RESTORE=/path/to/pg_restore PGHOST=127.0.0.1 PGPORT=5435 PGUSER=postgres \
#   ./deploy/scripts/restore.sh --file /var/backups/nexup-command/command-….dump \
#     --database command_restore_check --scratch
#
# The point of this script is that the RECOVERY PATH IS EXERCISED, not promised:
# `--scratch` restores a dump into an empty database and prints the row counts, so
# an operator learns the real recovery time and the real data before the day they
# need it. Restoring over the live database requires BOTH `--production` and
# `--i-understand-data-is-overwritten`; nothing else can do it by accident.
#
# It never guesses a file, and it never runs `createdb`/`dropdb`.

set -euo pipefail

FILE=""
TARGET_DB=""
SCRATCH=0
PRODUCTION=0
CONFIRM=0

while [ $# -gt 0 ]; do
  case "$1" in
    --file) shift; FILE="${1:-}" ;;
    --database) shift; TARGET_DB="${1:-}" ;;
    --scratch) SCRATCH=1 ;;
    --production) PRODUCTION=1 ;;
    --i-understand-data-is-overwritten) CONFIRM=1 ;;
    *) echo "✗ unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

: "${FILE:?--file is required}" "${TARGET_DB:?--database is required}"
[ -f "$FILE" ] || { echo "✗ no such dump: $FILE" >&2; exit 1; }

PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"
CREATEDB="${CREATEDB:-createdb}"
command -v "$PG_RESTORE" >/dev/null 2>&1 || { echo "✗ pg_restore not found: $PG_RESTORE" >&2; exit 1; }

if [ "$PRODUCTION" -eq 1 ] && [ "$CONFIRM" -ne 1 ]; then
  echo "✗ --production also needs --i-understand-data-is-overwritten" >&2
  exit 1
fi
if [ "$PRODUCTION" -eq 1 ] && [ "$SCRATCH" -eq 1 ]; then
  echo "✗ --scratch and --production are mutually exclusive" >&2
  exit 1
fi

exists="$("$PSQL" -Atc "select 1 from pg_database where datname = '$TARGET_DB'" -d postgres)"
if [ "$SCRATCH" -eq 1 ]; then
  if [ "$exists" = "1" ]; then
    echo "✗ scratch database $TARGET_DB already exists — drop it first, this script creates nothing twice" >&2
    exit 1
  fi
  "$CREATEDB" "$TARGET_DB"
  echo "→ created scratch database $TARGET_DB"
elif [ "$PRODUCTION" -ne 1 ]; then
  echo "✗ refusing: pass --scratch (new empty database) or --production (with the confirm flag)" >&2
  exit 1
fi

echo "→ restoring $(basename "$FILE") into $TARGET_DB"
started="$(date +%s)"
"$PG_RESTORE" --no-owner --no-privileges --clean --if-exists --dbname "$TARGET_DB" "$FILE"
finished="$(date +%s)"

echo "✓ restored in $((finished - started))s"
"$PSQL" -d "$TARGET_DB" -Atc "
  select 'users='||(select count(*) from \"User\")
      ||' businesses='||(select count(*) from \"Business\")
      ||' clients='||(select count(*) from \"Client\")
      ||' live_clients='||(select count(*) from \"Client\" where \"deletedAt\" is null)
      ||' projects='||(select count(*) from \"ProjectRecord\")
      ||' activity='||(select count(*) from \"ActivityLog\")"
# A database provisioned with `db push` has no migration history at all; say so
# instead of failing the whole check on a table that is legitimately absent.
"$PSQL" -d "$TARGET_DB" -Atc "
  select 'migration_history=' || coalesce(to_regclass('public._prisma_migrations')::text, 'absent')"
echo "  note: a restore returns the rows as they were AT DUMP TIME — anything written after the dump is gone."
