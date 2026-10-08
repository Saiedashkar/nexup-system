import type { PrismaClient } from "@prisma/client";

import type { WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";

/**
 * Workforce DURABLE persistence — its own entry point.
 *
 * `@/modules/workforce` stays free of Prisma: it is pure domain composition and
 * the in-memory repositories remain the default there, which is what the
 * deterministic unit tests import. Application code imports THIS path instead:
 *
 *   const handle = createWorkforcePrismaClient(url);       // loopback-guarded
 *   const domain = createWorkforceDomainFromPrisma(handle);
 *
 * One persistence architecture, not two: the Prisma client factory and its
 * loopback guard are the ones Phase 1B already established
 * (`ai-workforce/persistence/prisma-client.ts`); this module adds only the
 * repository adapters for the lifecycle tables.
 */

export {
  PrismaExecutionRecordRepository,
  PrismaMissionRepository,
  PrismaReviewRepository,
  PrismaTaskRepository,
  assertLifecycleSchema,
  createPrismaLifecycleRepositories,
} from "./prisma-lifecycle-repositories";
export type {
  WorkforceLifecyclePrismaClient,
  WorkforceLifecycleRepositories,
} from "./prisma-lifecycle-repositories";

export { createWorkforceDomainFromPrisma } from "./prisma-composition";
export type { DurableWorkforceDomainOptions } from "./prisma-composition";

/* ── Step 5/8 — the durable Command IDEMPOTENCY ledger ── */
export {
  PrismaCommandIntentRepository,
  assertCommandIntentSchema,
} from "./prisma-command-intent-repository";
export type {
  CommandIntentPrismaClient,
  PrismaCommandIntentRepositoryOptions,
} from "./prisma-command-intent-repository";

/* ── Step 5A-2 — the durable EXECUTION CLAIM ledger ──
   Exported so an application CAN compose the durable claim, and NOT bound into
   `createWorkforceDomainFromPrisma`: the live mission dispatch still runs on the
   pre-Step-5A path. Moving dispatch behind the claim is a separate ordering
   change (design §K, batches 5A-4/5A-6), so the existing execution path stays
   byte-identical in this batch. */
export {
  PrismaExecutionClaimRepository,
  assertExecutionClaimSchema,
} from "./prisma-execution-claim-repository";
export type {
  ExecutionClaimPrismaClient,
  PrismaExecutionClaimRepositoryOptions,
} from "./prisma-execution-claim-repository";

/* ── Step 5A-3 — the AUTHORITATIVE business-scope resolver ──
   Resolves an opaque business reference (slug OR database id) to the existing
   `Business` registry row. No second registry is introduced. */
export { prismaBusinessScopeResolver } from "./prisma-business-scope";

/** What the composition helper accepts — a handle, or a bare client. */
export type WorkforceLifecycleClientLike = WorkforcePrismaHandle | PrismaClient;
