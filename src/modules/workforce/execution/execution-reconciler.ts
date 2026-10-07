import type { Clock } from "@/modules/ai-workforce/core/types";

import type { MissionId, TaskId } from "../core/refs";
import type { MissionState } from "../missions/mission-contracts";
import type { MissionRepository } from "../missions/mission-repository";
import type { TaskRepository } from "../missions/task-repository";
import type { TaskState } from "../missions/task-contracts";
import type { MissionOrchestrator } from "../orchestration/mission-orchestrator";
import {
  isAgentExecutionRecovery,
  isTerminalExecutionStatus,
  type AgentExecutionAdoption,
  type AgentExecutionStatus,
} from "../runtimes/agent-runtime";
import type { RuntimeRegistry } from "../runtimes/runtime-registry";

import type { ExecutionRecord, ExecutionRecordRepository, ExecutionRecorder } from "./execution-record";

/**
 * Execution reconciliation — the provider-neutral recovery service.
 *
 * The problem it exists for, stated plainly: an execution is submitted to a
 * runtime, the runtime keeps running it on its own, and the NEXUP process that
 * submitted it goes away. The provider did not stop; our ability to OBSERVE it
 * did. Before this service the mission was stuck — the runtime no longer knew
 * the handle it had minted in a previous life, so nothing could settle the
 * attempt and a human had to cancel a mission that may well have succeeded.
 *
 * What it does, per in-flight attempt:
 *
 *   1. loads the DURABLE record (handleId, providerExecutionId, actor, runtime,
 *      capability, attempt, timestamps) — never process memory;
 *   2. asks the runtime to ADOPT the execution (see `AgentExecutionRecovery`).
 *      Adoption observes; it never resubmits and never starts a second run;
 *   3. writes what it learned onto the durable record, as a RECONCILED audit
 *      event plus the runtime's own status;
 *   4. hands a confirmed-terminal attempt to the ORCHESTRATOR, so the task
 *      moves through the same state machine and the same review boundary a
 *      freshly-settled attempt does. Reconciliation adds no second way to
 *      complete a task.
 *
 * It is deliberately NOT Hermes-specific: it speaks `AgentExecutionRecovery`,
 * `RuntimeRegistry` and the repositories. A second provider adapter implements
 * the same port and this service picks it up unchanged.
 *
 * Truthful handling of every remote outcome:
 *
 *   still running            → ADOPTED_RUNNING      nothing moves, nothing faked
 *   finished while we were down
 *                            → ADOPTED_TERMINAL     SUCCEEDED/FAILED → the
 *                                                     orchestrator's own paths
 *                                                     (REVIEW, retry, CANCELLED)
 *   cancelled while we were down
 *                            → ADOPTED_TERMINAL     task and mission CANCELLED
 *   failed while we were down
 *                            → ADOPTED_TERMINAL     retry allowance decides
 *   the runtime does not know it any more
 *                            → REMOTE_UNKNOWN       status UNKNOWN_REMOTE and a
 *                                                     HUMAN decides: never a
 *                                                     fabricated FAILED, never
 *                                                     an automatic retry (the
 *                                                     run may have succeeded)
 *   the runtime cannot be asked (outage/timeout)
 *                            → RUNTIME_UNAVAILABLE  nothing changes, retry later
 *   no runtime registered    → NO_RUNTIME           reported, not invented
 *   the task already moved on → NOT_RUNNING         left alone, reported
 */

export const EXECUTION_RECONCILIATION_KINDS = [
  "ADOPTED_TERMINAL",
  "ADOPTED_RUNNING",
  "REMOTE_UNKNOWN",
  "RUNTIME_UNAVAILABLE",
  "NO_RUNTIME",
  "NOT_RUNNING",
  "ALREADY_TERMINAL",
] as const;
export type ExecutionReconciliationKind = (typeof EXECUTION_RECONCILIATION_KINDS)[number];

export type ExecutionReconciliation = {
  kind: ExecutionReconciliationKind;
  executionRecordId: string;
  handleId: string;
  runtimeId: string;
  status: AgentExecutionStatus;
  detail: string;
  missionId?: MissionId;
  taskId?: TaskId;
  taskState?: TaskState;
  missionState?: MissionState;
};

export type ExecutionReconcilerDeps = {
  records: ExecutionRecordRepository;
  executions: ExecutionRecorder;
  runtimes: RuntimeRegistry;
  /** Read-only access, for the task/mission a settled attempt reports back. */
  missions: MissionRepository;
  tasks: TaskRepository;
  /**
   * The ONLY way an attempt is settled: reconciliation decides nothing about
   * task state itself. It runs after the record has been updated, so the
   * orchestrator observes the same durable status a live settle would.
   */
  orchestrator: MissionOrchestrator;
  now?: Clock;
};

export class ExecutionReconciler {
  private readonly now: Clock;

  constructor(private readonly deps: ExecutionReconcilerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Re-adopts every in-flight attempt of one mission. Never dispatches. */
  async reconcileMission(missionId: MissionId): Promise<ExecutionReconciliation[]> {
    const records = await this.deps.records.listForMission(missionId);
    return this.reconcileRecords(records);
  }

  /**
   * Re-adopts the most recently touched in-flight attempts, across missions.
   * This is the sweep a scheduled job or an operator action would call; it
   * shares every rule with the per-mission path.
   */
  async reconcileInFlight(limit = 50): Promise<ExecutionReconciliation[]> {
    const records = await this.deps.records.list(limit);
    return this.reconcileRecords(records);
  }

  private async reconcileRecords(records: readonly ExecutionRecord[]): Promise<ExecutionReconciliation[]> {
    // Only attempts that are STILL OPEN are swept: the report describes what a
    // surviving process had to DO. A terminal attempt is already someone's
    // answer, so re-reporting it on every sweep would bury the news in noise.
    // (`ALREADY_TERMINAL` therefore exists for the race — a record that becomes
    // terminal between this filter and the adoption below, because another
    // process settled it first. That IS news, and it must not throw.)
    const inFlight = records
      .filter((record) => !isTerminalExecutionStatus(record.status))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));

    const results: ExecutionReconciliation[] = [];
    for (const record of inFlight) {
      results.push(await this.reconcileOne(record));
    }
    return results;
  }

  private async reconcileOne(record: ExecutionRecord): Promise<ExecutionReconciliation> {
    const base = {
      executionRecordId: record.id,
      handleId: record.handleId,
      runtimeId: record.runtimeId,
      ...(record.missionId ? { missionId: record.missionId } : {}),
      ...(record.taskId ? { taskId: record.taskId } : {}),
    };

    if (isTerminalExecutionStatus(record.status)) {
      return { ...base, kind: "ALREADY_TERMINAL", status: record.status, detail: `attempt is already ${record.status}` };
    }

    // A record can outlive its task's RUNNING state (a human cancelled the
    // mission, the task failed by review). Adopting it then would resurrect a
    // task the state machine has already closed, so it is left alone — and
    // SAID, rather than silently skipped.
    const task = record.taskId ? await this.deps.tasks.get(record.taskId) : null;
    if (task && task.state !== "RUNNING") {
      return {
        ...base,
        kind: "NOT_RUNNING",
        status: record.status,
        taskState: task.state,
        detail: `task is ${task.state}; there is no running attempt to adopt`,
      };
    }

    const runtime = this.deps.runtimes.get(record.runtimeId);
    if (!runtime) {
      const detail = `no runtime is registered for id "${record.runtimeId}"; the attempt cannot be observed in this process`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "NO_RUNTIME", status: record.status, detail };
    }

    if (!isAgentExecutionRecovery(runtime)) {
      const detail = `runtime "${record.runtimeId}" does not implement execution adoption; the attempt cannot be re-adopted`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    let adoption: AgentExecutionAdoption;
    try {
      adoption = await runtime.adoptExecution({
        handleId: record.handleId,
        runtimeId: record.runtimeId,
        ...(record.providerExecutionId ? { providerExecutionId: record.providerExecutionId } : {}),
        actorId: record.actorId,
        capabilityId: record.capabilityId,
        ...(record.missionId ? { missionId: record.missionId } : {}),
        ...(record.taskId ? { taskId: record.taskId } : {}),
        attempt: record.attempt,
      });
    } catch (error) {
      // A THROW is an outage, not knowledge: the adapter itself failed. Record
      // the attempt and leave the state untouched, so nothing looks verified.
      const detail = `adoption failed: ${error instanceof Error ? error.message : "unknown runtime error"}`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    if (adoption.kind === "UNAVAILABLE") {
      const detail = `runtime could not report on this execution: ${adoption.detail}`;
      await this.deps.executions.noteReconciliation(record.id, detail);
      return { ...base, kind: "RUNTIME_UNAVAILABLE", status: record.status, detail };
    }

    // Both remaining shapes are KNOWLEDGE, and both are written down. UNKNOWN
    // becomes an explicit UNKNOWN status with an UNKNOWN_REMOTE error: the
    // attempt is unverified, and a human decides. It is never FAILED, because
    // an automatic retry off the back of "we lost track of it" could duplicate a
    // run that actually succeeded.
    let status: AgentExecutionStatus;
    let detail: string;
    let reconciled: ExecutionRecord;
    if (adoption.kind === "UNKNOWN") {
      status = "UNKNOWN";
      detail = `the runtime no longer knows this execution: ${adoption.detail}`;
      reconciled = await this.deps.executions.reconcile(record.id, {
        status,
        detail,
        error: { category: "UNKNOWN_REMOTE", message: adoption.detail, retryable: false },
      });
    } else {
      const reported = adoption.record;
      status = reported.status;
      detail = `re-adopted from the runtime; it reports ${reported.status}`;
      reconciled = await this.deps.executions.reconcile(record.id, {
        status,
        detail,
        ...(reported.providerExecutionId ? { providerExecutionId: reported.providerExecutionId } : {}),
        ...(reported.completedAt ? { completedAt: reported.completedAt } : {}),
        ...(reported.durationMs !== undefined ? { durationMs: reported.durationMs } : {}),
        ...(reported.output !== undefined ? { output: reported.output } : {}),
        ...(reported.outputText !== undefined ? { outputText: reported.outputText } : {}),
        ...(reported.error ? { error: reported.error } : {}),
      });
    }
    const unverifiable = adoption.kind === "UNKNOWN";

    // An UNVERIFIABLE attempt never flows through `settleTask`: the runtime has
    // no handle to wait on, and — more importantly — settling it would mean
    // choosing a state we do not know. It is escalated to a human instead.
    if (unverifiable && record.missionId && record.taskId) {
      const escalated = await this.deps.orchestrator.escalateUnverifiedExecution(record.missionId, record.taskId, {
        detail,
      });
      const escalatedMission = await this.deps.missions.get(record.missionId);
      return {
        ...base,
        kind: "REMOTE_UNKNOWN",
        status: reconciled.status,
        taskState: escalated.state,
        ...(escalatedMission ? { missionState: escalatedMission.state } : {}),
        detail,
      };
    }

    if (!isTerminalExecutionStatus(reconciled.status)) {
      return { ...base, kind: "ADOPTED_RUNNING", status: reconciled.status, detail };
    }

    // Confirmed terminal: the SAME settle path a live dispatch uses decides what
    // happens to the task (REVIEW, retry, CANCELLED) and to the mission.
    if (!record.missionId || !record.taskId) {
      return {
        ...base,
        kind: "ADOPTED_TERMINAL",
        status: reconciled.status,
        detail: `${detail}; the record carries no task to settle`,
      };
    }

    const outcome = await this.deps.orchestrator.settleTask(record.missionId, record.taskId);
    const mission = await this.deps.missions.get(record.missionId);
    return {
      ...base,
      kind: "ADOPTED_TERMINAL",
      status: reconciled.status,
      taskState: outcome.state,
      ...(mission ? { missionState: mission.state } : {}),
      detail,
    };
  }
}
