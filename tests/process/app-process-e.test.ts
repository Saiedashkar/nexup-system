import { expect, it } from "vitest";

import { bootProcess, missionIdFromEnv, writeReceipt } from "./support";

/**
 * RESTART PROOF — PROCESS E: the case that CANNOT be verified, measured.
 *
 * Process A died holding an in-flight execution, and by the time this process
 * asks, the REMOTE no longer knows the run at all: its transport answers 404,
 * exactly as the bridge does for a run it has reaped or lost to its own restart.
 *
 * That is a different situation from process C's, and it must behave
 * differently. C had KNOWLEDGE (the run succeeded) and settled the attempt. Here
 * there is knowledge too, but it is knowledge that the run is GONE — and "gone"
 * is not "failed":
 *
 *   - the run may have completed successfully before the record disappeared, so
 *     marking it FAILED would let a retry execute the same work a second time;
 *   - it may still be running somewhere, so "cancelled" would be a guess.
 *
 * So the attempt is recorded as UNKNOWN with an UNKNOWN_REMOTE error, the task is
 * escalated to a HUMAN with a review row that says what happened, and this child
 * proves that no retry, no resubmission and no fabricated terminal state
 * happened: `runsStarted` is 0 and there is still exactly ONE execution record.
 */
it("cannot verify an execution the runtime no longer knows, and escalates it to a human", async () => {
  const missionId = missionIdFromEnv();
  const handleId = process.env.APP_PROOF_HANDLE_ID;
  if (!handleId) throw new Error("APP_PROOF_HANDLE_ID must be set");

  const { application, transport, disconnect } = await bootProcess("procE", {
    // The remote does not know this run: 404, like a restarted bridge.
    unknownRunIds: [handleId],
  });

  const before = await application.commands.snapshot(missionId as never);
  expect(before.tasks[0]!.state).toBe("RUNNING");
  expect(before.tasks[0]!.attempt).toBe(1);

  await application.commands.drain(missionId as never);

  const after = await application.commands.snapshot(missionId as never);
  const counts = transport.counts();
  const execution = after.executions[0]!;

  // Unverified, and SAID SO — never FAILED, which would invite a retry.
  expect(execution.status).toBe("UNKNOWN");
  expect(execution.error?.category).toBe("UNKNOWN_REMOTE");
  expect(execution.audit.map((event) => event.type)).toContain("RECONCILED");
  // One attempt, one record: reconciliation is not a new execution.
  expect(after.executions).toHaveLength(1);
  expect(after.tasks[0]!.attempt).toBe(1);
  expect(counts.runsStarted).toBe(0);

  // A human owns the decision, and the queue can see it.
  expect(after.tasks[0]!.state).toBe("REVIEW");
  const pending = after.reviews.filter((review) => review.state === "PENDING");
  expect(pending).toHaveLength(1);
  expect(pending[0]!.summary).toMatch(/could not be verified/i);
  const queue = await application.queries.decisionQueue();
  expect(queue.map((row) => row.reviewId)).toContain(pending[0]!.id);

  writeReceipt({
    station: "E",
    pid: process.pid,
    missionId,
    handleId,
    executionStatusAfter: execution.status,
    errorCategory: execution.error?.category ?? null,
    executionCount: after.executions.length,
    attemptAfter: after.tasks[0]!.attempt,
    auditTypes: execution.audit.map((event) => event.type).join(","),
    runsStartedByE: counts.runsStarted,
    taskStateAfter: after.tasks[0]!.state,
    missionStateAfter: after.mission.state,
    pendingReviewId: pending[0]!.id,
    reviewSummary: pending[0]!.summary,
    decisionQueueSize: queue.length,
    settled: false,
    escalated: true,
  });

  await disconnect();
}, 120_000);
