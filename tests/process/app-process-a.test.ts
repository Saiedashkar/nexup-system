import { expect, it } from "vitest";

import { bootProcess, restartCommand, writeReceipt } from "./support";

/**
 * RESTART PROOF — PROCESS A.
 *
 * A whole process: it issues a Command through the real application composition,
 * then EXITS. Its pool closes on the way out and every in-memory structure it
 * built (registries, leases, runtime handles, the deterministic transport's own
 * run table) dies with it.
 *
 * It hands over one of two states, chosen by `APP_PROOF_SETTLE`:
 *
 *   "no"  → the first task is RUNNING with its execution record open;
 *   "yes" → the task is in REVIEW and the human decision is still PENDING.
 *
 * Either way the only surviving record is in the DATABASE.
 */
it("issues a Command and exits", async () => {
  const key = process.env.APP_PROOF_KEY;
  const settle = process.env.APP_PROOF_SETTLE === "yes";
  const holdCompletionMs = Number(process.env.APP_PROOF_HOLD_MS ?? 0);

  // A non-zero hold keeps the provider run alive, so the unsettled case really
  // hands over WORK IN FLIGHT rather than work that already finished.
  const { application, disconnect } = await bootProcess("procA", { holdCompletionMs });

  const outcome = await application.commands.issueCommand(restartCommand(key));
  if (outcome.kind !== "issued") throw new Error(`expected an issued command, got ${outcome.kind}`);

  if (settle) await application.commands.drain(outcome.mission.id);

  const snapshot = await application.commands.snapshot(outcome.mission.id);
  const task = snapshot.tasks[0]!;
  expect(snapshot.executions).toHaveLength(1);
  expect(task.executionHandleId).toBeTruthy();

  if (settle) {
    expect(task.state).toBe("REVIEW");
    expect(snapshot.mission.state).toBe("WAITING");
    expect(snapshot.reviews.filter((review) => review.state === "PENDING")).toHaveLength(1);
  } else {
    expect(task.state).toBe("RUNNING");
    expect(snapshot.mission.state).toBe("RUNNING");
  }

  writeReceipt({
    station: "A",
    pid: process.pid,
    missionId: outcome.mission.id,
    intentId: outcome.intent.id,
    taskId: task.id,
    executionRecordId: snapshot.executions[0]!.id,
    executionHandleId: task.executionHandleId ?? null,
    missionState: snapshot.mission.state,
    taskState: task.state,
    executionStatus: snapshot.executions[0]!.status,
    pendingReviewId: snapshot.reviews.find((review) => review.state === "PENDING")?.id ?? null,
    settledByA: settle,
  });

  await disconnect();
}, 120_000);
