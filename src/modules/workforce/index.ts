import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import { createIdFactory, systemClock } from "@/modules/ai-workforce/core/ids";

import { InMemoryActorRegistry, type ActorRegistry } from "./actors/actor-registry";
import { execActorRegistration, founderActorRegistration } from "./actors/exec-actor";
import { InMemoryCapabilityRegistry, type CapabilityRegistry } from "./capabilities/capability-registry";
import { ActorAssignmentService } from "./assignments/actor-assignment-service";
import { InMemoryRuntimeRegistry, type RuntimeRegistry } from "./runtimes/runtime-registry";
import { DeterministicRuntimeAdapter } from "./runtimes/deterministic-runtime-adapter";
import type { AgentRuntime } from "./runtimes/agent-runtime";
import { InMemoryMissionRepository, type MissionRepository } from "./missions/mission-repository";
import { MissionService } from "./missions/mission-service";

/**
 * Workforce Runtime Core — module surface (Phase 2A).
 *
 * Pure composition: no Prisma, no Next.js, no environment, no network. The
 * domain owns actors, capabilities, assignments, runtimes and missions; the
 * Phase-1 execution ENGINE (`modules/ai-workforce`) is untouched and remains
 * the only thing that runs a capability.
 *
 * This is the layer that makes EXEC, departments, actors, skills, tools,
 * workflows and missions REPRESENTABLE. It executes nothing.
 */

export type CreateWorkforceDomainOptions = {
  ids?: IdFactory;
  now?: Clock;
  /** Injected registries/services (tests may share state across a "restart"). */
  actors?: ActorRegistry;
  capabilities?: CapabilityRegistry;
  runtimes?: RuntimeRegistry;
  missionRepository?: MissionRepository;
  /** Runtime adapters to register immediately. */
  runtimeAdapters?: AgentRuntime[];
  /** Register the EXEC + Founder actor seeds. */
  seedExecutive?: boolean;
};

export type WorkforceDomain = {
  actors: ActorRegistry;
  capabilities: CapabilityRegistry;
  assignments: ActorAssignmentService;
  runtimes: RuntimeRegistry;
  missions: MissionService;
  missionRepository: MissionRepository;
  ids: IdFactory;
  now: Clock;
};

export function createWorkforceDomain(options: CreateWorkforceDomainOptions = {}): WorkforceDomain {
  const ids = options.ids ?? createIdFactory();
  const now = options.now ?? systemClock();

  const actors = options.actors ?? new InMemoryActorRegistry({ ids, now });
  const capabilities = options.capabilities ?? new InMemoryCapabilityRegistry({ ids, now });
  const runtimes = options.runtimes ?? new InMemoryRuntimeRegistry();
  const missionRepository = options.missionRepository ?? new InMemoryMissionRepository();

  const assignments = new ActorAssignmentService({ actors, capabilities, ids, now });
  const missions = new MissionService({ missions: missionRepository, ids, now });

  for (const runtime of options.runtimeAdapters ?? []) {
    runtimes.register(runtime);
  }

  return { actors, capabilities, assignments, runtimes, missions, missionRepository, ids, now };
}

/**
 * Convenience bootstrap for the running application: an in-memory domain with a
 * deterministic runtime and the EXEC/Founder seeds registered. Tests should use
 * `createWorkforceDomain` directly so an empty registry stays empty.
 */
export async function bootstrapWorkforceDomain(
  options: CreateWorkforceDomainOptions = {},
): Promise<WorkforceDomain> {
  const domain = createWorkforceDomain({
    ...options,
    runtimeAdapters: options.runtimeAdapters ?? [],
  });
  domain.runtimes.register(new DeterministicRuntimeAdapter({ ids: domain.ids, now: domain.now }));
  if (options.seedExecutive) {
    await domain.actors.register(execActorRegistration());
    await domain.actors.register(founderActorRegistration());
  }
  return domain;
}

/* ═══════════════════════════════════════════════════════
   Public surface
   ═══════════════════════════════════════════════════════ */

export * from "./core/refs";
export { findCredentialKeys, hasCredentials, assertNoCredentials } from "./core/credentials";

export * from "./actors/actor-contracts";
export * from "./actors/actor-lifecycle";
export { InMemoryActorRegistry } from "./actors/actor-registry";
export type { ActorRegistry } from "./actors/actor-registry";
export { execActorRegistration, founderActorRegistration, systemActorRegistration } from "./actors/exec-actor";

export * from "./capabilities/capability-contracts";
export { InMemoryCapabilityRegistry } from "./capabilities/capability-registry";
export type { CapabilityRegistry } from "./capabilities/capability-registry";

export * from "./assignments/actor-assignment-service";

export * from "./runtimes/agent-runtime";
export { InMemoryRuntimeRegistry } from "./runtimes/runtime-registry";
export type { RuntimeRegistry } from "./runtimes/runtime-registry";
export { DeterministicRuntimeAdapter, isTerminalExecutionStatus } from "./runtimes/deterministic-runtime-adapter";

/* ── Phase 2B — agent-runtime dispatch seam + Hermes adapter ── */
export * from "./runtimes/agent-runtime-dispatcher";
export { toJobRunnerDispatcher } from "./runtimes/agent-job-dispatcher-binding";
export * from "./runtimes/hermes";

export * from "./missions/mission-contracts";
export { InMemoryMissionRepository } from "./missions/mission-repository";
export type { MissionRepository } from "./missions/mission-repository";
export { MissionService } from "./missions/mission-service";

export * from "./execution/actor-execution-context";
