import type { AiWorkforceErrorCode } from "@/modules/ai-workforce/core/errors";
import { isAiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject } from "@/modules/ai-workforce/core/types";
import type { ActorRegistry } from "../actors/actor-registry";
import type { MissionService } from "../missions/mission-service";
import type { ActorId, CapabilityId, MissionId, RuntimeId, TraceId } from "../core/refs";
import type { AgentExecutionStatus, AgentJobRequest } from "./agent-runtime";
import type { RuntimeRegistry } from "./runtime-registry";

/**
 * Agent runtime dispatcher — the dispatch seam for runtime-bound jobs.
 *
 * This is DELIBERATELY separate from the Phase-1 tool-execution path. A
 * Phase-1 job runs a TOOL capability in-process; an agent-runtime job HOSTS a
 * job on a runtime (Hermes, later others). Routing the latter through the
 * Phase-1 preflight (which resolves a tool from the ToolRegistry) would be
 * wrong, so the seam is this dispatcher: it resolves the actor + runtime and
 * hands the job over — nothing more.
 *
 * It authorises NOTHING. It receives an already-authorized job (the approval
 * loop and permission policy ran upstream) and only decides WHERE execution
 * happens.
 *
 * A missing runtime reference is a first-class, non-error answer: legacy jobs
 * have none, and they keep using the local path untouched.
 */

/** Neutral, adapter-agnostic enrichment carried into the runtime request. */
export type AgentDispatchContext = {
  actorRole?: string;
  actorType?: string;
  missionTitle?: string;
  missionGoal?: string;
  approvalRequired?: boolean;
  approvalState?: string;
  contextRefs?: string[];
};

export type AgentDispatchInput = {
  actorId?: ActorId;
  runtimeId?: RuntimeId;
  capabilityId?: CapabilityId;
  capabilityVersion?: string;
  missionId?: MissionId;
  jobId?: string;
  input?: JsonObject;
  traceId?: TraceId;
  context?: AgentDispatchContext;
};

/** The subset of a Job the dispatcher needs (structural, so no coupling). */
export type AgentJobLike = {
  id: string;
  actorId?: string;
  runtimeId?: string;
  capabilityId?: string;
  missionId?: string;
  correlationId: string;
  input?: JsonObject;
  resolvedToolId?: string;
};

export type AgentDispatchReason =
  | "NO_RUNTIME_REFERENCE"
  | "NO_ACTOR"
  | "HUMAN_ACTOR"
  | "UNKNOWN_ACTOR"
  | "RUNTIME_UNRESOLVED";

export type AgentDispatchOutcome = {
  dispatched: boolean;
  reason?: AgentDispatchReason;
  runtimeId?: RuntimeId;
  handle?: { handleId: string; status: AgentExecutionStatus };
  status?: AgentExecutionStatus;
  output?: unknown;
  error?: { code: AiWorkforceErrorCode; message: string };
};

export type AgentRuntimeDispatcherDeps = {
  runtimes: RuntimeRegistry;
  actors?: ActorRegistry;
  missions?: MissionService;
};

export class AgentRuntimeDispatcher {
  constructor(private readonly deps: AgentRuntimeDispatcherDeps) {}

  /** Dispatches from an explicit input. */
  async dispatch(input: AgentDispatchInput): Promise<AgentDispatchOutcome> {
    // 1. A runtime reference is REQUIRED — otherwise this is a legacy job and
    //    the caller must use the local path.
    if (!input.runtimeId) return { dispatched: false, reason: "NO_RUNTIME_REFERENCE" };
    if (!input.actorId) return { dispatched: false, reason: "NO_ACTOR" };

    // 2. Resolve the actor when a registry is available, and refuse to send a
    //    human actor to a machine runtime (humans are first-class WITHOUT one).
    if (this.deps.actors) {
      const actor = await this.deps.actors.get(input.actorId);
      if (!actor) return { dispatched: false, reason: "UNKNOWN_ACTOR" };
      if (actor.type === "HUMAN") return { dispatched: false, reason: "HUMAN_ACTOR" };
    }

    // 3. Resolve the runtime — a typed, honest failure (never a fake success).
    let runtime;
    try {
      runtime = this.deps.runtimes.require(input.runtimeId);
    } catch (error) {
      const code: AiWorkforceErrorCode = isAiWorkforceError(error) ? error.code : "RUNTIME_NOT_FOUND";
      return {
        dispatched: false,
        reason: "RUNTIME_UNRESOLVED",
        runtimeId: input.runtimeId,
        error: { code, message: error instanceof Error ? error.message : "Runtime could not be resolved" },
      };
    }

    // 4. Build the neutral request. `context` is optional enrichment the
    //    adapter MAY read; a runtime that ignores it is unaffected.
    const request: AgentJobRequest & { context?: AgentDispatchContext } = {
      actorId: input.actorId,
      capabilityId: input.capabilityId ?? "unspecified",
      traceId: input.traceId ?? input.jobId ?? "trace",
    };
    if (input.jobId) request.jobId = input.jobId;
    if (input.missionId) request.missionId = input.missionId;
    if (input.capabilityVersion) request.capabilityVersion = input.capabilityVersion;
    if (input.input) request.input = input.input;
    if (input.context) request.context = input.context;

    // 5. Hand over. Any thrown error is normalized, never swallowed silently.
    try {
      const handle = await runtime.submitJob(request);
      const record = readExecutionRecord(runtime, handle.handleId);
      const outcome: AgentDispatchOutcome = {
        dispatched: true,
        runtimeId: runtime.identity.id,
        handle: { handleId: handle.handleId, status: handle.status },
        status: record?.status ?? handle.status,
      };
      if (record?.output !== undefined) outcome.output = record.output;
      else if (record?.outputText !== undefined) outcome.output = record.outputText;
      if (record?.error) {
        outcome.error = { code: "TOOL_EXECUTION_FAILED", message: record.error.message };
      }
      return outcome;
    } catch (error) {
      const code: AiWorkforceErrorCode = isAiWorkforceError(error) ? error.code : "RUNTIME_UNAVAILABLE";
      return {
        dispatched: false,
        reason: "RUNTIME_UNRESOLVED",
        runtimeId: runtime.identity.id,
        error: { code, message: error instanceof Error ? error.message : "Runtime submit failed" },
      };
    }
  }

  /** Dispatches directly from a Job-like record, enriching from the registries. */
  async dispatchJob(job: AgentJobLike): Promise<AgentDispatchOutcome> {
    const context: AgentDispatchContext = {};

    if (this.deps.actors && job.actorId) {
      const actor = await this.deps.actors.get(job.actorId);
      if (actor) {
        context.actorRole = actor.role;
        context.actorType = actor.type;
        context.approvalRequired = actor.approvalPolicy.mode !== "NEVER" && actor.approvalPolicy.mode !== "INHERIT";
        context.approvalState = actor.approvalPolicy.mode;
      }
    }

    if (this.deps.missions && job.missionId) {
      const mission = await this.deps.missions.get(job.missionId);
      if (mission) {
        context.missionTitle = mission.title;
        context.missionGoal = mission.goal;
      }
    }

    const input: AgentDispatchInput = {
      actorId: job.actorId,
      runtimeId: job.runtimeId,
      capabilityId: job.capabilityId,
      missionId: job.missionId,
      jobId: job.id,
      traceId: job.correlationId,
      context,
    };
    if (job.input) input.input = job.input;
    return this.dispatch(input);
  }
}

/** Reads a normalized execution record if the runtime exposes one (adapter-owned). */
function readExecutionRecord(
  runtime: { getExecutionRecord?: (handleId: string) => unknown },
  handleId: string,
): { status?: AgentExecutionStatus; output?: unknown; outputText?: string; error?: { message: string } } | null {
  if (typeof runtime.getExecutionRecord !== "function") return null;
  const record = runtime.getExecutionRecord(handleId) as
    | { status?: AgentExecutionStatus; output?: unknown; outputText?: string; error?: { message: string } }
    | null;
  return record ?? null;
}
