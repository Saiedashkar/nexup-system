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
import { InMemoryTaskRepository, type TaskRepository } from "./missions/task-repository";
import {
  ExecutionRecorder,
  InMemoryExecutionRecordRepository,
  type ExecutionRecordRepository,
} from "./execution/execution-record";
import { ReviewService } from "./review/task-review";

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
  /** Injected repositories, so a test may share state across a "restart". */
  tasks?: TaskRepository;
  executionRecords?: ExecutionRecordRepository;
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
  /** Mission TASKS — the assigned units of work inside a goal. */
  tasks: TaskRepository;
  /** The append-only audit of every execution attempt. */
  executionRecords: ExecutionRecordRepository;
  /** Turns runtime outcomes into execution records. */
  executions: ExecutionRecorder;
  /** The human-authority decision boundary. */
  reviews: ReviewService;
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
  const tasks = options.tasks ?? new InMemoryTaskRepository();
  const executionRecords = options.executionRecords ?? new InMemoryExecutionRecordRepository();
  const executions = new ExecutionRecorder({ records: executionRecords, ids, now });
  const reviews = new ReviewService({ ids, now, actors });

  for (const runtime of options.runtimeAdapters ?? []) {
    runtimes.register(runtime);
  }

  return {
    actors,
    capabilities,
    assignments,
    runtimes,
    missions,
    missionRepository,
    tasks,
    executionRecords,
    executions,
    reviews,
    ids,
    now,
  };
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

export {
  internalStrategyAnalystRegistration,
  INTERNAL_STRATEGY_ANALYST_ACTOR_ID,
  INTERNAL_STRATEGY_ANALYST_SLUG,
  INTERNAL_STRATEGY_ANALYST_ROLE,
  STRATEGY_DEPARTMENT,
} from "./actors/strategy-actor";
export type { StrategyActorBindingInput } from "./actors/strategy-actor";

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

export * from "./missions/task-contracts";
export { InMemoryTaskRepository, requireTask } from "./missions/task-repository";
export type { TaskRepository } from "./missions/task-repository";

export * from "./execution/actor-execution-context";
export {
  ExecutionRecorder,
  InMemoryExecutionRecordRepository,
  executionTerminalStatus,
  summarizeExecution,
  EXECUTION_AUDIT_EVENT_TYPES,
} from "./execution/execution-record";
export type {
  ExecutionAuditEvent,
  ExecutionAuditEventType,
  ExecutionRecord,
  ExecutionRecordOpenInput,
  ExecutionRecordRepository,
} from "./execution/execution-record";

export {
  ReviewService,
  REVIEW_DECISIONS,
  REVIEW_STATES,
  isReviewDecision,
} from "./review/task-review";
export type {
  ReviewDecision,
  ReviewRequestInput,
  ReviewServiceLike,
  ReviewState,
  TaskReview,
} from "./review/task-review";

/* ── Step 4 — the first REAL actor wired to a real runtime ── */
export * from "./orchestration/strategy-analyst";

/* ── Step 5 — the real mission lifecycle, in ONE orchestrator ── */
export * from "./orchestration/mission-orchestrator";
