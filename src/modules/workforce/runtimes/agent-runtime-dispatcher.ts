import type { AiWorkforceErrorCode } from "@/modules/ai-workforce/core/errors";
import { isAiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject } from "@/modules/ai-workforce/core/types";
import type { ActorRegistry } from "../actors/actor-registry";
import type { ActorAssignmentService } from "../assignments/actor-assignment-service";
import type { MissionService } from "../missions/mission-service";
import type { ActorId, CapabilityId, MissionId, RuntimeId, TraceId } from "../core/refs";
import type {
  AgentExecutionRecord,
  AgentExecutionStatus,
  AgentExecutionWaitOptions,
  AgentJobHandle,
  AgentJobRequest,
} from "./agent-runtime";
import { isAsyncAgentRuntime } from "./agent-runtime";
import type { RuntimeRegistry } from "./runtime-registry";

/**
 * Agent runtime dispatcher — the dispatch seam for runtime-bound jobs.
 *
 * This is DELIBERATELY separate from the Phase-1 tool-execution path. A
 * Phase-1 job runs a TOOL capability in-process; an agent-runtime job HOSTS a
 * job on a runtime (Hermes, later others). Routing the latter through the
 * Phase-1 preflight (which resolves a tool from the ToolRegistry) would be
 * wrong, so the seam is this dispatcher: it resolves the actor, its authority
 * and its runtime, and hands the job over — nothing more.
 *
 * It authorises NOTHING by itself: the approval loop and permission policy
 * still run upstream. What it does enforce, when the caller supplies the
 * registries, is the STRUCTURE of the hand-over:
 *
 *   - the capability must be ASSIGNED to the actor (an agent cannot invoke a
 *     capability it was never granted),
 *   - the runtime must be the actor's OWN binding (no cross-runtime dispatch),
 *   - a human actor is never sent to a machine runtime.
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
  /** Optional idempotency key; when absent the runtime derives one from jobId. */
  idempotencyKey?: string;
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
  | "RUNTIME_NOT_BOUND_TO_ACTOR"
  | "CAPABILITY_NOT_ASSIGNED"
  | "RUNTIME_UNRESOLVED";

export type AgentDispatchOutcome = {
  dispatched: boolean;
  reason?: AgentDispatchReason;
  runtimeId?: RuntimeId;
  handle?: { handleId: string; status: AgentExecutionStatus };
  status?: AgentExecutionStatus;
  output?: unknown;
  /** The provider-neutral execution record, when the runtime exposes one. */
  execution?: AgentExecutionRecord;
  error?: { code: AiWorkforceErrorCode; message: string };
};

export type AgentRuntimeDispatcherDeps = {
  runtimes: RuntimeRegistry;
  actors?: ActorRegistry;
  /**
   * When supplied, the dispatcher enforces that the actor holds an ACTIVE
   * assignment for the capability it is asked to run.
   */
  assignments?: ActorAssignmentService;
  missions?: MissionService;
};

/** A handle is only meaningful together with the runtime that minted it. */
export type AgentHandleRef = {
  runtimeId: RuntimeId;
  handleId: string;
};

export class AgentRuntimeDispatcher {
  constructor(private readonly deps: AgentRuntimeDispatcherDeps) {}

  /** Dispatches from an explicit input, waiting for the terminal result. */
  async dispatch(input: AgentDispatchInput): Promise<AgentDispatchOutcome> {
    const resolved = await this.resolve(input);
    if ("outcome" in resolved) return resolved.outcome;

    const { runtime, request } = resolved;
    try {
      const handle = await runtime.submitJob(request);
      const record = readExecutionRecord(runtime, handle.handleId);
      return this.startedOutcome(runtime.identity.id, handle, record);
    } catch (error) {
      return this.failureOutcome(runtime.identity.id, error);
    }
  }

  /**
   * Starts the work and returns as soon as the runtime has ACCEPTED it. The
   * handle is usable immediately: status, events, waiting and cancellation are
   * separately reachable while the execution runs.
   */
  async startJob(input: AgentDispatchInput): Promise<AgentDispatchOutcome> {
    const resolved = await this.resolve(input);
    if ("outcome" in resolved) return resolved.outcome;

    const { runtime, request } = resolved;
    try {
      if (isAsyncAgentRuntime(runtime)) {
        const handle = await runtime.startJob(request);
        const execution = await runtime.getExecution(handle.handleId);
        const outcome = this.startedOutcome(runtime.identity.id, handle, readExecutionRecord(runtime, handle.handleId));
        if (execution) outcome.execution = execution;
        return outcome;
      }
      const handle = await runtime.submitJob(request);
      return this.startedOutcome(runtime.identity.id, handle, readExecutionRecord(runtime, handle.handleId));
    } catch (error) {
      return this.failureOutcome(runtime.identity.id, error);
    }
  }

  /** The full execution record for a handle minted by `runtimes[ref.runtimeId]`. */
  async getExecution(ref: AgentHandleRef): Promise<AgentDispatchOutcome> {
    const runtime = this.deps.runtimes.get(ref.runtimeId);
    if (!runtime) {
      return {
        dispatched: false,
        reason: "RUNTIME_UNRESOLVED",
        runtimeId: ref.runtimeId,
        error: { code: "RUNTIME_NOT_FOUND", message: `No runtime registered with id "${ref.runtimeId}"` },
      };
    }
    try {
      if (isAsyncAgentRuntime(runtime)) {
        const execution = await runtime.getExecution(ref.handleId);
        if (!execution) {
          return {
            dispatched: false,
            runtimeId: ref.runtimeId,
            error: { code: "RUN_NOT_FOUND", message: `Runtime "${ref.runtimeId}" has no execution "${ref.handleId}"` },
          };
        }
        return this.executionOutcome(ref.runtimeId, execution);
      }
      const handle = await runtime.getExecutionStatus(ref.handleId);
      return this.startedOutcome(ref.runtimeId, handle, readExecutionRecord(runtime, handle.handleId));
    } catch (error) {
      return this.failureOutcome(ref.runtimeId, error);
    }
  }

  /** Waits for a handle to reach a terminal state. */
  async waitForExecution(ref: AgentHandleRef, options?: AgentExecutionWaitOptions): Promise<AgentDispatchOutcome> {
    const runtime = this.deps.runtimes.get(ref.runtimeId);
    if (!runtime) {
      return {
        dispatched: false,
        reason: "RUNTIME_UNRESOLVED",
        runtimeId: ref.runtimeId,
        error: { code: "RUNTIME_NOT_FOUND", message: `No runtime registered with id "${ref.runtimeId}"` },
      };
    }
    try {
      if (isAsyncAgentRuntime(runtime)) {
        const execution = await runtime.waitForExecution(ref.handleId, options);
        return this.executionOutcome(ref.runtimeId, execution);
      }
      const handle = await runtime.getExecutionStatus(ref.handleId);
      return this.startedOutcome(ref.runtimeId, handle, readExecutionRecord(runtime, handle.handleId));
    } catch (error) {
      return this.failureOutcome(ref.runtimeId, error);
    }
  }

  /**
   * Cancels through the AgentRuntime port — never by reaching for a transport.
   * Reachable while the execution is in flight.
   */
  async cancelJob(ref: AgentHandleRef, reason?: string): Promise<AgentDispatchOutcome> {
    const runtime = this.deps.runtimes.get(ref.runtimeId);
    if (!runtime) {
      return {
        dispatched: false,
        reason: "RUNTIME_UNRESOLVED",
        runtimeId: ref.runtimeId,
        error: { code: "RUNTIME_NOT_FOUND", message: `No runtime registered with id "${ref.runtimeId}"` },
      };
    }
    try {
      const handle = await runtime.cancelJob(ref.handleId, reason);
      const outcome = this.startedOutcome(ref.runtimeId, handle, readExecutionRecord(runtime, handle.handleId));
      if (isAsyncAgentRuntime(runtime)) {
        const execution = await runtime.getExecution(ref.handleId);
        if (execution) outcome.execution = execution;
      }
      return outcome;
    } catch (error) {
      return this.failureOutcome(ref.runtimeId, error);
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

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  /**
   * Resolves the actor, its authority and its runtime. Returns either the
   * refusal as an outcome, or the runtime + the neutral request to hand over.
   */
  private async resolve(
    input: AgentDispatchInput,
  ): Promise<{ outcome: AgentDispatchOutcome } | { runtime: ReturnType<RuntimeRegistry["require"]>; request: AgentJobRequest & { context?: AgentDispatchContext; idempotencyKey?: string } }> {
    // 1. A runtime reference is REQUIRED — otherwise this is a legacy job and
    //    the caller must use the local path.
    if (!input.runtimeId) return { outcome: { dispatched: false, reason: "NO_RUNTIME_REFERENCE" } };
    if (!input.actorId) return { outcome: { dispatched: false, reason: "NO_ACTOR" } };

    // 2. Resolve the actor when a registry is available: refuse to send a human
    //    actor to a machine runtime, and refuse cross-runtime dispatch.
    if (this.deps.actors) {
      const actor = await this.deps.actors.get(input.actorId);
      if (!actor) return { outcome: { dispatched: false, reason: "UNKNOWN_ACTOR" } };
      if (actor.type === "HUMAN") return { outcome: { dispatched: false, reason: "HUMAN_ACTOR" } };
      const boundRuntimeId = actor.runtimeBinding?.runtimeId;
      if (boundRuntimeId && boundRuntimeId !== input.runtimeId) {
        return {
          outcome: {
            dispatched: false,
            reason: "RUNTIME_NOT_BOUND_TO_ACTOR",
            runtimeId: input.runtimeId,
            error: {
              code: "RUNTIME_UNSUPPORTED",
              message: `Actor "${actor.slug}" is bound to runtime "${boundRuntimeId}", not "${input.runtimeId}"`,
            },
          },
        };
      }
    }

    // 3. Capability assignment. Opt-in: only enforced when the caller supplies
    //    the assignment service, so the legacy path is untouched.
    if (this.deps.assignments) {
      if (!input.capabilityId) {
        return {
          outcome: {
            dispatched: false,
            reason: "CAPABILITY_NOT_ASSIGNED",
            runtimeId: input.runtimeId,
            error: { code: "INVALID_ASSIGNMENT", message: "A dispatch on this path must name a capability" },
          },
        };
      }
      if (!this.deps.assignments.hasCapability(input.actorId, input.capabilityId, input.capabilityVersion)) {
        return {
          outcome: {
            dispatched: false,
            reason: "CAPABILITY_NOT_ASSIGNED",
            runtimeId: input.runtimeId,
            error: {
              code: "PERMISSION_DENIED",
              message: `Actor "${input.actorId}" has no active assignment for capability "${input.capabilityId}"`,
            },
          },
        };
      }
    }

    // 4. Resolve the runtime — a typed, honest failure (never a fake success).
    let runtime: ReturnType<RuntimeRegistry["require"]>;
    try {
      runtime = this.deps.runtimes.require(input.runtimeId);
    } catch (error) {
      const code: AiWorkforceErrorCode = isAiWorkforceError(error) ? error.code : "RUNTIME_NOT_FOUND";
      return {
        outcome: {
          dispatched: false,
          reason: "RUNTIME_UNRESOLVED",
          runtimeId: input.runtimeId,
          error: { code, message: error instanceof Error ? error.message : "Runtime could not be resolved" },
        },
      };
    }

    // 5. Build the neutral request. `context` is optional enrichment the
    //    adapter MAY read; a runtime that ignores it is unaffected.
    const request: AgentJobRequest & { context?: AgentDispatchContext; idempotencyKey?: string } = {
      actorId: input.actorId,
      capabilityId: input.capabilityId ?? "unspecified",
      traceId: input.traceId ?? input.jobId ?? "trace",
    };
    if (input.jobId) request.jobId = input.jobId;
    if (input.missionId) request.missionId = input.missionId;
    if (input.capabilityVersion) request.capabilityVersion = input.capabilityVersion;
    if (input.input) request.input = input.input;
    if (input.context) request.context = input.context;
    if (input.idempotencyKey) request.idempotencyKey = input.idempotencyKey;

    return { runtime, request };
  }

  private startedOutcome(
    runtimeId: RuntimeId,
    handle: AgentJobHandle,
    record: ExecutionRecordLike | null,
  ): AgentDispatchOutcome {
    const outcome: AgentDispatchOutcome = {
      dispatched: true,
      runtimeId,
      handle: { handleId: handle.handleId, status: handle.status },
      status: record?.status ?? handle.status,
    };
    if (record?.output !== undefined) outcome.output = record.output;
    else if (record?.outputText !== undefined) outcome.output = record.outputText;
    if (record?.error) {
      outcome.error = { code: "TOOL_EXECUTION_FAILED", message: record.error.message };
    }
    return outcome;
  }

  private executionOutcome(runtimeId: RuntimeId, execution: AgentExecutionRecord): AgentDispatchOutcome {
    const outcome: AgentDispatchOutcome = {
      dispatched: true,
      runtimeId,
      handle: { handleId: execution.handleId, status: execution.status },
      status: execution.status,
      execution,
    };
    if (execution.output !== undefined) outcome.output = execution.output;
    else if (execution.outputText !== undefined) outcome.output = execution.outputText;
    if (execution.error) {
      outcome.error = { code: "TOOL_EXECUTION_FAILED", message: execution.error.message };
    }
    return outcome;
  }

  private failureOutcome(runtimeId: RuntimeId, error: unknown): AgentDispatchOutcome {
    const code: AiWorkforceErrorCode = isAiWorkforceError(error) ? error.code : "RUNTIME_UNAVAILABLE";
    return {
      dispatched: false,
      reason: "RUNTIME_UNRESOLVED",
      runtimeId,
      error: { code, message: error instanceof Error ? error.message : "Runtime submit failed" },
    };
  }
}

type ExecutionRecordLike = {
  status?: AgentExecutionStatus;
  output?: unknown;
  outputText?: string;
  error?: { message: string };
};

/** Reads a normalized execution record if the runtime exposes one (adapter-owned). */
function readExecutionRecord(runtime: unknown, handleId: string): ExecutionRecordLike | null {
  const candidate = runtime as { getExecutionRecord?: (handleId: string) => unknown };
  if (typeof candidate.getExecutionRecord !== "function") return null;
  const record = candidate.getExecutionRecord(handleId) as ExecutionRecordLike | null;
  return record ?? null;
}
