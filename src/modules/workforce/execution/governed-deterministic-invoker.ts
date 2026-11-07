import { AiWorkforceError, toErrorPayload } from "@/modules/ai-workforce/core/errors";
import type { ExecutionContext } from "@/modules/ai-workforce/core/execution-context";
import type { Clock, IdFactory, JsonObject } from "@/modules/ai-workforce/core/types";
import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { validateValue, type ObjectSchema } from "@/modules/ai-workforce/core/schema";
import { resolveCapability, resolveCapabilityExact } from "@/modules/ai-workforce/registry/capability-lookup";
import type { ToolDefinition } from "@/modules/ai-workforce/registry/tool-definition";
import type { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";

import type { ActorId, MissionId, TaskId } from "../core/refs";
import type { AgentExecutionError, AgentExecutionStatus } from "../runtimes/agent-runtime";

/**
 * The GOVERNED DETERMINISTIC INVOKER — the `DETERMINISTIC` leg of capability
 * execution, WITHOUT the Phase-1 run lifecycle.
 *
 * WHY THIS IS NOT `LocalRuntimeAdapter`. That adapter is the Phase-1 engine's
 * runtime and it opens an `AiRun` (and writes audit events through the Phase-1
 * recorder) for every execution it performs. Mission execution must NOT create
 * `AiJob` / `AiRun` / `AiRunEvent` rows — a mission attempt has exactly ONE
 * audit spine, the mission execution record — so reusing the adapter unchanged
 * would have created the second lifecycle Step 5A-4 is forbidden to introduce.
 *
 * What is reused from Phase 1 is the part that carries the governance: the
 * capability is resolved from the SAME `ToolRegistry`, the input is validated
 * against the SAME declared schema, the handler is called with the SAME
 * `{ context, ports, ids, now }` shape, and a failure is reported as the SAME
 * typed error. What is dropped is only the run/audit bookkeeping, which belongs
 * to the Phase-1 job engine and is replaced here by the mission execution
 * record's own PREFLIGHT/REQUESTED/TERMINAL trail.
 *
 * The classification field `externalCalls` is part of the interface on purpose:
 * it is what the execution service reports in a preflight receipt, and it is
 * what makes this leg honestly `NO_VARIABLE_COST`. A handler that quietly
 * reached a network would be lying in its own declaration, which is why the
 * registry that owns it is the ONLY thing allowed to say so.
 */

/** What a deterministic invocation produced. Shaped like a runtime handle, not a run. */
export type GovernedDeterministicResult = {
  /** The deterministic execution's own reference. Locally minted; never a provider id. */
  handleId: string;
  status: AgentExecutionStatus;
  output?: unknown;
  outputText?: string;
  error?: AgentExecutionError;
  /** How long the handler took, for the audit trail. */
  durationMs?: number;
};

export type GovernedDeterministicInvokeInput = {
  /** The descriptor the execution service already authorised. */
  descriptor: ToolDefinition;
  /**
   * The EXACT authorise version, when the caller pinned one.
   *
   * Capability identity is `id + version`, so the handler that runs must be the
   * handler at the AUTHORISED version — never whichever version happens to be
   * registered under that id. When supplied, resolution is exact and a mismatch
   * is a typed refusal rather than a silent execution of a different contract.
   */
  descriptorVersion?: string;
  input: JsonObject;
  context: ExecutionContext;
  /** The deterministic attempt key, so a re-invocation is recognisably the same attempt. */
  attemptKey: string;
  missionId?: MissionId;
  taskId?: TaskId;
  actorId?: ActorId;
};

export interface GovernedDeterministicInvoker {
  /** Stable id recorded on the receipt and the execution record. */
  readonly id: string;
  /**
   * Whether this invoker can reach anything outside the process. ALWAYS false
   * for an implementation of this port; the field exists so the execution
   * service can assert it rather than trust it.
   */
  readonly externalCalls: boolean;
  invoke(input: GovernedDeterministicInvokeInput): Promise<GovernedDeterministicResult>;
}

export type GovernedToolInvokerDeps = {
  tools: ToolRegistry;
  ports: WorkforcePorts;
  ids: IdFactory;
  now: Clock;
};

/**
 * The production deterministic invoker: a real, governed, in-process tool call.
 *
 * It performs NO network I/O and writes NO run row. Every failure is typed, so
 * the execution service can map it onto the attempt's audit trail rather than
 * guessing at an exception.
 */
/**
 * The ENVELOPE keys the platform may add to a task's input on its own.
 *
 * `instruction` is the bounded prompt handed to an AGENT (the command layer
 * folds it into `input.instruction`, and the Hermes mapping reads it from
 * there). It is NOT an argument of a deterministic TOOL: `capital.summary`
 * declares no fields at all, so an undeclared `instruction` used to fail
 * validation and turn every read-only mission attempt into a FAILED execution.
 *
 * A key here is dropped from the input ONLY when the target schema does not
 * declare it. A tool that genuinely wants an `instruction` argument keeps it,
 * and any OTHER undeclared key is still a hard validation failure — this is a
 * narrow projection of the platform's own envelope, not a relaxation of the
 * tool contract.
 */
const PLATFORM_ENVELOPE_KEYS: readonly string[] = ["instruction"];

/** Remove the platform's envelope keys the schema does not declare. */
function toolFacingInput(schema: ObjectSchema, input: JsonObject): JsonObject {
  const declared = schema.fields;
  const projected: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (PLATFORM_ENVELOPE_KEYS.includes(key) && !Object.prototype.hasOwnProperty.call(declared, key)) {
      continue;
    }
    projected[key] = value;
  }
  return projected;
}

export function createGovernedToolInvoker(deps: GovernedToolInvokerDeps): GovernedDeterministicInvoker {
  return {
    id: "governed.deterministic.tool",
    externalCalls: false,
    async invoke(input) {
      const startedAt = deps.now().getTime();
      const handlerId = deps.ids.next("detexec");
      const handlerContext = { context: input.context, ports: deps.ports, ids: deps.ids, now: deps.now };

      const fail = (error: unknown): GovernedDeterministicResult => ({
        handleId: handlerId,
        status: "FAILED",
        durationMs: deps.now().getTime() - startedAt,
        error: {
          category: "RUNTIME_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      });

      let resolved: ReturnType<typeof resolveCapability>;
      try {
        // EXACT when a version was authorised; by id only when none was.
        resolved = input.descriptorVersion
          ? resolveCapabilityExact(deps.tools, input.descriptor.id, input.descriptorVersion)
          : resolveCapability(deps.tools, input.descriptor.id);
      } catch (error) {
        return fail(error);
      }

      const validated = validateValue(
        resolved.definition.inputSchema,
        toolFacingInput(resolved.definition.inputSchema, input.input ?? {}),
      );
      if (validated.kind === "invalid") {
        const message = validated.issues
          .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
          .join("; ");
        return {
          handleId: handlerId,
          status: "FAILED",
          durationMs: deps.now().getTime() - startedAt,
          error: {
            category: "INVALID_REQUEST",
            message: `Invalid input for "${resolved.definition.id}": ${message}`,
            retryable: false,
          },
        };
      }

      try {
        const output = await resolved.handler(validated.value, handlerContext);
        const result: GovernedDeterministicResult = {
          handleId: handlerId,
          status: "SUCCEEDED",
          output,
          durationMs: deps.now().getTime() - startedAt,
        };
        if (typeof output === "string") result.outputText = output;
        return result;
      } catch (error) {
        const payload = toErrorPayload(error);
        // A typed refusal is not an outage: record what it actually was.
        return {
          handleId: handlerId,
          status: "FAILED",
          durationMs: deps.now().getTime() - startedAt,
          error: {
            category: error instanceof AiWorkforceError ? "BLOCKED" : "RUNTIME_ERROR",
            message: payload.message,
            retryable: false,
          },
        };
      }
    },
  };
}
