import { expect, it } from "vitest";

import { isTerminalExecutionStatus } from "@/modules/workforce";

import { bootProcess, missionIdFromEnv, writeReceipt } from "./support";

/**
 * RESTART PROOF — PROCESS C: the case that DOES NOT WORK, measured.
 *
 * Process A issued a Command and died with its task RUNNING. The mission, the
 * task, the execution record and the runtime handle are all in the database —
 * but the RUNTIME ADAPTER's bookkeeping is in-process memory, and the
 * `AgentExecutionLifecycle` port has no way to re-adopt a handle it did not
 * start. So this process cannot settle the execution: `waitForExecution` throws
 * RUNTIME_NOT_FOUND, and `cancelJob` would refuse the same handle for the same
 * reason.
 *
 * This child exists so the limitation is a MEASUREMENT rather than an omission.
 * It asserts the failure and the stuck row, and reports both.
 */
it("cannot settle a handle another process started, and says so", async () => {
  const missionId = missionIdFromEnv();
  const { application, disconnect } = await bootProcess("procC", { statusSequence: ["succeeded"] });

  const rehydrated = await application.commands.snapshot(missionId as never);
  const task = rehydrated.tasks[0]!;
  expect(task.state).toBe("RUNNING");
  const handleId = task.executionHandleId!;
  expect(handleId).toBeTruthy();

  let code: string | null = null;
  let message: string | null = null;
  try {
    await application.commands.drain(missionId as never);
  } catch (error) {
    code = (error as { code?: string }).code ?? null;
    message = error instanceof Error ? error.message : String(error);
  }

  // It fails, and it fails for the honest reason — not silently.
  expect(code).toBe("RUNTIME_UNAVAILABLE");
  expect(message).toMatch(/no execution/i);

  const after = await application.commands.snapshot(missionId as never);
  expect(after.tasks[0]!.state).toBe("RUNNING");
  expect(after.mission.state).toBe("RUNNING");
  // The attempt is still open — the exact non-terminal status is the runtime's
  // own vocabulary (ACCEPTED/RUNNING/...), so the claim is "not terminal".
  expect(isTerminalExecutionStatus(after.executions[0]!.status as never)).toBe(false);

  writeReceipt({
    station: "C",
    pid: process.pid,
    missionId,
    handleId,
    errorCode: code,
    errorMessage: message,
    missionStateAfter: after.mission.state,
    taskStateAfter: after.tasks[0]!.state,
    executionStatusAfter: after.executions[0]!.status,
    settled: false,
  });

  await disconnect();
}, 120_000);
