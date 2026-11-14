# NEXUP COMMAND — source, deployment, update, verification, and rollback

## Identity

| Item | Value |
|---|---|
| Canonical repository | `https://github.com/Saiedashkar/nexup-system.git` |
| Working branch | `feature/data-binding-clients-projects-20261107` |
| Published source bundle | `nexup-trial-afdca18.tar.gz` |
| Published release label | `afdca18-deployfix1` |
| Public URL | `https://command.rebound-agency.tech` |
| Published image ID | `sha256:059fa44160d02e1283c7150078140dde6d867d8364b25824a985bacb0bad24f0` |
| Release directory | `/opt/nexup-command/releases/afdca18` |
| Active release link | `/opt/nexup-command/current` |
| Runtime metadata | `/etc/nexup-command/release.env` |

The public trial is read-only. Its Postgres volume and Docker networks are
dedicated to NEXUP COMMAND. Hermes and NEXPUBLISH are outside this stack.

## Fixes carried back from `afdca18-deployfix1`

1. `postgres:18-alpine` mounts its persistent volume at
   `/var/lib/postgresql`, not the legacy `/var/lib/postgresql/data` path.
2. The runner image copies `node_modules/.prisma` and `prisma.config.ts` from
   the build stage. Without them, `@prisma/client` and `prisma db push` fail in
   the production image even though `next build` succeeds.

## Update

1. Create a new immutable directory under `/opt/nexup-command/releases/` and
   verify the source archive checksum before extracting it.
2. Build with `--build-arg TRIAL_READ_ONLY=1` and record the resulting image ID.
3. Back up the isolated database with `deploy/scripts/backup.sh` before any
   schema operation. Do not reuse or copy data from another product database.
4. Apply the schema from the same image, then change `COMMAND_IMAGE` in
   `/etc/nexup-command/release.env` to the new immutable image ID.
5. Point `/opt/nexup-command/current` at the new release and run Compose with
   `deploy/compose.yml` plus the host's NEXUP-only Traefik override.
6. Do not change the shared Traefik static configuration, Hermes, or
   NEXPUBLISH. Only the NEXUP app joins `nexup-command-edge`; its database stays
   on `nexup-command-internal`.

## Verification gate

An update is accepted only after all of these pass:

- both `nexup-command-app-1` and `nexup-command-db-1` are `healthy`;
- the database has no published host port and belongs only to the internal
  network;
- HTTP redirects to HTTPS and the certificate verifies for
  `command.rebound-agency.tech`;
- `deploy/scripts/smoke.mjs` reports `17/17` with exit code `0`;
- login, clients, and projects open with the mobile user agent;
- project/client writes return `403 This trial is read-only.`;
- `/api/exec/*` and `/api/ai-workforce/*` return `403 external execution
  disabled`;
- Hermes and NEXPUBLISH container state is unchanged.

## Rollback

Before every update, retain the previous release directory, image ID, database
backup, and the previous contents of `release.env`.

1. Restore the previous `COMMAND_IMAGE` and point `current` back to the previous
   release directory.
2. Run Compose for the app only and wait for its health check.
3. Re-run the HTTPS, login, read-only, and external-execution smoke checks.
4. Restore the database with `deploy/scripts/restore.sh` only when the failed
   update changed the schema incompatibly; otherwise keep the existing isolated
   volume.

`afdca18-deployfix1` is the first NEXUP COMMAND release on this host, so it is
the rollback anchor for the next update. Removing an image or volume is never
part of rollback.
