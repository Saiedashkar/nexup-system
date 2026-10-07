import { expect, it } from "vitest";

import { FOUNDER, bootProcess, missionIdFromEnv, writeReceipt } from "./support";

/**
 * RESTART PROOF — PROCESS B, a DIFFERENT OS PROCESS from A.
 *
 * It shares nothing with A: its own pool, its own registries, its own ids, and a
 * fresh transport. Everything it does, it does from the rows A left behind — the
 * mission, its task, the execution attempt, and the human decision that was
 * still open when A exited.
 *
 * That open decision is the whole point: a review is the platform's most
 * important piece of state (an agent's result waiting for a person), and it has
 * to outlive the process that raised it.
 */
it("rehydrates the pending decision from the database alone and completes the mission", async () => {
  const missionId = missionIdFromEnv();
  const { application, disconnect } = await bootProcess("procB", { statusSequence: ["succeeded"] });

  const rehydrated = await application.commands.snapshot(missionId as never);
  const task = rehydrated.tasks[0]!;

  // Reconstructed from ROWS: the task is waiting for a person, the execution
  // attempt is recorded, and the handle the earlier process held is on the row.
  expect(rehydrated.mission.state).toBe("WAITING");
  expect(task.state).toBe("REVIEW");
  expect(task.executionHandleId).toBeTruthy();
  expect(rehydrated.executions).toHaveLength(1);
  expect(rehydrated.executions[0]!.id).toBe(task.executionRecordId);
  const polledHandleId = task.executionHandleId!;

  const pending = rehydrated.reviews.find((review) => review.state === "PENDING");
  if (!pending) throw new Error("A left no pending decision to rehydrate");
  expect(pending.executionRecordId).toBe(rehydrated.executions[0]!.id);

  // The human decision — the boundary an agent cannot cross, even here.
  await application.commands.decide(pending.id, { decision: "APPROVED", decidedBy: FOUNDER });

  const final = await application.commands.snapshot(missionId as never);
  expect(final.mission.state).toBe("COMPLETED");
  expect(final.tasks[0]!.state).toBe("COMPLETED");
  expect(final.reviews[0]!.state).toBe("APPROVED");

  // The ledger row A created still resolves to the same mission — the
  // idempotency decision outlived the process that made it.
  const key = process.env.APP_PROOF_KEY!;
  const intent = await application.commands.intentFor("proof:restart", key);
  expect(intent?.missionId).toBe(missionId);

  writeReceipt({
    station: "B",
    pid: process.pid,
    missionId,
    polledHandleId,
    executionStatus: final.executions[0]!.status,
    taskState: final.tasks[0]!.state,
    missionState: final.mission.state,
    reviewState: final.reviews[0]!.state,
    decidedBy: final.reviews[0]!.decidedBy ?? null,
    intentMissionId: intent?.missionId ?? null,
  });

  await disconnect();
}, 120_000);
