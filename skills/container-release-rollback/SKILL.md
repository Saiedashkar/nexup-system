---
name: container-release-rollback
description: Prepare, deploy, verify, or roll back an immutable container release when a repository has an approved runbook and isolated service state. Use for controlled release work, not routine local development.
---

# Container release and rollback

Use the repository's own operations runbook as the authority. This skill
preserves the reusable method; project names, credentials, hosts, and customer
data belong in approved environment settings or the runbook, never here.

## Required inputs

- the approved operations runbook and intended source revision;
- immutable release and image identifiers;
- target service scope, health checks, and public endpoint;
- data ownership, backup/restore procedure, and isolation requirements;
- the previous known-good release and rollback trigger;
- explicit authorization for every external mutation.

If any required input is missing, perform only read-only preflight checks and
report the exact missing item.

## Procedure

1. Resolve the requested source revision against the canonical remote. Record
   the branch, commit, working-tree state, and artifact checksum.
2. Read the runbook and inspect its scripts before executing them. Confirm their
   targets, data sources, network calls, and destructive operations.
3. Batch read-only preflight checks: capacity, container runtime, routing,
   current release, service health, database isolation, and the rollback
   anchor. Do not change neighboring services.
4. Before a schema or data mutation, create and verify the runbook-prescribed
   backup. Keep the previous immutable artifact and configuration.
5. Build or select the immutable image, record its digest, and change only the
   target service configuration. Do not infer permission to deploy from
   permission to inspect.
6. Run the documented verification gate, including container health, data and
   network isolation, TLS, authentication, critical reads, expected write
   policy, and external-action policy.
7. Roll back when a gate fails and the runbook's rollback trigger is met.
   Restore the previous configuration and image first; restore data only when
   the failed release made an incompatible data change.
8. Report the exact revision and image, checks with real exit codes, unchanged
   neighboring services, and the tested rollback path. Keep raw logs in an
   artifact file without secrets.

## Permissions and stop conditions

- Read-only inspection needs no deployment authority.
- Building, switching a release, migrating data, restoring a backup, or
  changing routing needs explicit authorization for the named target.
- Stop on an unexpected target, absent backup, failed isolation check, missing
  credential binding, or policy guard. Never bypass a guard or broaden a
  service account.

## Success measure

Success requires all documented gates to pass against the intended immutable
revision, the target data and networks to remain isolated, neighboring services
to remain unchanged, and rollback to be both documented and backed by a retained
previous release. A successful build alone is not a successful release.
