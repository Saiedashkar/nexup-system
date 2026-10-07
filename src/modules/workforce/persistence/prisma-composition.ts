import type { PrismaClient } from "@prisma/client";

import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";

import { createWorkforceDomain, type WorkforceDomain } from "../index";
import type { AgentRuntime } from "../runtimes/agent-runtime";
import { createPrismaLifecycleRepositories } from "./prisma-lifecycle-repositories";

/**
 * Durable application composition.
 *
 * The same `createWorkforceDomain` the tests use, with the four lifecycle
 * repositories bound to a real database instead of a Map. Nothing else changes:
 * the orchestrator, the state machines, the dispatcher and the review boundary
 * are the identical objects, so durability is a composition choice rather than
 * a second code path that could drift from the tested one.
 *
 * What is deliberately NOT durable here, stated plainly rather than implied:
 * the ACTOR, CAPABILITY, ASSIGNMENT and RUNTIME registries stay in memory. They
 * are seed/configuration state owned by code (`bootstrapStrategyAnalyst`
 * registers them idempotently on every boot), not user data, and the mission
 * lifecycle — mission, task, execution attempt, review decision — is the part
 * that must survive a restart. If a later step makes actors user-editable, that
 * registry gets its own port and its own proposal; it is not smuggled in here.
 *
 * No runtime is registered: a runtime is a real capability the deployment wires
 * in explicitly, and this composition must never imply that canned output is
 * available.
 */
export type DurableWorkforceDomainOptions = {
  ids?: IdFactory;
  now?: Clock;
  /** Runtime adapters to register immediately (usually none; see above). */
  runtimeAdapters?: AgentRuntime[];
};

function resolveClient(handleOrClient: WorkforcePrismaHandle | PrismaClient): PrismaClient {
  const candidate = handleOrClient as Partial<WorkforcePrismaHandle>;
  return (candidate.client ?? (handleOrClient as PrismaClient)) as PrismaClient;
}

/**
 * @throws PERSISTENCE_UNAVAILABLE when the connected database has no lifecycle
 * tables — at composition time, not on the first mission.
 */
export function createWorkforceDomainFromPrisma(
  handleOrClient: WorkforcePrismaHandle | PrismaClient,
  options: DurableWorkforceDomainOptions = {},
): WorkforceDomain {
  const client = resolveClient(handleOrClient);
  const repositories = createPrismaLifecycleRepositories(client);

  return createWorkforceDomain({
    ...(options.ids ? { ids: options.ids } : {}),
    ...(options.now ? { now: options.now } : {}),
    missionRepository: repositories.missions,
    tasks: repositories.tasks,
    executionRecords: repositories.executionRecords,
    reviews: repositories.reviews,
    runtimeAdapters: options.runtimeAdapters ?? [],
  });
}
