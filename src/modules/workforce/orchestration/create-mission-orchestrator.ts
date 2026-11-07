import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import type { BudgetGovernor } from "@/modules/ai-workforce/policies/budget-governor";
import type { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import type { WorkforceDomain } from "../index";
import type { ExecutionClaimRepository } from "../execution/execution-claim";
import { InMemoryExecutionClaimRepository } from "../execution/execution-claim";
import type { BusinessScopeResolver } from "../execution/authority-resolution";
import {
  createCapabilityExecutionService,
  type ExecutionApprovalSource,
} from "../execution/capability-execution-service";
import type { CapabilityExecutionService } from "../execution/capability-execution-contracts";
import {
  createGovernedToolInvoker,
  type GovernedDeterministicInvoker,
} from "../execution/governed-deterministic-invoker";
import { AgentRuntimeDispatcher } from "../runtimes/agent-runtime-dispatcher";
import {
  MissionOrchestrator,
  type ReviewPolicy,
} from "./mission-orchestrator";

/**
 * The COMPOSITION SEAM for the mission orchestrator.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE ORCHESTRATOR IT BUILDS. The authority
 * class (`mission-orchestrator.ts`) must not be able to name a runtime, a
 * dispatcher or a provider adapter at all — that is what makes "the orchestrator
 * called a runtime directly" unexpressible rather than merely discouraged. But
 * SOMETHING has to assemble the default execution boundary for an offline test
 * or a bare composition, and that something must reference the internal
 * dispatcher. Keeping the two in one file would have left the dispatcher import
 * sitting inside the authority, which is exactly the shortcut the cutover is
 * meant to remove.
 *
 * So: the authority module holds the CLASS; this module holds the WIRING. The
 * dispatcher is constructed here, handed to `CapabilityExecutionService`, and
 * from then on it lives BELOW the execution boundary — the orchestrator only
 * ever sees `CapabilityExecutionService`.
 *
 * NOTHING here weakens a default: the budget governor is the shipped DENY one
 * unless a caller composes another, a runtime leg is always
 * `VARIABLE_PROVIDER_COST`, and the claim ledger is the in-memory reference
 * implementation unless the APPLICATION supplies the durable one.
 */
export function createMissionOrchestrator(
  domain: WorkforceDomain,
  options: {
    reviewPolicy?: ReviewPolicy;
    defaultReviewerActorId?: string;
    /** Fully composed execution boundary. Wins over every field below. */
    execution?: CapabilityExecutionService;
    /** The INTERNAL dispatcher, used only to build the default execution service. */
    dispatcher?: AgentRuntimeDispatcher;
    claims?: ExecutionClaimRepositoryLike;
    budget?: BudgetGovernor;
    tools?: ToolRegistry;
    approvals?: ExecutionApprovalSource;
    businesses?: BusinessScopeResolver;
    deterministic?: GovernedDeterministicInvoker;
    /** Phase-1 read ports, needed only to build the default deterministic leg. */
    ports?: WorkforcePorts;
    processId?: string;
    submissionTimeoutMs?: number;
  } = {},
): MissionOrchestrator {
  const dispatcher =
    options.dispatcher ??
    new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });

  const execution =
    options.execution ??
    createCapabilityExecutionService({
      ids: domain.ids,
      now: domain.now,
      // The reference claim ledger. The APPLICATION supplies the durable one.
      claims: options.claims ?? new InMemoryExecutionClaimRepository({ ids: domain.ids, now: domain.now }),
      records: domain.executionRecords,
      executions: domain.executions,
      capabilities: domain.capabilities,
      assignments: domain.assignments,
      actors: domain.actors,
      runtimes: domain.runtimes,
      deterministic:
        options.deterministic ??
        (options.tools && options.ports
          ? createGovernedToolInvoker({ tools: options.tools, ports: options.ports, ids: domain.ids, now: domain.now })
          : unavailableDeterministicInvoker()),
      dispatcher,
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.approvals ? { approvals: options.approvals } : {}),
      ...(options.businesses ? { businesses: options.businesses } : {}),
      missions: domain.missionRepository,
      // The authoritative task repository: the final preflight re-reads it and
      // fails closed unless the request matches, so it is never optional.
      tasks: domain.tasks,
      // The DENY default unless a caller composes another governor.
      ...(options.budget ? { budget: options.budget } : {}),
      ...(options.processId ? { processId: options.processId } : {}),
      ...(options.submissionTimeoutMs ? { submissionTimeoutMs: options.submissionTimeoutMs } : {}),
    });

  return new MissionOrchestrator({
    missions: domain.missions,
    tasks: domain.tasks,
    execution,
    executions: domain.executions,
    executionRecords: domain.executionRecords,
    reviews: domain.reviews,
    ids: domain.ids,
    now: domain.now,
    actors: domain.actors,
    assignments: domain.assignments,
    ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {}),
    ...(options.defaultReviewerActorId ? { defaultReviewerActorId: options.defaultReviewerActorId } : {}),
  });
}

/** The claim-ledger surface the default composition accepts (structural). */
export type ExecutionClaimRepositoryLike = InMemoryExecutionClaimRepository | ExecutionClaimRepository;

/**
 * A deterministic leg that CANNOT run, used when no local tool registry was
 * supplied. It refuses with a typed, non-retryable error instead of pretending
 * to execute: silently binding this leg to nothing would let a DETERMINISTIC
 * capability look dispatchable while having no handler behind it.
 */
export function unavailableDeterministicInvoker(): GovernedDeterministicInvoker {
  return {
    id: "governed.deterministic.unavailable",
    externalCalls: false,
    async invoke() {
      return {
        handleId: "deterministic_unavailable",
        status: "FAILED",
        error: {
          category: "UNSUPPORTED",
          message: "No local tool registry is composed, so no deterministic handler can run",
          retryable: false,
        },
      };
    },
  };
}
