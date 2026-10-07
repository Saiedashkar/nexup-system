import type { Clock, JsonObject } from "@/modules/ai-workforce/core/types";
import type { WorkforceDomain } from "../index";
import type { Actor } from "../actors/actor-contracts";
import { internalStrategyAnalystRegistration } from "../actors/strategy-actor";
import type { AgentRuntime } from "../runtimes/agent-runtime";
import { createHermesRuntimeFromEnv } from "../runtimes/hermes";

/**
 * The Internal Strategy Analyst, wired end to end.
 *
 *   Actor → capability assignment → runtime assignment → AgentRuntime
 *         → (Hermes) adapter → transport → provider
 *
 * This is the FIRST real actor connected to a real runtime. It exists so the
 * chain can be exercised (offline against the deterministic transport, live
 * against the production bridge) without inventing a test-only object: every
 * piece below is the production registry, the production assignment service and
 * the production runtime adapter.
 *
 * What it does NOT do: run the work. Starting an execution is the caller's
 * decision (the dispatcher, or a mission in Step 5). This function only makes
 * the actor ADDRESSABLE.
 */

export const STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID = "strategy.internal-brief";
export const STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION = "1.0.0";

export type StrategyAnalystBootstrapOptions = {
  /** Register THIS runtime for the actor. Defaults to the Hermes runtime from env. */
  runtime?: AgentRuntime;
  /** Environment for the default Hermes resolution (tests pass an explicit env). */
  env?: Record<string, string | undefined>;
  /** Optional injected fetch for the Hermes bridge (tests, offline proofs). */
  fetchImpl?: typeof fetch;
  /** Who grants the assignment. Defaults to the Founder (human authority). */
  grantedBy?: string;
  now?: Clock;
};

export type StrategyAnalystBootstrapResult =
  | {
      enabled: true;
      actor: Actor;
      actorId: string;
      capabilityId: string;
      capabilityVersion: string;
      assignmentId: string;
      runtimeId: string;
      runtime: AgentRuntime;
      reason: string;
    }
  | { enabled: false; reason: string };

/**
 * Registers the capability, the actor, its assignment and its runtime.
 *
 * Idempotent: an already-registered actor/capability/runtime is REUSED rather
 * than duplicated, so a bootstrap re-run cannot create a second identity or a
 * second assignment edge.
 */
export async function bootstrapStrategyAnalyst(
  domain: WorkforceDomain,
  options: StrategyAnalystBootstrapOptions = {},
): Promise<StrategyAnalystBootstrapResult> {
  // 1. The runtime. Either the caller supplies one (tests, offline proofs) or it
  //    is resolved from the environment exactly as production does it.
  let runtime = options.runtime;
  if (!runtime) {
    const built = createHermesRuntimeFromEnv(options.env ?? process.env, {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.now ? { now: options.now } : {}),
      ids: domain.ids,
    });
    if (!built.enabled) return { enabled: false, reason: built.reason };
    runtime = built.adapter;
  }

  if (!domain.runtimes.get(runtime.identity.id)) domain.runtimes.register(runtime);

  // 2. The actor, bound to THAT runtime — the binding can never name a ghost.
  const existingActor = await domain.actors.findBySlug("internal-strategy-analyst");
  const actor =
    existingActor ??
    (await domain.actors.register(
      internalStrategyAnalystRegistration({
        runtimeId: runtime.identity.id,
        runtimeType: runtime.identity.type,
        profileRef: readString(runtime.identity.metadata.profileRef),
        requiredCapabilities: [STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID],
        escalationTarget: options.grantedBy ?? "actor_founder",
      }),
    ));

  // 3. The capability it may run — a SKILL with an SOP reference, LOW risk, no
  //    external side effects, no approval gate of its own.
  const existingCapability = await domain.capabilities.get(STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID);
  const capability =
    existingCapability ??
    (await domain.capabilities.register({
      id: STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
      name: "Internal strategy brief",
      kind: "SKILL",
      version: STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
      description:
        "Summarise a bounded internal question into a short strategic brief. Read-only: no publishing, no messaging, no money, no external side effect.",
      owner: actor.id,
      status: "ACTIVE",
      riskLevel: "LOW",
      approvalRequirement: "NONE",
      runtimeRequirements: {
        requiredRuntimeTypes: [runtime.identity.type],
        supportsDeterministic: true,
        requiresRuntime: true,
      },
      procedureRef: "sop://strategy/internal-brief",
      tags: ["strategy", "read-only", "internal"],
      metadata: { harmless: true } satisfies JsonObject,
    }));

  // 4. The assignment edge — revocable authority, separate from the actor.
  const grantedBy = options.grantedBy ?? "actor_founder";
  const existingAssignment = domain.assignments
    .listForActor(actor.id)
    .find((row) => row.capabilityId === capability.id && row.capabilityVersion === capability.version);
  const assignment =
    existingAssignment ??
    (await domain.assignments.assign({
      actorId: actor.id,
      capabilityId: capability.id,
      capabilityVersion: capability.version,
      grantedBy,
      constraints: { maxRiskLevel: "MEDIUM" },
    }));

  return {
    enabled: true,
    actor,
    actorId: actor.id,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    assignmentId: assignment.id,
    runtimeId: runtime.identity.id,
    runtime,
    reason: `Internal Strategy Analyst bound to ${runtime.identity.id} (${runtime.identity.type}) with ${capability.id}@${capability.version}`,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
