import type { PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createIdFactory, systemClock } from "@/modules/ai-workforce/core/ids";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";

import { ExecutionReconciler } from "../execution/execution-reconciler";
import {
  createConfiguredHumanActorResolver,
  type BusinessScopeResolver,
  type HumanActorResolver,
} from "../execution/authority-resolution";
import {
  createCapabilityExecutionService,
  type CapabilityExecutionServiceDeps,
  type DefaultCapabilityExecutionService,
  type ExecutionApprovalSource,
} from "../execution/capability-execution-service";
import { AgentRuntimeDispatcher } from "../runtimes/agent-runtime-dispatcher";
import { PrismaExecutionClaimRepository } from "../persistence/prisma-execution-claim-repository";
import { PrismaExecutionAttemptCommitter } from "../persistence/prisma-execution-attempt-committer";
import type { ExecutionClaimRepository } from "../execution/execution-claim";
import type { GovernedDeterministicInvoker } from "../execution/governed-deterministic-invoker";
import { createGovernedToolInvoker } from "../execution/governed-deterministic-invoker";
import type { BudgetGovernor } from "@/modules/ai-workforce/policies/budget-governor";
import type { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";
import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import type { WorkforceDomain } from "../index";
import { createMissionOrchestrator } from "../orchestration/create-mission-orchestrator";
import type { MissionOrchestrator, ReviewPolicy } from "../orchestration/mission-orchestrator";
import { bootstrapStrategyAnalyst } from "../orchestration/strategy-analyst";
import { registerReadOnlyWorkforceCapabilities } from "../execution/workforce-read-only-capabilities";
import { execActorRegistration, founderActorRegistration, humanActorRegistration } from "../actors/exec-actor";
import type { ActorRegistrationInput } from "../actors/actor-contracts";
import { createWorkforceDomainFromPrisma } from "../persistence/prisma-composition";
import { PrismaCommandIntentRepository } from "../persistence/prisma-command-intent-repository";
import type { AgentRuntime } from "../runtimes/agent-runtime";
import type { CommandCenterQueries } from "../queries/command-center";

import type { CommandTaskRouter } from "./command-contracts";
import { MissionAccessService } from "./mission-access";
import { WorkforceCommandService } from "./command-service";

/**
 * The APPLICATION composition — how a running NEXUP gets a workforce.
 *
 * The audit's remaining architectural gap was that the dispatcher, the
 * orchestrator and the durable repositories existed but nothing in the running
 * application constructed them. This factory is that missing caller, and it
 * makes three choices explicit so no route has to make them per request:
 *
 *   1. DURABLE OR NOTHING. It takes a database client, not a persistence mode.
 *      The in-memory repositories remain the default inside `@/modules/workforce`
 *      for unit tests, but an application never composes them: process memory
 *      must not be the source of truth.
 *   2. A REAL RUNTIME. Either the caller supplies one (the offline proofs hand in
 *      the real Hermes adapter over a deterministic transport, with an explicit
 *      `allowTestTransport` opt-in) or it is resolved from the environment
 *      exactly as production resolves it. By default a composition with no
 *      usable runtime REFUSES to start, because an application that can create
 *      missions nothing can execute is worse than one that will not boot.
 *   3. ONE ROUTE. A Command's tasks may name an actor and a capability, but when
 *      they do not, the composition routes them to the registered Strategy
 *      Analyst and its capability. Routing fills in WHERE the work goes; it does
 *      not authorise anything — the dispatcher still checks the assignment and
 *      the runtime binding, and refuses a task whose authority is missing.
 */

export type WorkforceApplicationOptions = {
  /** Explicitly disable the durable atomic finalizer (offline proofs only). */
  committerDisabled?: boolean;
  ids?: IdFactory;
  now?: Clock;
  /** The runtime a task is dispatched to. Defaults to the Hermes runtime from env. */
  runtime?: AgentRuntime;
  /** Environment for the default Hermes resolution. */
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  reviewPolicy?: ReviewPolicy;
  /** The human who decides when a mission's owner is not a person. */
  defaultReviewerActorId?: string;
  /**
   * Config-seeded `userId → actorId` mapping for the authenticated HUMAN actor
   * roster. Empty by default: an unmapped user FAILS CLOSED (AUTHORITY_UNRESOLVED)
   * rather than impersonating the Founder. The durable roster is a later gap.
   */
  humanActorMap?: Record<string, readonly string[]>;
  /** The authoritative business registry used for scope checks. Absent = none can be verified. */
  businessScope?: BusinessScopeResolver;
  /**
   * ADDITIONAL human authorities to register alongside the Founder, as
   * `{ id, slug, displayName }`. Empty by default.
   *
   * These exist so a proof can attribute a decision to a NAMED person rather than
   * the Founder channel, which is the only way to demonstrate that a decision's
   * identity follows the authenticated user's resolution instead of a constant.
   * The running application supplies them ONLY in proof mode (a verified loopback
   * database with the deterministic test transport); production passes none, so
   * this is not a roster and not a production configuration surface.
   */
  humanActorSeeds?: ReadonlyArray<{ id: string; slug: string; displayName: string; role?: string }>;
  /** Defaults to true. A composition with no runtime refuses to start. */
  requireRuntime?: boolean;
  /** Pre-built dispatcher, for a caller that wants its own. */
  orchestrator?: MissionOrchestrator;
  /**
   * The execution boundary, when a caller composes its own. By default the
   * application builds the production one: the DURABLE claim ledger, the ATOMIC
   * finalizer, the default DENY budget governor and the internal dispatcher.
   */
  execution?: DefaultCapabilityExecutionService;
  /** Override individual execution dependencies (a test composes its own governor). */
  claims?: ExecutionClaimRepository;
  budget?: BudgetGovernor;
  tools?: ToolRegistry;
  ports?: WorkforcePorts;
  approvals?: ExecutionApprovalSource;
  deterministic?: GovernedDeterministicInvoker;
  /**
   * Register + assign the read-only deterministic capabilities to the routed
   * actor (Step 5A-4 correction, P1-7). The RUNNING application sets this, so a
   * genuinely executable `NO_VARIABLE_COST` path exists without weakening the
   * default budget governor.
   */
  registerReadOnlyCapabilities?: boolean;
  submissionTimeoutMs?: number;
  /** Skip the durable atomic finalizer (offline proofs against a stale DB). */
  committer?: CapabilityExecutionServiceDeps["committer"];
};

export type WorkforceRouting = {
  /** False when no runtime could be resolved: tasks will not dispatch. */
  enabled: boolean;
  reason: string;
  actorId?: string;
  capabilityId?: string;
  capabilityVersion?: string;
  runtimeId?: string;
};

export type WorkforceApplication = {
  domain: WorkforceDomain;
  orchestrator: MissionOrchestrator;
  commands: WorkforceCommandService;
  /** Read-only surfaces for the Command Center (Step 6 draws them). */
  queries: CommandCenterQueries;
  /** The durable idempotency ledger this application claims commands in. */
  intents: PrismaCommandIntentRepository;
  routing: WorkforceRouting;
  /** Resolves an authenticated user to the HUMAN actor that represents them. */
  humanActors: HumanActorResolver;
  /** The authoritative business registry, when one is configured. */
  businesses?: BusinessScopeResolver;
  /** Business-scope authorization over mission/review/query surfaces. */
  access: MissionAccessService;
  bootstrap: { persistence: "DATABASE"; externalCalls: false };
  /** The provider-neutral re-adoption service (restart recovery). */
  reconciler: ExecutionReconciler;
  /**
   * The SINGLE execution-policy boundary. It is exposed so a caller can inspect
   * a preflight verdict ("why will this task not start?") without executing it,
   * and so the reconciliation path shares the SAME service the mission path uses.
   */
  execution: DefaultCapabilityExecutionService;
  /** Closes the pool this application owns, when it owns one. */
  disconnect?: () => Promise<void>;
};

const FOUNDER = "actor_founder";

/**
 * A real Prisma client, not a handle. `PrismaClient` itself exposes a `client`
 * property (an internal object with no delegates), so "has a `.client`" is NOT a
 * safe test — resolving twice must stay idempotent.
 */
function isPrismaClientLike(value: unknown): boolean {
  const candidate = value as Record<string, unknown> | null | undefined;
  return !!candidate && typeof candidate["$transaction"] === "function";
}

function resolveClient(handleOrClient: WorkforcePrismaHandle | PrismaClient): PrismaClient {
  if (isPrismaClientLike(handleOrClient)) return handleOrClient as PrismaClient;
  const candidate = handleOrClient as Partial<WorkforcePrismaHandle>;
  return (candidate.client ?? (handleOrClient as PrismaClient)) as PrismaClient;
}

/**
 * @throws PERSISTENCE_UNAVAILABLE when the database has no lifecycle or ledger
 *         tables, at composition time rather than on the first command.
 * @throws RUNTIME_UNAVAILABLE when no runtime could be resolved and
 *         `requireRuntime` was not disabled.
 */
export async function createWorkforceApplication(
  handleOrClient: WorkforcePrismaHandle | PrismaClient,
  options: WorkforceApplicationOptions = {},
): Promise<WorkforceApplication> {
  const client = resolveClient(handleOrClient);
  const ids = options.ids ?? createIdFactory();
  const now = options.now ?? systemClock();

  const domain = createWorkforceDomainFromPrisma(client, { ids, now });
  await domain.actors.register(execActorRegistration());
  await domain.actors.register(founderActorRegistration());
  for (const seed of options.humanActorSeeds ?? []) {
    const registration: ActorRegistrationInput = humanActorRegistration(seed);
    // Idempotent, like the two seeds above: a re-composed process must not fail
    // because the actor already exists.
    const existing = await domain.actors.get(registration.id);
    if (!existing) await domain.actors.register(registration);
  }

  const bootstrap = await bootstrapStrategyAnalyst(domain, {
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    now,
  });

  // The read-only deterministic capabilities are registered and ASSIGNED only
  // when the running application asks for them. The actor is the routed one, so
  // the deterministic leg is reachable through the SAME routing the runtime leg
  // uses, and still executes only through the Capability Execution Service.
  if (options.registerReadOnlyCapabilities && options.tools && bootstrap.enabled) {
    await registerReadOnlyWorkforceCapabilities(domain, {
      actorId: bootstrap.actorId,
      grantedBy: bootstrap.actorId,
    });
  }

  let routing: WorkforceRouting;
  let route: CommandTaskRouter;
  if (bootstrap.enabled) {
    routing = {
      enabled: true,
      reason: bootstrap.reason,
      actorId: bootstrap.actorId,
      capabilityId: bootstrap.capabilityId,
      capabilityVersion: bootstrap.capabilityVersion,
      runtimeId: bootstrap.runtimeId,
    };
    route = (task) => ({
      assignedActorId: task.assignedActorId ?? bootstrap.actorId,
      requiredCapabilityId: task.requiredCapabilityId ?? bootstrap.capabilityId,
      ...(task.requiredCapabilityVersion ?? bootstrap.capabilityVersion
        ? { requiredCapabilityVersion: task.requiredCapabilityVersion ?? bootstrap.capabilityVersion }
        : {}),
    });
  } else {
    if (options.requireRuntime !== false) {
      throw new AiWorkforceError("RUNTIME_UNAVAILABLE", `Workforce application cannot start: ${bootstrap.reason}`, {
        reason: bootstrap.reason,
      });
    }
    routing = { enabled: false, reason: bootstrap.reason };
    route = (task) => ({
      assignedActorId: task.assignedActorId ?? null,
      requiredCapabilityId: task.requiredCapabilityId ?? null,
      ...(task.requiredCapabilityVersion ? { requiredCapabilityVersion: task.requiredCapabilityVersion } : {}),
    });
  }

  const intents = new PrismaCommandIntentRepository({ client, ids, now });

  // ── The execution boundary, composed HERE so no route can build a service
  //    with a different claim ledger or a weaker budget posture. ──
  // The SAME claim ledger is handed to the execution service and to the
  // reconciler, so "what is in flight" has one answer in this process.
  const claims = options.claims ?? new PrismaExecutionClaimRepository({ client, ids });
  const committer = options.committerDisabled
    ? undefined
    : (options.committer ?? new PrismaExecutionAttemptCommitter({ client }));

  const deterministic: GovernedDeterministicInvoker =
    options.deterministic ??
    (options.tools && options.ports
      ? createGovernedToolInvoker({ tools: options.tools, ports: options.ports, ids, now })
      : {
          id: "governed.deterministic.unavailable",
          externalCalls: false,
          invoke: async () => ({
            handleId: "deterministic_unavailable",
            status: "FAILED" as const,
            error: {
              category: "UNSUPPORTED" as const,
              message: "No local tool registry is composed, so no deterministic handler can run",
              retryable: false,
            },
          }),
        } satisfies GovernedDeterministicInvoker);

  const execution =
    options.execution ??
    createCapabilityExecutionService({
      ids,
      now,
      claims,
      records: domain.executionRecords,
      executions: domain.executions,
      capabilities: domain.capabilities,
      assignments: domain.assignments,
      actors: domain.actors,
      runtimes: domain.runtimes,
      deterministic,
      dispatcher: new AgentRuntimeDispatcher({
        runtimes: domain.runtimes,
        actors: domain.actors,
        assignments: domain.assignments,
      }),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.approvals ? { approvals: options.approvals } : {}),
      ...(options.businessScope ? { businesses: options.businessScope } : {}),
      missions: domain.missionRepository,
      // The authoritative task repository: the final preflight re-reads it.
      tasks: domain.tasks,
      // The DENY default: an application that supplies nothing gets the shipped
      // zero-variable-spend posture, never an implicit allow.
      ...(options.budget ? { budget: options.budget } : {}),
      ...(options.submissionTimeoutMs ? { submissionTimeoutMs: options.submissionTimeoutMs } : {}),
      ...(committer ? { committer } : {}),
    });

  const orchestrator =
    options.orchestrator ??
    createMissionOrchestrator(domain, {
      execution,
      defaultReviewerActorId: options.defaultReviewerActorId ?? FOUNDER,
      ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {}),
    });

  // Recovery is composed HERE, with the orchestrator it must settle through, so
  // an application can never be built that dispatches work but cannot re-adopt
  // it after the next restart.
  const reconciler = new ExecutionReconciler({
    records: domain.executionRecords,
    executions: domain.executions,
    runtimes: domain.runtimes,
    missions: domain.missionRepository,
    tasks: domain.tasks,
    orchestrator,
    // Claim-aware (Step 5A-4): the sweep reads the DELIVERY ledger too, so an
    // attempt that was entered but never identified is escalated to a human
    // instead of being invisibly stranded.
    claims,
    now,
  });

  const commands = new WorkforceCommandService({ domain, orchestrator, intents, route, reconciler });

  // Authenticated authority, resolved from SERVER-SIDE configuration. The map is
  // empty unless the operator seeds it, so the default posture is fail-closed.
  const humanActors = createConfiguredHumanActorResolver({
    directory: domain.actors,
    mapping: options.humanActorMap ?? {},
  });
  const access = new MissionAccessService({
    missions: domain.missions,
    missionList: domain.missionRepository,
    reviews: domain.reviews,
    ...(options.businessScope ? { businesses: options.businessScope } : {}),
  });

  return {
    domain,
    orchestrator,
    commands,
    queries: domain.queries,
    intents,
    reconciler,
    routing,
    humanActors,
    execution,
    ...(options.businessScope ? { businesses: options.businessScope } : {}),
    access,
    bootstrap: { persistence: "DATABASE", externalCalls: false },
  };
}
