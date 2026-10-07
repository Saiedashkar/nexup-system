import { describe, expect, it } from "vitest";

import { createSequentialIdFactory } from "@/modules/ai-workforce/core/ids";
import {
  AgentRuntimeDispatcher,
  bootstrapStrategyAnalyst,
  createHermesRuntimeFromEnv,
  createWorkforceDomain,
  isTerminalExecutionStatus,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID,
  STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION,
  type RuntimeEvent,
} from "@/modules/workforce";

/**
 * STEP 4 SAFETY CLOSURE — the LIVE cancel proof.
 *
 * The first Step-4 audit's last gap: cancellation was proven offline only, and
 * the live paths had never shown that a run can be stopped through the PORT.
 *
 * This drives the production composition against the deployed bridge:
 *
 *   AgentRuntimeDispatcher.startJob
 *     → AgentRuntime (Hermes adapter, BRIDGE transport)
 *     → bridge POST /v1/runs            → runId as the handle
 *   AgentRuntimeDispatcher.cancelJob
 *     → AgentRuntime.cancelJob
 *     → bridge POST /v1/runs/:runId/cancel
 *     → terminal CANCELLED
 *
 * The driver NEVER reaches for `BridgeClient.cancelRun`: the only cancellation
 * call it makes is the one on the port. `saieed` is the only profile addressed.
 *
 * GATED. Runs only with the bridge E2E environment (see
 * `docs/AI_WORKFORCE_AUDIT_EVIDENCE.md`):
 *
 *   NEXUP_BRIDGE_E2E=1 HERMES_RUNTIME_PROFILE=saieed \
 *   HERMES_RUNTIME_TRANSPORT=BRIDGE HERMES_RUNTIME_BRIDGE_URL=… \
 *   HERMES_RUNTIME_BRIDGE_KEY_ID=… HERMES_RUNTIME_BRIDGE_SECRET=… \
 *   npx vitest run tests/workforce-step4-live-cancel.test.ts
 */

const liveRequested = process.env.NEXUP_BRIDGE_E2E === "1";
const CAPABILITY_ID = STRATEGY_INTERNAL_BRIEF_CAPABILITY_ID;
const CAPABILITY_VERSION = STRATEGY_INTERNAL_BRIEF_CAPABILITY_VERSION;

/**
 * A deliberately LONG task, so the cancel has something real to interrupt. The
 * proof is worthless if the run had already finished.
 */
const LONG_INSTRUCTION =
  "Write a numbered list from 1 to 300. One line per number, each line: the number, a dash, and a three-word description of an unrelated topic. Do not stop early and do not summarise.";

/** How long to let the run work before cancelling it. */
const CANCEL_AFTER_MS = Number(process.env.NEXUP_CANCEL_AFTER_MS ?? 10_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!liveRequested)("STEP 4 SAFETY CLOSURE — live cancel through the port", () => {
  it(
    "cancels an in-flight run through AgentRuntime.cancelJob and lands on terminal CANCELLED",
    async () => {
      const domain = createWorkforceDomain({ ids: createSequentialIdFactory("w") });
      const events: RuntimeEvent[] = [];
      const runtime = createHermesRuntimeFromEnv(process.env, { eventSink: (event) => events.push(event) });
      if (!runtime.enabled) throw new Error(runtime.reason);
      const built = await bootstrapStrategyAnalyst(domain, { runtime: runtime.adapter });
      if (!built.enabled) throw new Error(built.reason);

      const dispatcher = new AgentRuntimeDispatcher({
        runtimes: domain.runtimes,
        actors: domain.actors,
        assignments: domain.assignments,
      });

      // A runtime that cannot cancel must never be presented as a cancel proof.
      const runtimeInstance = domain.runtimes.require(built.runtimeId);
      expect(runtime.adapter.supports("cancel")).toBe(true);

      const submittedAt = Date.now();
      const started = await dispatcher.startJob({
        actorId: built.actorId,
        runtimeId: built.runtimeId,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        jobId: `job_step4_cancel_${Date.now()}`,
        traceId: "step4-live-cancel",
        input: { instruction: LONG_INSTRUCTION },
      });
      if (!started.dispatched) throw new Error(JSON.stringify(started.error ?? started.reason));

      const handleId = started.handle!.handleId;
      const acceptedMs = Date.now() - submittedAt;

      // Let the run actually start working on Hermes, then interrupt it.
      await sleep(CANCEL_AFTER_MS);
      const cancelledAt = new Date();
      const cancelStartedAt = Date.now();
      const cancelled = await dispatcher.cancelJob(
        { runtimeId: built.runtimeId, handleId },
        "step4 safety closure — controlled live cancel through the port",
      );
      const cancelMs = Date.now() - cancelStartedAt;

      if (!cancelled.dispatched) throw new Error(JSON.stringify(cancelled.error ?? cancelled.reason));

      // Terminal state, read back through the port (not from the cancel ack).
      const settled = await dispatcher.getExecution({ runtimeId: built.runtimeId, handleId });
      const record = settled.execution!;
      const actor = await domain.actors.resolve(built.actorId);
      const runtimeIdentity = runtimeInstance.identity;

      // Was the run still alive when we cancelled it? The background consumer is
      // the authority: if the terminal frame had already landed, the status
      // would have been terminal BEFORE the cancel.
      const hadTerminalBeforeCancel = isTerminalExecutionStatus(started.handle!.status);
      expect(hadTerminalBeforeCancel).toBe(false);

      console.log(
        `[step4-cancel-audit] ${JSON.stringify({
          step: "4",
          proof: "live-cancel-through-AgentRuntime.cancelJob",
          at: new Date().toISOString(),
          submittedAt: new Date(submittedAt).toISOString(),
          cancelledAt: cancelledAt.toISOString(),
          actorId: record.actorId,
          actorSlug: actor.slug,
          actorLifecycle: actor.lifecycle,
          capabilityId: record.capabilityId,
          capabilityVersion: CAPABILITY_VERSION,
          assignmentId: built.assignmentId,
          runtimeId: record.runtimeId,
          runtimeType: runtimeIdentity.type,
          transport: runtimeIdentity.metadata.transport,
          profileRef: runtimeIdentity.metadata.profileRef,
          runId: handleId,
          providerExecutionId: record.providerExecutionId ?? null,
          statusDuring: started.handle!.status,
          statusAfterCancel: record.status,
          cancelAckStatus: cancelled.status,
          acceptedMs,
          cancelMs,
          cancelAfterMs: CANCEL_AFTER_MS,
          terminal: isTerminalExecutionStatus(record.status),
          idempotencyKey: record.idempotencyKey ?? null,
          eventTypes: [...new Set(events.map((event) => event.type))],
        })}`,
      );

      // The two claims this proof exists for.
      expect(record.status).toBe("CANCELLED");
      expect(isTerminalExecutionStatus(record.status)).toBe(true);
      expect(cancelled.status).toBe("CANCELLED");
      // Attribution survives cancellation.
      expect(record.actorId).toBe(built.actorId);
      expect(record.capabilityId).toBe(CAPABILITY_ID);
      expect(record.handleId).toBe(handleId);
      expect(events.every((event) => event.profile === "saieed")).toBe(true);
      expect(events.map((event) => event.type)).toContain("runtime.cancelled");
    },
    180_000,
  );
});
