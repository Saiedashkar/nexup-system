import { AiWorkforceError, isAiWorkforceError, toErrorPayload, type AiWorkforceErrorCode } from "../core/errors";
import type { PermissionToken } from "../core/execution-context";
import { PERMISSION_TOKENS } from "../core/execution-context";
import type { Clock, IdFactory, JsonObject } from "../core/types";
import type { ToolHandler, WorkforcePorts } from "../core/ports";
import { validateValue, type ValidationIssue } from "../core/schema";
import type { AuditEventType, RunRecorder } from "../audit/run-recorder";
import type { ApprovalGate } from "../approvals/approval-gate";
import { notEvaluatedDecision, PermissionPolicy } from "../policies/permission-policy";
import { resolveCapability } from "../registry/capability-lookup";
import type { ToolDefinition } from "../registry/tool-definition";
import type { ToolRegistry } from "../registry/tool-registry";
import type {
  PersistenceKind,
  RuntimeAdapter,
  RuntimeDescription,
  RuntimeExecutionRequest,
  RuntimeExecutionResult,
  RuntimeKind,
  RuntimePreflight,
} from "./runtime-adapter";

/**
 * Local runtime adapter.
 *
 * Deterministic, in-process execution with no AI provider, no tokens and no
 * external calls. It proves the full path:
 *
 *   capability lookup → input validation → permission policy → approval gate
 *   → tool execution → result → audit
 *
 * Every later adapter (Hermes / OpenAI / Claude / Gemini) implements the same
 * interface; nothing in the control core changes when one is added.
 */

export type LocalRuntimeDeps = {
  registry: ToolRegistry;
  ports: WorkforcePorts;
  permissions: PermissionPolicy;
  approvals: ApprovalGate;
  recorder: RunRecorder;
  ids: IdFactory;
  now: Clock;
  /** Injected so retry backoff is instant in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Where runs/audit actually live — reported, never assumed. */
  persistence?: PersistenceKind;
};

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join("; ");
}

/** Tool input as stored on the run — records are JSON, so it must be plain. */
function recordedInput(input: JsonObject | undefined): JsonObject {
  return input ?? {};
}

export class LocalRuntimeAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = "LOCAL";

  constructor(private readonly deps: LocalRuntimeDeps) {}

  /* ═══════════════════════════════════════════════════
     Description (used by the health endpoint / UI)
     ═══════════════════════════════════════════════════ */

  describe(): RuntimeDescription {
    const tools = this.deps.registry.list();
    return {
      kind: this.kind,
      aiProvider: "NONE",
      persistence: this.deps.persistence ?? "IN_MEMORY",
      externalCalls: false,
      tools: {
        total: tools.length,
        enabled: tools.filter((tool) => tool.enabled).length,
        read: tools.filter((tool) => tool.readWriteMode === "READ").length,
        write: tools.filter((tool) => tool.readWriteMode === "WRITE").length,
        requiresApproval: tools.filter((tool) => tool.requiresApproval).length,
      },
      permissionTokens: PERMISSION_TOKENS as readonly PermissionToken[],
      notes: [
        "Deterministic local execution — no AI provider is contacted.",
        (this.deps.persistence ?? "IN_MEMORY") === "DATABASE"
          ? "Jobs, runs, approvals and audit events are persisted through repository adapters."
          : "Jobs, runs, approvals and audit events live in the injected in-memory repositories.",
        "No external calls; business data is only ever reached through read ports.",
      ],
    };
  }

  /* ═══════════════════════════════════════════════════
     Preflight (no side effects)
     ═══════════════════════════════════════════════════ */

  async preflight(request: RuntimeExecutionRequest): Promise<RuntimePreflight> {
    let definition: ToolDefinition;
    try {
      definition = resolveCapability(this.deps.registry, request.capability).definition;
    } catch (error) {
      const payload = toErrorPayload(error);
      return {
        capability: request.capability,
        resolved: false,
        tool: null,
        inputValid: false,
        inputIssues: [],
        normalizedInput: null,
        permission: notEvaluatedDecision(payload.message),
        approval: null,
        blocked: true,
        blockedCode: payload.code,
        blockedMessage: payload.message,
      };
    }

    const validated = validateValue(definition.inputSchema, request.input ?? {});
    const permission = this.deps.permissions.evaluate(
      definition,
      request.context,
      validated.kind === "valid" ? validated.value : undefined,
    );
    const approval = await this.deps.approvals.evaluate(definition, request.context);

    let blocked = false;
    let blockedCode: AiWorkforceErrorCode | undefined;
    let blockedMessage: string | undefined;

    if (validated.kind === "invalid") {
      blocked = true;
      blockedCode = "INVALID_INPUT";
      blockedMessage = formatIssues(validated.issues);
    } else if (!permission.allowed) {
      blocked = true;
      blockedCode =
        permission.reason === "SCOPE_MISSING" ? "SCOPE_MISSING" : permission.reason === "SCOPE_DENIED" ? "SCOPE_DENIED" : "PERMISSION_DENIED";
      blockedMessage = permission.detail ?? "Permission denied";
    } else if (!approval.satisfied) {
      blocked = true;
      blockedCode =
        approval.reason === "CRITICAL_FORBIDDEN_AUTONOMOUS"
          ? "CRITICAL_AUTONOMY_FORBIDDEN"
          : approval.reason === "APPROVAL_REJECTED"
            ? "APPROVAL_REJECTED"
            : "APPROVAL_REQUIRED";
      blockedMessage = `Approval not satisfied (${approval.reason})`;
    }

    return {
      capability: request.capability,
      resolved: true,
      tool: definition,
      inputValid: validated.kind === "valid",
      inputIssues: validated.kind === "valid" ? [] : validated.issues,
      normalizedInput: validated.kind === "valid" ? validated.value : null,
      permission,
      approval,
      blocked,
      blockedCode,
      blockedMessage,
    };
  }

  /* ═══════════════════════════════════════════════════
     Execute
     ═══════════════════════════════════════════════════ */

  async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
    const startedAt = this.deps.now().getTime();

    /* ── 1. Capability lookup ─────────────────────────── */
    const { definition, handler } = resolveCapability(this.deps.registry, request.capability);

    const basePayload: JsonObject = {
      capability: definition.id,
      source: request.context.source,
      autonomy: request.context.autonomy,
      correlationId: request.context.correlationId,
    };

    const run = await this.deps.recorder.startRun({
      toolId: definition.id,
      jobId: request.context.jobId,
      runtimeKind: this.kind,
      actorUserId: request.context.actor.userId,
      serviceIdentityId: request.context.serviceIdentity.id,
      businessId: request.context.business?.id,
      correlationId: request.context.correlationId,
      // Persisted with the run so the exact call and its result survive a restart.
      input: recordedInput(request.input),
    });

    // The run id is part of the context from this point on, so every later
    // event and handler call can be correlated.
    const context = { ...request.context, runId: run.id };

    const emit = (type: AuditEventType, payload: JsonObject) =>
      this.deps.recorder.record({
        type,
        runId: context.runId,
        jobId: request.context.jobId,
        toolId: definition.id,
        actorUserId: request.context.actor.userId,
        businessId: request.context.business?.id,
        correlationId: request.context.correlationId,
        payload: { ...basePayload, ...payload },
      });

    await emit("capability.resolved", { toolId: definition.id, version: definition.version, riskLevel: definition.riskLevel });
    await this.deps.recorder.record({
      type: "run.started",
      runId: run.id,
      jobId: context.jobId,
      toolId: definition.id,
      actorUserId: context.actor.userId,
      businessId: context.business?.id,
      correlationId: context.correlationId,
      payload: { runtimeKind: this.kind, aiProvider: "NONE" },
    });

    const duration = () => this.deps.now().getTime() - startedAt;

    /* ── 2. Input validation ──────────────────────────── */
    const validated = validateValue(definition.inputSchema, request.input ?? {});
    if (validated.kind === "invalid") {
      const message = `Invalid input for "${definition.id}": ${formatIssues(validated.issues)}`;
      await emit("input.rejected", { issues: validated.issues as unknown as JsonObject });
      await this.finish(run.id, "FAILED", "INVALID_INPUT", message);
      await emit("run.finished", { status: "FAILED", code: "INVALID_INPUT" });
      throw new AiWorkforceError("INVALID_INPUT", message, { toolId: definition.id });
    }

    /* ── 3. Permission policy ─────────────────────────── */
    const permission = this.deps.permissions.evaluate(definition, context, validated.value);
    await emit("policy.checked", {
      allowed: permission.allowed,
      reason: permission.reason,
      missing: permission.missing,
      required: definition.requiredPermissions,
    });
    if (!permission.allowed) {
      const code =
        permission.reason === "SCOPE_MISSING" ? "SCOPE_MISSING" : permission.reason === "SCOPE_DENIED" ? "SCOPE_DENIED" : "PERMISSION_DENIED";
      const message = permission.detail ?? `Permission denied for "${definition.id}"`;
      await this.finish(run.id, "BLOCKED", code, message);
      await emit("run.finished", { status: "BLOCKED", code });
      throw new AiWorkforceError(code, message, {
        toolId: definition.id,
        reason: permission.reason,
        missing: permission.missing,
      });
    }

    /* ── 4. Approval gate ─────────────────────────────── */
    const approval = await this.deps.approvals.evaluate(definition, context);
    await emit("approval.evaluated", {
      required: approval.required,
      satisfied: approval.satisfied,
      reason: approval.reason,
      approvalId: approval.approvalId ?? null,
    });
    if (!approval.satisfied) {
      let thrown: AiWorkforceError;
      try {
        // `enforce` re-evaluates and throws the typed error for this case.
        await this.deps.approvals.enforce(definition, context);
        thrown = new AiWorkforceError("APPROVAL_REQUIRED", `Approval required for "${definition.id}"`);
      } catch (error) {
        thrown = isAiWorkforceError(error)
          ? error
          : new AiWorkforceError("APPROVAL_REQUIRED", `Approval required for "${definition.id}"`);
      }
      await this.finish(run.id, "WAITING_APPROVAL", thrown.code, thrown.message);
      await emit("run.finished", { status: "WAITING_APPROVAL", code: thrown.code });
      throw thrown;
    }

    /* ── 5. Tool execution (timeout + retry) ──────────── */
    const handlerContext = { context, ports: this.deps.ports, ids: this.deps.ids, now: this.deps.now };
    const maxAttempts = Math.max(1, definition.retryPolicy.maxAttempts ?? 1);
    const retryOn = definition.retryPolicy.retryOn ?? [];

    await emit("tool.invoked", { attempts: maxAttempts, riskLevel: definition.riskLevel, mode: definition.readWriteMode });

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const output = await this.callWithTimeout(handler, validated.value, handlerContext, definition);

        // Output contract is observed, not enforced, in Phase 1A: the schema DSL
        // cannot yet express nested arrays of objects, so a mismatch is recorded
        // as an audit note instead of failing a successful read.
        const outputIssues = this.inspectOutput(definition, output);

        await emit("tool.succeeded", {
          attempt,
          durationMs: duration(),
          outputIssues: outputIssues as unknown as JsonObject,
        });
        const finishedRun = await this.finish(run.id, "SUCCEEDED", undefined, undefined, output);
        await emit("run.finished", { status: "SUCCEEDED", durationMs: duration() });

        return {
          capability: definition.id,
          toolId: definition.id,
          toolVersion: definition.version,
          riskLevel: definition.riskLevel,
          readWriteMode: definition.readWriteMode,
          status: "SUCCEEDED",
          output,
          run: finishedRun,
          permission,
          approval,
          attempts: attempt,
          durationMs: duration(),
          aiProvider: "NONE",
        };
      } catch (error) {
        lastError = error;
        const payload = toErrorPayload(error);
        const retryable = retryOn.includes(payload.code) && attempt < maxAttempts;

        if (retryable) {
          await emit("tool.failed", { attempt, code: payload.code, retrying: true });
          await this.sleep(this.backoffMs(definition, attempt));
          continue;
        }

        await emit("tool.failed", { attempt, code: payload.code, message: payload.message, retrying: false });
        await this.finish(run.id, "FAILED", payload.code, payload.message);
        await emit("run.finished", { status: "FAILED", code: payload.code });
        throw isAiWorkforceError(error)
          ? error
          : new AiWorkforceError("TOOL_EXECUTION_FAILED", payload.message, { toolId: definition.id });
      }
    }

    // Unreachable, but keeps the type contract explicit.
    const payload = toErrorPayload(lastError);
    throw new AiWorkforceError(payload.code, payload.message, { toolId: definition.id });
  }

  /* ═══════════════════════════════════════════════════
     Internals
     ═══════════════════════════════════════════════════ */

  private finish(
    runId: string,
    status: "SUCCEEDED" | "FAILED" | "BLOCKED" | "WAITING_APPROVAL",
    errorCode?: string,
    errorMessage?: string,
    output?: unknown,
  ) {
    return this.deps.recorder.finishRun({ runId, status, errorCode, errorMessage, output });
  }

  private inspectOutput(definition: ToolDefinition, output: unknown): ValidationIssue[] {
    if (!definition.outputSchema?.fields) return [];
    const validated = validateValue(
      { ...definition.outputSchema, allowUnknown: true, fields: { ...definition.outputSchema.fields } },
      output ?? {},
    );
    return validated.kind === "valid" ? [] : validated.issues;
  }

  private backoffMs(definition: ToolDefinition, attempt: number): number {
    const base = definition.retryPolicy.backoffMs ?? 0;
    switch (definition.retryPolicy.backoff) {
      case "EXPONENTIAL":
        return base * 2 ** (attempt - 1);
      case "FIXED":
        return base;
      default:
        return 0;
    }
  }

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : Promise.resolve();
  }

  private callWithTimeout(
    handler: ToolHandler,
    input: Record<string, unknown>,
    handlerContext: Parameters<ToolHandler>[1],
    definition: ToolDefinition,
  ): Promise<unknown> {
    const timeoutMs = definition.timeoutPolicy?.timeoutMs ?? 0;
    if (!timeoutMs || timeoutMs <= 0) return handler(input, handlerContext);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AiWorkforceError("TOOL_TIMEOUT", `Tool "${definition.id}" exceeded ${timeoutMs}ms`, { timeoutMs })),
        timeoutMs,
      );
    });

    return Promise.race([handler(input, handlerContext), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
