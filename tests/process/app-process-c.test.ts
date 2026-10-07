import { expect, it } from "vitest";

import { bootProcess, missionIdFromEnv, writeReceipt } from "./support";

/**
 * RESTART PROOF — PROCESS C: RE-ADOPTION.
 *
 * Process A issued a Command and exited with its task RUNNING while the provider
 * run was still alive (it held the completion). Everything about that attempt is
 * durable — mission, task, execution record, runtime handle, attempt, timestamps
 * — and NOTHING about it is in this process: its registries, its ids, its runtime
 * adapter's handle bookkeeping and its transport's run table are all new.
 *
 * This process must therefore do what a restarted application has to do: ASK the
 * runtime what happened to a run it never submitted. That is the re-adoption
 * seam (`AgentExecutionRecovery.adoptExecution`), reached through
 * `application.commands.drain()` — the ordinary resumption driver, not a special
 * recovery script.
 *
 * Its own transport knows the run because the REMOTE kept it (that is what the
 * `knownRuns` fixture models: the bridge does not die with our process). The
 * child reports the transport's counters in its receipt, so the claim "it did
 * not resubmit" is a measurement: `runsStarted` must be 0.
 */
it("re-adopts an execution another process started, without resubmitting it", async () => {
  const missionId = missionIdFromEnv();
  const handleId = process.env.APP_PROOF_HANDLE_ID;
  if (!handleId) throw new Error("APP_PROOF_HANDLE_ID must be set");

  // The provider's view: this run finished successfully while we were away.
  const { application, transport, disconnect } = await bootProcess("procC", {
    knownRuns: [
      {
        executionId: handleId,
        status: "succeeded",
        output: { summary: "re-adopted result" },
      },
    ],
  });

  const rehydrated = await application.commands.snapshot(missionId as never);
  const task = rehydrated.tasks[0]!;
  expect(task.state).toBe("RUNNING");
  expect(task.executionHandleId).toBe(handleId);
  expect(rehydrated.executions).toHaveLength(1);
  const statusBefore = rehydrated.executions[0]!.status;

  // The resumption driver: adopt → settle → advance. No special path.
  const advanced = await application.commands.drain(missionId as never);

  const after = await application.commands.snapshot(missionId as never);
  const counts = transport.counts();

  // ── Nothing was resubmitted. This is the whole claim. ──────────────────
  expect(counts.runsStarted).toBe(0);
  // …and the attempt became terminal from what the runtime REPORTED.
  expect(after.executions).toHaveLength(1);
  expect(after.executions[0]!.status).toBe("SUCCEEDED");
  expect(after.executions[0]!.handleId).toBe(handleId);
  // The durable audit says a surviving process verified this row.
  expect(after.executions[0]!.audit.map((event) => event.type)).toContain("RECONCILED");
  expect(after.tasks[0]!.state).toBe("REVIEW");
  expect(after.mission.state).toBe("WAITING");
  expect(after.reviews.filter((review) => review.state === "PENDING")).toHaveLength(1);

  writeReceipt({
    station: "C",
    pid: process.pid,
    missionId,
    handleId,
    statusBefore,
    executionStatusAfter: after.executions[0]!.status,
    executionCount: after.executions.length,
    auditTypes: after.executions[0]!.audit.map((event) => event.type).join(","),
    runsStartedByC: counts.runsStarted,
    statusReadsByC: counts.statusReads,
    taskStateAfter: after.tasks[0]!.state,
    missionStateAfter: after.mission.state,
    pendingReviewId: after.reviews.find((review) => review.state === "PENDING")?.id ?? null,
    changes: advanced.changes.join("|"),
    settled: true,
  });

  await disconnect();
}, 120_000);
