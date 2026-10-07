import type { PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createIdFactory, systemClock } from "@/modules/ai-workforce/core/ids";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import type { WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";

import type { WorkforceDomain } from "../index";
import { createMissionOrchestrator, type MissionOrchestrator, type ReviewPolicy } from "../orchestration/mission-orchestrator";
import { bootstrapStrategyAnalyst } from "../orchestration/strategy-analyst";
import { execActorRegistration, founderActorRegistration } from "../actors/exec-actor";
import { createWorkforceDomainFromPrisma } from "../persistence/prisma-composition";
import { PrismaCommandIntentRepository } from "../persistence/prisma-command-intent-repository";
import type { AgentRuntime } from "../runtimes/agent-runtime";
import type { CommandCenterQueries } from "../queries/command-center";

import type { CommandTaskRouter } from "./command-contracts";
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
  /** Defaults to true. A composition with no runtime refuses to start. */
  requireRuntime?: boolean;
  /** Pre-built dispatcher, for a caller that wants its own. */
  orchestrator?: MissionOrchestrator;
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
  bootstrap: { persistence: "DATABASE"; externalCalls: false };
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

  const bootstrap = await bootstrapStrategyAnalyst(domain, {
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    now,
  });

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
  const orchestrator =
    options.orchestrator ??
    createMissionOrchestrator(domain, {
      defaultReviewerActorId: options.defaultReviewerActorId ?? FOUNDER,
      ...(options.reviewPolicy ? { reviewPolicy: options.reviewPolicy } : {}),
    });

  const commands = new WorkforceCommandService({ domain, orchestrator, intents, route });

  return {
    domain,
    orchestrator,
    commands,
    queries: domain.queries,
    intents,
    routing,
    bootstrap: { persistence: "DATABASE", externalCalls: false },
  };
}
