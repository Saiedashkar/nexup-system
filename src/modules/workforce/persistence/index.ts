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

/** What the composition helper accepts — a handle, or a bare client. */
export type WorkforceLifecycleClientLike = WorkforcePrismaHandle | PrismaClient;
