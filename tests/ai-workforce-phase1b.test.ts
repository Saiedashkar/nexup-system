import { describe, expect, it } from "vitest";

import { createControlCore, type ControlCore } from "@/modules/ai-workforce/core/create-core";
import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import {
  createExecutionContext,
  createServiceIdentity,
  createSystemActor,
  type ActorContext,
} from "@/modules/ai-workforce/core/execution-context";
import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import type { ClientSummary, ProjectSummary, WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { applyTransition } from "@/modules/ai-workforce/jobs/job-state-machine";
import type { Job } from "@/modules/ai-workforce/jobs/job-contracts";
import {
  createInMemoryJobStore,
  InMemoryJobRepository,
  type InMemoryJobStore,
} from "@/modules/ai-workforce/jobs/job-repository";
import {
  createInMemoryAuditEventStore,
  InMemoryAuditEventRepository,
  type InMemoryAuditEventStore,
} from "@/modules/ai-workforce/audit/audit-event-repository";
import { createInMemoryRunStore, InMemoryRunRepository, type InMemoryRunStore } from "@/modules/ai-workforce/audit/run-repository";
import { InMemoryApprovalRepository } from "@/modules/ai-workforce/approvals/approval-repository";
import { STRICT_APPROVAL_POLICY } from "@/modules/ai-workforce/approvals/approval-policy";
import { derivePermissionTokens } from "@/modules/ai-workforce/policies/permission-policy";
import { assertIsolatedDatabaseUrl, resolvePersistence } from "@/modules/ai-workforce/policies/persistence-safety";
import type { ToolAdapter } from "@/modules/ai-workforce/registry/tool-definition";
import { controlPlaneToolAdapters } from "@/modules/ai-workforce/tools";
import { systemStagingWriteTool } from "@/modules/ai-workforce/tools/adapters/system.tools";

/* ═══════════════════════════════════════════════════════
   Fixtures — no database, no network, no AI provider
   ═══════════════════════════════════════════════════════ */

const BIZ = { id: "biz_nexup", slug: "nexup" };

const CLIENT_ROWS: ClientSummary[] = [
  { id: "cli_1", businessId: BIZ.id, name: "شركة النور", phone: "01000000001", tier: "VIP" },
];

const PROJECT_ROWS: ProjectSummary[] = [
  {
    id: "prj_1",
    businessId: BIZ.id,
    projectName: "هوية بصرية",
    clientId: "cli_1",
    workStatus: "IN_PROGRESS",
    paymentStatus: "PARTIAL",
    totalPrice: 50_000,
    deposit: 20_000,
    remaining: 30_000,
    date: "2026-01-15T00:00:00.000Z",
  },
];

function fakePorts(): WorkforcePorts {
  return {
    clients: {
      async search(input) {
        return CLIENT_ROWS.filter((row) => row.businessId === input.businessId).slice(0, input.limit);
      },
    },
    projects: {
      async list(input) {
        return PROJECT_ROWS.filter((row) => row.businessId === input.businessId).slice(0, input.limit);
      },
    },
    capital: {
      async summary() {
        return { totalReceived: 100_000, totalSpent: 25_000, available: 75_000, contributionCount: 3, spendCount: 5, funderCount: 2 };
      },
    },
  };
}

/** A capability with NO business side effect, wrapped so tests can count runs. */
type CountingTool = { adapter: ToolAdapter; executions: () => number };

function countingStagingTool(): CountingTool {
  let executions = 0;
  const adapter: ToolAdapter = {
    definition: { ...systemStagingWriteTool.definition },
    async handler(input, ctx) {
      executions += 1;
      return systemStagingWriteTool.handler(input as never, ctx);
    },
  };
  return { adapter, executions: () => executions };
}

function actor(input: { role: string; isSuperAdmin: boolean; hasOfficeFinanceFull: boolean; slugs: string[] }): ActorContext {
  return {
    userId: `user_${input.role.toLowerCase()}`,
    name: input.role,
    role: input.role,
    isSuperAdmin: input.isSuperAdmin,
    hasOfficeFinanceFull: input.hasOfficeFinanceFull,
    accessibleBusinessSlugs: input.slugs,
    permissionTokens: derivePermissionTokens({
      role: input.role,
      isSuperAdmin: input.isSuperAdmin,
      hasOfficeFinanceFull: input.hasOfficeFinanceFull,
      accessibleBusinessSlugs: input.slugs,
    }),
  };
}

/** SUPER_ADMIN — holds every token, including `system.write`. */
const superAdmin = () => actor({ role: "SUPER_ADMIN", isSuperAdmin: true, hasOfficeFinanceFull: true, slugs: ["nexup", "rebound", "abomazen"] });

/** Office-finance admin: can see the module, CANNOT decide a `system.write` approval. */
const officeFinance = () => actor({ role: "ADMIN", isSuperAdmin: false, hasOfficeFinanceFull: true, slugs: [] });

function context(actorInput: ActorContext, options: { source?: "MANUAL" | "EVENT" | "AGENT" | "SCHEDULE" | "WEBHOOK" | "SYSTEM" } = {}) {
  return createExecutionContext({
    serviceIdentity: createServiceIdentity("LOCAL"),
    actor: actorInput,
    business: null,
    source: options.source ?? "MANUAL",
    now: new Date("2026-02-01T00:00:00.000Z"),
  });
}

/* ═══════════════════════════════════════════════════════
   Harness — a "process" is only a set of repositories + a core
   ═══════════════════════════════════════════════════════ */

type Stores = {
  jobs: InMemoryJobStore;
  runs: InMemoryRunStore;
  events: InMemoryAuditEventStore;
  approvals: InMemoryApprovalRepository;
};

function createStores(): Stores {
  const ids = createSequentialIdFactory("s");
  const now = sequentialClock("2026-02-01T00:00:00.000Z", 1000);
  return {
    jobs: createInMemoryJobStore(),
    runs: createInMemoryRunStore(),
    events: createInMemoryAuditEventStore(),
    approvals: new InMemoryApprovalRepository({ ids, now }),
  };
}

type Harness = {
  core: ControlCore;
  tool: CountingTool;
  stores: Stores;
  /** Boots a SECOND core over the same storage — a process restart. */
  restart: (prefix: string) => Harness;
};

function boot(stores: Stores, prefix: string, options: { tools?: readonly ToolAdapter[]; strictApprovals?: boolean } = {}): Harness {
  const ids = createSequentialIdFactory(prefix);
  const now = sequentialClock("2026-02-01T00:00:00.000Z", 1000);
  const tool = countingStagingTool();

  const core = createControlCore({
    ports: fakePorts(),
    tools: options.tools ?? [tool.adapter, ...controlPlaneToolAdapters.filter((entry) => entry.definition.id !== tool.adapter.definition.id)],
    ids,
    now,
    sleep: async () => {},
    repositories: {
      jobs: new InMemoryJobRepository(stores.jobs),
      runs: new InMemoryRunRepository(stores.runs),
      events: new InMemoryAuditEventRepository(stores.events),
      approvals: stores.approvals,
    },
    approvalPolicy: options.strictApprovals ? STRICT_APPROVAL_POLICY : undefined,
  });

  return { core, tool, stores, restart: (nextPrefix: string) => boot(stores, nextPrefix, options) };
}

function harness(options: { tools?: readonly ToolAdapter[]; strictApprovals?: boolean } = {}): Harness {
  return boot(createStores(), "t", options);
}

const CAPABILITY = "system.staging_write";
const INPUT = { note: "إثبات مسار الموافقة على الكتابة" };

/* ═══════════════════════════════════════════════════════
   1. Jobs survive a repository reload
   ═══════════════════════════════════════════════════════ */

describe("1. job survives a repository reload", () => {
  it("reads back the exact job that was written (context snapshot included)", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin()) });

    const reloaded = await h.core.jobs.getJob(job.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded).toMatchObject({
      id: job.id,
      status: "CREATED",
      trigger: "MANUAL",
      autonomy: "HUMAN",
      capability: CAPABILITY,
      actorUserId: "user_super_admin",
      input: INPUT,
    });

    // The resumable context is persisted with the job…
    expect(reloaded?.contextSnapshot).toBeDefined();
    expect(reloaded?.contextSnapshot?.actor.userId).toBe("user_super_admin");
    // …but permission tokens are NOT: they are re-derived on load.
    expect(JSON.stringify(reloaded?.contextSnapshot)).not.toContain("system.write");

    const restored = await h.core.jobs.getContext(job.id);
    expect(restored?.actor.permissionTokens).toContain("system.write");
  });

  it("lists persisted jobs newest first", async () => {
    const h = harness();
    await h.core.jobs.create({ capability: "capital.summary", input: {}, context: context(superAdmin()) });
    const second = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin()) });

    const jobs = await h.core.jobs.listJobs(10);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe(second.id);
  });
});

/* ═══════════════════════════════════════════════════════
   2 + 3. Runs and audit events persist
   ═══════════════════════════════════════════════════════ */

describe("2. run persists", () => {
  it("stores the run with its structured input and output", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin()) });
    const outcome = await h.core.jobs.run(job.id);

    expect(outcome.status).toBe("COMPLETED");

    const run = await h.core.recorder.getRun(outcome.run?.id as string);
    expect(run).toMatchObject({ status: "SUCCEEDED", toolId: CAPABILITY, jobId: job.id, runtimeKind: "LOCAL" });
    expect(run?.input).toMatchObject(INPUT);
    expect(run?.output).toMatchObject({ businessImpact: "NONE", persistedBy: "WORKFORCE_ONLY", note: INPUT.note });

    // A second core sees the same run: it lives in the repository, not in the runner.
    const restarted = h.restart("r");
    const runAfterRestart = await restarted.core.recorder.getRun(outcome.run?.id as string);
    expect(runAfterRestart?.status).toBe("SUCCEEDED");
    expect(runAfterRestart?.output).toMatchObject({ businessImpact: "NONE" });
  });
});

describe("3. audit events persist", () => {
  it("keeps the ordered trail of the job after a restart", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin()) });
    await h.core.jobs.run(job.id);

    const restarted = h.restart("r");
    const trail = await restarted.core.recorder.listJobEvents(job.id, 200);

    expect(trail.map((event) => event.type)).toEqual([
      "job.created",
      "job.transitioned",
      "job.transitioned",
      "job.transitioned",
      "capability.resolved",
      "run.started",
      "policy.checked",
      "approval.evaluated",
      "tool.invoked",
      "tool.succeeded",
      "run.finished",
      "job.transitioned",
    ]);

    // The same events are visible from the OLD process too (shared ledger).
    const liveTrail = await h.core.recorder.listJobEvents(job.id, 200);
    expect(liveTrail.map((event) => event.id)).toEqual(trail.map((event) => event.id));
  });
});

/* ═══════════════════════════════════════════════════════
   4. Approval request persists
   ═══════════════════════════════════════════════════════ */

describe("4. approval request persists", () => {
  it("carries who asked, for whom, which capability, risk and reason", async () => {
    const h = harness();
    // EVENT trigger → autonomy AGENT → no human presence to lean on.
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const outcome = await h.core.jobs.run(job.id);

    expect(outcome.status).toBe("WAITING_APPROVAL");
    const approvalId = outcome.job.approvalId as string;
    expect(approvalId).toBeTruthy();

    const restarted = h.restart("r");
    const approval = await restarted.core.approvalService.get(approvalId);

    expect(approval).toMatchObject({
      id: approvalId,
      status: "PENDING",
      toolId: CAPABILITY,
      jobId: job.id,
      riskLevel: "HIGH",
      requestedByUserId: "user_super_admin",
      requestedForUserId: "user_super_admin",
    });
    expect(approval.requestReason).toBeTruthy();
    expect(approval.createdAt).toBeTruthy();

    // The job is parked, not failed, and still knows which approval it waits for.
    const parked = await restarted.core.jobs.getJob(job.id);
    expect(parked?.status).toBe("WAITING_APPROVAL");
    expect(parked?.approvalId).toBe(approvalId);
  });

  it("re-running a parked job does not mint a second approval request", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const first = await h.core.jobs.run(job.id);
    const second = await h.core.jobs.run(job.id);

    expect(second.status).toBe("WAITING_APPROVAL");
    expect(second.job.approvalId).toBe(first.job.approvalId);

    const pending = await h.core.approvalService.listPending(10);
    expect(pending).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════
   5. HIGH-risk capability cannot execute before approval
   ═══════════════════════════════════════════════════════ */

describe("5. HIGH-risk tool cannot execute before approval", () => {
  it("parks the job in WAITING_APPROVAL and never reaches the handler", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const outcome = await h.core.jobs.run(job.id);

    expect(outcome.status).toBe("WAITING_APPROVAL");
    expect(outcome.output).toBeUndefined();
    expect(h.tool.executions()).toBe(0);

    // No run was even started: the gate stops the execution before the runtime.
    expect(await h.core.recorder.listRuns(10)).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════
   6 + 7. Who may approve
   ═══════════════════════════════════════════════════════ */

describe("6. unauthorized actor cannot approve", () => {
  it("refuses an actor who could not run the capability themselves", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const outcome = await h.core.jobs.run(job.id);
    const approvalId = outcome.job.approvalId as string;

    const error = await h.core.approvalService
      .approve({ approvalId, actor: officeFinance(), reason: "محاولة غير مصرّح بها" })
      .then(() => null, (e: unknown) => e as AiWorkforceError);

    expect(error?.code).toBe("APPROVAL_FORBIDDEN");
    expect(error?.details?.missing).toContain("system.write");

    // The decision was not recorded and the capability did not run.
    expect((await h.core.approvalService.get(approvalId)).status).toBe("PENDING");
    expect(h.tool.executions()).toBe(0);
  });

  it("refuses an actor with no workforce access at all", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    await h.core.jobs.run(job.id);
    const approvalId = (await h.core.approvalService.listPending(1))[0].id;

    const error = await h.core.approvalService
      .approve({ approvalId, actor: createSystemActor() })
      .then(() => null, (e: unknown) => e as AiWorkforceError);

    expect(error?.code).toBe("APPROVAL_FORBIDDEN");
    expect(error?.details?.reason).toBe("MODULE_DISABLED");
  });

  it("marks the decision as not decidable for the UI", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    await h.core.jobs.run(job.id);
    const approval = (await h.core.approvalService.listPending(1))[0];

    expect(h.core.approvalService.evaluateEligibility(approval, officeFinance()).allowed).toBe(false);
    expect(h.core.approvalService.evaluateEligibility(approval, superAdmin()).allowed).toBe(true);
  });
});

describe("7. authorized actor can approve", () => {
  it("records the decision with the deciding actor", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const outcome = await h.core.jobs.run(job.id);
    const approvalId = outcome.job.approvalId as string;

    const result = await h.core.approvalService.approve({ approvalId, actor: superAdmin(), reason: "تمت المراجعة" });

    expect(result.approval.status).toBe("APPROVED");
    expect(result.approval.decidedByUserId).toBe("user_super_admin");
    expect(result.approval.decidedAt).toBeTruthy();
    expect(result.approval.decisionReason).toBe("تمت المراجعة");
    expect(result.idempotent).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   8 + 9 + 11. The approval loop
   ═══════════════════════════════════════════════════════ */

describe("8. approval resumes the same job", () => {
  it("executes the parked job and completes it", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);

    const result = await h.core.approvalService.approve({ approvalId: parked.job.approvalId as string, actor: superAdmin() });

    expect(result.outcome?.status).toBe("COMPLETED");
    expect(result.job?.id).toBe(job.id);
    expect(result.job?.status).toBe("COMPLETED");
    expect(result.job?.approvalId).toBe(parked.job.approvalId);

    // Same job, same row: it was parked, then resumed and completed.
    expect(result.job?.history.map((step) => step.to)).toEqual([
      "PLANNED",
      "WAITING_APPROVAL",
      "READY",
      "RUNNING",
      "COMPLETED",
    ]);
  });

  it("re-checks the policy at resume time instead of trusting the request", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);

    // Someone resumes the job WITHOUT the approval decision attached…
    const withoutApproval = await h.core.jobs.run(job.id);
    // …the pending approval is still unresolved, so nothing may execute.
    expect(withoutApproval.status).toBe("WAITING_APPROVAL");
    expect(h.tool.executions()).toBe(0);

    // The approval is not satisfied until a human actually decides.
    const approved = await h.core.approvalService.approve({ approvalId: parked.job.approvalId as string, actor: superAdmin() });
    expect(approved.outcome?.status).toBe("COMPLETED");
    expect(h.tool.executions()).toBe(1);
  });
});

describe("9 + 11. approved capability executes exactly once", () => {
  it("runs the handler once for one approval", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);

    await h.core.approvalService.approve({ approvalId: parked.job.approvalId as string, actor: superAdmin() });

    expect(h.tool.executions()).toBe(1);
    expect(await h.core.recorder.listRuns(10)).toHaveLength(1);
  });

  it("treats a double-clicked approval as a no-op, never a second execution", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);
    const approvalId = parked.job.approvalId as string;

    /* Two concurrent decisions on the same approval — one wins the CAS. */
    const results = await Promise.allSettled([
      h.core.approvalService.approve({ approvalId, actor: superAdmin() }),
      h.core.approvalService.approve({ approvalId, actor: superAdmin() }),
    ]);

    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    expect(fulfilled).toHaveLength(2); // the loser observes the winner's decision

    // The loser must have executed NOTHING new.
    const idempotentFlags = results.map((entry) =>
      entry.status === "fulfilled" ? (entry.value as { idempotent: boolean }).idempotent : null,
    );
    expect(idempotentFlags.filter((flag) => flag === true)).toHaveLength(1);

    // Exactly one handler call and exactly one run, no matter the retries.
    expect(h.tool.executions()).toBe(1);
    expect(await h.core.recorder.listRuns(10)).toHaveLength(1);

    // And a later retry still cannot re-execute.
    const retried = await h.core.approvalService.approve({ approvalId, actor: superAdmin() });
    expect(retried.idempotent).toBe(true);
    expect(retried.job?.status).toBe("COMPLETED");
    expect(h.tool.executions()).toBe(1);
  });

  it("refuses a stale execution attempt through the compare-and-set", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: "capital.summary", input: {}, context: context(superAdmin()) });
    await h.core.jobs.run(job.id);

    // Simulate a second runner that read the job BEFORE the first one finished.
    const stale: Job = { ...(await h.core.jobs.getJob(job.id)) as Job, status: "READY" };
    const stored = await h.core.repositories.jobs.update(stale, ["READY"]);
    expect(stored).toBeNull(); // the row is COMPLETED — the stale write is refused
  });
});

describe("policy: a strict approval policy removes presence-as-approval", () => {
  it("forces an explicit decision even for a MANUAL human job", async () => {
    const h = harness({ strictApprovals: true });
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin()) });
    const outcome = await h.core.jobs.run(job.id);

    expect(outcome.status).toBe("WAITING_APPROVAL");
    expect(h.tool.executions()).toBe(0);

    const approved = await h.core.approvalService.approve({ approvalId: outcome.job.approvalId as string, actor: superAdmin() });
    expect(approved.outcome?.status).toBe("COMPLETED");
    expect(h.tool.executions()).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════
   10. Rejection
   ═══════════════════════════════════════════════════════ */

describe("10. rejected capability never executes", () => {
  it("records the rejection, blocks the job and does not run the tool", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);

    const result = await h.core.approvalService.reject({ approvalId: parked.job.approvalId as string, actor: superAdmin(), reason: "غير مبرَّر" });

    expect(result.approval.status).toBe("REJECTED");
    expect(result.approval.decisionReason).toBe("غير مبرَّر");
    expect(result.job?.status).toBe("BLOCKED");
    expect(result.outcome).toBeNull();

    // Nothing executed, and no run exists.
    expect(h.tool.executions()).toBe(0);
    expect(await h.core.recorder.listRuns(10)).toHaveLength(0);

    // The rejection is on the record.
    const trail = await h.core.recorder.listJobEvents(job.id, 200);
    const denied = trail.find((event) => event.type === "approval.denied");
    expect(denied?.payload).toMatchObject({ decision: "REJECTED", toolExecuted: false });

    // And the approval cannot be flipped to APPROVED afterwards.
    const flip = await h.core.approvalService.approve({ approvalId: parked.job.approvalId as string, actor: superAdmin() }).then(
      () => null,
      (e: unknown) => e as AiWorkforceError,
    );
    expect(flip?.code).toBe("APPROVAL_ALREADY_DECIDED");
    expect(h.tool.executions()).toBe(0);
  });

  it("refuses to execute a job whose approval was rejected, even on a direct resume", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);
    await h.core.approvalService.reject({ approvalId: parked.job.approvalId as string, actor: superAdmin() });

    // The rejected approval travels with the job, so a resume re-enters the gate.
    const resumed = await h.core.jobs.run(job.id);
    expect(resumed.status).toBe("BLOCKED");
    expect(h.tool.executions()).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════
   12. Restart / reload keeps state
   ═══════════════════════════════════════════════════════ */

describe("12. restart/reload does not lose job state", () => {
  it("keeps the final state, the history and the terminal guard", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    await h.core.jobs.run(job.id);
    await h.core.approvalService.approve({ approvalId: (await h.core.approvalService.listPending(1))[0].id, actor: superAdmin() });

    const before = (await h.core.jobs.getJob(job.id)) as Job;
    expect(before.status).toBe("COMPLETED");

    /* A brand-new core over the same storage = a restarted process. */
    const restarted = h.restart("r");
    const after = await restarted.core.jobs.getJob(job.id);

    expect(after?.status).toBe("COMPLETED");
    expect(after?.history).toEqual(before.history);
    expect(after?.runId).toBe(before.runId);
    expect(after?.approvalId).toBe(before.approvalId);
    expect(after?.error).toBeUndefined();

    // A completed job can never be re-executed after the restart.
    const error = await restarted.core.jobs.run(job.id).then(() => null, (e: unknown) => e as AiWorkforceError);
    expect(error?.code).toBe("JOB_ALREADY_FINISHED");
  });

  it("resumes a parked job from the restarted process", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);
    const approvalId = parked.job.approvalId as string;

    const restarted = h.restart("r");
    const result = await restarted.core.approvalService.approve({ approvalId, actor: superAdmin(), reason: "موافقة بعد إعادة التشغيل" });

    expect(result.outcome?.status).toBe("COMPLETED");
    expect(result.job?.id).toBe(job.id);
    // The restarted process executed it — the original harness' counter is 0.
    expect(h.tool.executions()).toBe(0);
    expect(restarted.tool.executions()).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════
   13. State machine + compare-and-set
   ═══════════════════════════════════════════════════════ */

describe("13. invalid state transition still rejected", () => {
  const base: Job = {
    id: "job_x",
    status: "COMPLETED",
    trigger: "MANUAL",
    autonomy: "HUMAN",
    capability: CAPABILITY,
    input: {},
    actorUserId: "u1",
    correlationId: "c1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    history: [],
  };

  it("refuses to leave a terminal status", () => {
    expect(() => applyTransition(base, "RUNNING", "nope", "2026-01-01T00:00:02.000Z")).toThrow(/Cannot move a job/);
  });

  it("refuses a transition that skips PLANNED/READY", () => {
    const created: Job = { ...base, status: "CREATED" };
    expect(() => applyTransition(created, "COMPLETED", "nope", "2026-01-01T00:00:02.000Z")).toThrow(/Cannot move a job/);
  });

  it("surfaces a concurrent update as JOB_CONCURRENT_UPDATE, not a silent loss", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: "capital.summary", input: {}, context: context(superAdmin()) });

    // Two "runners" both read CREATED; the first one wins the transition.
    const first = applyTransition(job, "CANCELLED", "first", "2026-02-01T00:00:05.000Z");
    expect(await h.core.repositories.jobs.update(first, ["CREATED"])).not.toBeNull();

    const second = applyTransition({ ...job }, "BLOCKED", "second", "2026-02-01T00:00:06.000Z");
    expect(await h.core.repositories.jobs.update(second, ["CREATED"])).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
   14. Production database guard fails closed
   ═══════════════════════════════════════════════════════ */

describe("14. production database guard fails closed", () => {
  const PRODUCTION_URL = "postgresql://postgres:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres";
  const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:5435/ai_workforce_test";

  it("refuses a Supabase pooler URL", () => {
    expect(() => assertIsolatedDatabaseUrl(PRODUCTION_URL)).toThrow(/loopback|PERSISTENCE_UNSAFE/);
  });

  it("refuses any remote host, and a missing URL", () => {
    expect(() => assertIsolatedDatabaseUrl("postgresql://u:p@db.example.com:5432/prod")).toThrow();
    expect(() => assertIsolatedDatabaseUrl("")).toThrow();
    expect(() => assertIsolatedDatabaseUrl(undefined)).toThrow();
    expect(() => assertIsolatedDatabaseUrl("mysql://u:p@localhost:3306/db")).toThrow(/protocol/);
  });

  it("accepts a loopback database", () => {
    const info = assertIsolatedDatabaseUrl(LOCAL_URL);
    expect(info).toMatchObject({ host: "127.0.0.1", port: "5435", database: "ai_workforce_test" });
  });

  it("never resolves to DATABASE for a production URL, even when explicitly asked", () => {
    const resolution = resolvePersistence({
      AI_WORKFORCE_PERSISTENCE: "database",
      AI_WORKFORCE_DATABASE_URL: PRODUCTION_URL,
      DATABASE_URL: PRODUCTION_URL,
    });

    expect(resolution.kind).toBe("IN_MEMORY");
    expect(resolution.reason).toContain("rejected");
    // The legacy production URL is never consulted, even as a fallback.
    const withoutWorkforceUrl = resolvePersistence({ AI_WORKFORCE_PERSISTENCE: "database", DATABASE_URL: PRODUCTION_URL });
    expect(withoutWorkforceUrl.kind).toBe("IN_MEMORY");
  });

  it("requires the explicit flag before using even a loopback database", () => {
    expect(resolvePersistence({ AI_WORKFORCE_DATABASE_URL: LOCAL_URL }).kind).toBe("IN_MEMORY");
    expect(resolvePersistence({}).kind).toBe("IN_MEMORY");

    const enabled = resolvePersistence({ AI_WORKFORCE_PERSISTENCE: "database", AI_WORKFORCE_DATABASE_URL: LOCAL_URL });
    expect(enabled.kind).toBe("DATABASE");
  });
});

/* ═══════════════════════════════════════════════════════
   15. End-to-end traces
   ═══════════════════════════════════════════════════════ */

describe("15. end-to-end trace — approve", () => {
  it("walks persistent job → approval → resume → execute ONCE → persist → reload", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);
    const approvalId = parked.job.approvalId as string;

    const decision = await h.core.approvalService.approve({ approvalId, actor: superAdmin(), reason: "موافقة بشرية" });

    const restarted = h.restart("r");
    const finalJob = (await restarted.core.jobs.getJob(job.id)) as Job;
    const run = finalJob.runId ? await restarted.core.recorder.getRun(finalJob.runId) : null;
    const trail = await restarted.core.recorder.listJobEvents(job.id, 200);

    console.log(
      [
        "",
        "════════ PHASE 1B — PERSISTENT JOB → APPROVAL → EXECUTE ONCE ════════",
        `job          ${finalJob.id}   capability=${finalJob.capability}   trigger=${finalJob.trigger} autonomy=${finalJob.autonomy}`,
        `approval     ${approvalId}`,
        `requester    ${parked.job.actorUserId}   requestedFor=${(await restarted.core.approvalService.get(approvalId)).requestedForUserId}`,
        `decision     APPROVED by ${(await restarted.core.approvalService.get(approvalId)).decidedByUserId} at ${(await restarted.core.approvalService.get(approvalId)).decidedAt}`,
        `job status   ${finalJob.status}`,
        `history      ${finalJob.history.map((step) => `${step.from}→${step.to}`).join("  ")}`,
        `run          ${run?.id}  status=${run?.status}  attempts=1`,
        `result       ${JSON.stringify(run?.output)}`,
        "──────── persisted audit trail (oldest first) ────────",
        ...trail.map((event) => `${event.at}  ${event.type.padEnd(22)} run=${event.runId ?? "-"}  tool=${event.toolId ?? "-"}`),
        `handler executions = ${h.tool.executions()}  (must be exactly 1)`,
        "═══════════════════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );

    expect(decision.idempotent).toBe(false);
    expect(finalJob.status).toBe("COMPLETED");
    expect(finalJob.history.map((step) => step.to)).toEqual([
      "PLANNED",
      "WAITING_APPROVAL",
      "READY",
      "RUNNING",
      "COMPLETED",
    ]);
    expect(run?.status).toBe("SUCCEEDED");
    expect(h.tool.executions()).toBe(1);

    // Order of the persisted trail: request → decision → execution → completion.
    const types = trail.map((event) => event.type);
    expect(types).toContain("approval.requested");
    expect(types).toContain("approval.decided");
    expect(types.indexOf("approval.requested")).toBeLessThan(types.indexOf("approval.decided"));
    expect(types.indexOf("approval.decided")).toBeLessThan(types.indexOf("tool.invoked"));
    expect(types.indexOf("tool.invoked")).toBeLessThan(types.indexOf("run.finished"));

    // Reloaded state is identical to the live state — nothing lives in the runner.
    const liveJob = await h.core.jobs.getJob(job.id);
    expect(finalJob).toEqual(liveJob);
  });
});

describe("15b. end-to-end trace — reject", () => {
  it("walks job → approval → reject → tool NOT executed", async () => {
    const h = harness();
    const job = await h.core.jobs.create({ capability: CAPABILITY, input: INPUT, context: context(superAdmin(), { source: "EVENT" }) });
    const parked = await h.core.jobs.run(job.id);
    const approvalId = parked.job.approvalId as string;

    const decision = await h.core.approvalService.reject({ approvalId, actor: superAdmin(), reason: "غير مبرَّر" });

    const restarted = h.restart("r");
    const finalJob = (await restarted.core.jobs.getJob(job.id)) as Job;
    const trail = await restarted.core.recorder.listJobEvents(job.id, 200);

    console.log(
      [
        "",
        "════════ PHASE 1B — PERSISTENT JOB → APPROVAL → REJECTION ════════",
        `job          ${finalJob.id}   capability=${finalJob.capability}`,
        `approval     ${approvalId}   status=${decision.approval.status}   reason=${decision.approval.decisionReason}`,
        `job status   ${finalJob.status}`,
        `run          none — toolExecuted=${String(false)}`,
        `handler executions = ${h.tool.executions()}  (must be exactly 0)`,
        `audit        ${trail.map((event) => event.type).join(" → ")}`,
        "══════════════════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );

    expect(decision.approval.status).toBe("REJECTED");
    expect(finalJob.status).toBe("BLOCKED");
    expect(h.tool.executions()).toBe(0);
    expect(await restarted.core.recorder.listRuns(10)).toHaveLength(0);
    expect(trail.map((event) => event.type)).not.toContain("tool.invoked");
  });
});
