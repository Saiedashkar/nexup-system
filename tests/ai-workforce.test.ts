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
import type { JsonObject } from "@/modules/ai-workforce/core/types";
import type { ClientSummary, ProjectSummary, WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { applyTransition } from "@/modules/ai-workforce/jobs/job-state-machine";
import type { Job } from "@/modules/ai-workforce/jobs/job-contracts";
import { derivePermissionTokens } from "@/modules/ai-workforce/policies/permission-policy";
import { resolveCapability, findCapabilities } from "@/modules/ai-workforce/registry/capability-lookup";
import { defineTool, type ToolAdapter } from "@/modules/ai-workforce/registry/tool-definition";
import { ToolRegistry } from "@/modules/ai-workforce/registry/tool-registry";
import { workforceToolAdapters } from "@/modules/ai-workforce/tools";
import { clientSearchTool } from "@/modules/ai-workforce/tools/adapters/client.tools";

/* ═══════════════════════════════════════════════════════
   Fixtures — no database, no network, no AI provider
   ═══════════════════════════════════════════════════════ */

const BIZ = { id: "biz_nexup", slug: "nexup" };
const OTHER_BIZ = { id: "biz_rebound", slug: "rebound" };

const CLIENT_ROWS: ClientSummary[] = [
  { id: "cli_1", businessId: BIZ.id, name: "شركة النور", phone: "01000000001", tier: "VIP" },
  { id: "cli_2", businessId: BIZ.id, name: "مؤسسة الفجر", phone: "01000000002", tier: "NORMAL" },
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

function createFakePorts() {
  const calls = { clientSearch: [] as unknown[], projectList: [] as unknown[], capitalSummary: 0 };

  const ports: WorkforcePorts = {
    clients: {
      async search(input) {
        calls.clientSearch.push(input);
        const needle = input.query.trim().toLowerCase();
        return CLIENT_ROWS.filter(
          (row) => row.businessId === input.businessId && (row.name.includes(input.query) || row.phone.includes(needle)),
        ).slice(0, input.limit);
      },
    },
    projects: {
      async list(input) {
        calls.projectList.push(input);
        return PROJECT_ROWS.filter(
          (row) =>
            row.businessId === input.businessId &&
            (!input.workStatus || row.workStatus === input.workStatus) &&
            (!input.paymentStatus || row.paymentStatus === input.paymentStatus),
        ).slice(0, input.limit);
      },
    },
    capital: {
      async summary() {
        calls.capitalSummary += 1;
        return {
          totalReceived: 100_000,
          totalSpent: 25_000,
          available: 75_000,
          contributionCount: 3,
          spendCount: 5,
          funderCount: 2,
        };
      },
    },
  };

  return { ports, calls };
}

/** SUPER_ADMIN — every token. */
function superAdminActor(): ActorContext {
  return actor({ role: "SUPER_ADMIN", isSuperAdmin: true, hasOfficeFinanceFull: true, slugs: ["nexup", "rebound", "abomazen"] });
}

/** ADMIN of NEXUP — read/write on clients and projects. */
function nexupAdminActor(): ActorContext {
  return actor({ role: "ADMIN", isSuperAdmin: false, hasOfficeFinanceFull: false, slugs: ["nexup"] });
}

/** EMPLOYEE — clients only, within one business (legacy semantics). */
function employeeActor(): ActorContext {
  return actor({ role: "EMPLOYEE", isSuperAdmin: false, hasOfficeFinanceFull: false, slugs: ["nexup"] });
}

/** Office-finance admin with NO business access — capital only. */
function officeFinanceActor(): ActorContext {
  return actor({ role: "ADMIN", isSuperAdmin: false, hasOfficeFinanceFull: true, slugs: [] });
}

function actor(input: {
  role: string;
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  slugs: string[];
}): ActorContext {
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

function makeContext(options: {
  actor: ActorContext;
  business?: { id: string; slug: string } | null;
  source?: "MANUAL" | "EVENT" | "AGENT" | "SCHEDULE" | "WEBHOOK" | "SYSTEM";
  approvalId?: string;
  ids?: { next(kind: string): string };
}) {
  return createExecutionContext({
    serviceIdentity: createServiceIdentity("LOCAL"),
    actor: options.actor,
    business: options.business ?? null,
    source: options.source ?? "MANUAL",
    approvalId: options.approvalId,
    ids: options.ids,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

/* ── Test-only capabilities ─────────────────────────── */

const readOnlyHandler = async () => ({ ok: true });

/** HIGH risk, read-only, approval always required. */
const highApprovalTool: ToolAdapter = defineTool(
  {
    id: "system.report",
    name: "تقرير حسّاس",
    description: "أداة اختبار بخطورة عالية تتطلب موافقة بشرية.",
    domain: "system",
    action: "report",
    riskLevel: "HIGH",
    readWriteMode: "READ",
    inputSchema: { kind: "object", fields: {} },
    outputSchema: { kind: "object", fields: {} },
    requiredPermissions: ["aiworkforce.access"],
    requiresApproval: true,
  },
  readOnlyHandler,
);

/** CRITICAL (destructive semantics) — must never run autonomously. */
const criticalTool: ToolAdapter = defineTool(
  {
    id: "system.destroy",
    name: "إتلاف نهائي",
    description: "أداة اختبار CRITICAL — ممنوعة تحت autonomy = AGENT.",
    domain: "system",
    action: "destroy",
    riskLevel: "CRITICAL",
    readWriteMode: "WRITE",
    inputSchema: { kind: "object", fields: {} },
    outputSchema: { kind: "object", fields: {} },
    requiredPermissions: ["aiworkforce.access"],
    requiresApproval: true,
  },
  readOnlyHandler,
);

/** LOW risk tool whose handler always fails. */
const explodingTool: ToolAdapter = defineTool(
  {
    id: "system.explode",
    name: "أداة فاشلة",
    description: "أداة اختبار ترمي خطأ لاختبار تسجيل Run فاشل.",
    domain: "system",
    action: "explode",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: { kind: "object", fields: {} },
    outputSchema: { kind: "object", fields: {} },
    requiredPermissions: ["aiworkforce.access"],
  },
  async () => {
    throw new AiWorkforceError("TOOL_EXECUTION_FAILED", "handler blew up on purpose");
  },
);

/** Registered but disabled. */
const disabledTool: ToolAdapter = defineTool(
  {
    id: "system.hidden",
    name: "أداة معطّلة",
    description: "أداة اختبار معطّلة لا يجب أن تُنفَّذ.",
    domain: "system",
    action: "hidden",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: { kind: "object", fields: {} },
    outputSchema: { kind: "object", fields: {} },
    requiredPermissions: ["aiworkforce.access"],
    enabled: false,
  },
  readOnlyHandler,
);

const TEST_TOOLS = [highApprovalTool, criticalTool, explodingTool, disabledTool];

function createTestCore(extraTools: readonly ToolAdapter[] = TEST_TOOLS) {
  const ids = createSequentialIdFactory("t");
  const now = sequentialClock("2026-01-01T00:00:00.000Z", 1000);
  const fake = createFakePorts();
  const core: ControlCore = createControlCore({
    ports: fake.ports,
    tools: [...workforceToolAdapters, ...extraTools],
    ids,
    now,
    sleep: async () => {},
  });
  return { core, calls: fake.calls, ids };
}

/* ═══════════════════════════════════════════════════════
   1. Tool registration
   ═══════════════════════════════════════════════════════ */

describe("1. Tool registration", () => {
  it("registers the Phase 1A read tools with their contracts intact", () => {
    const registry = new ToolRegistry();
    registry.registerAll(workforceToolAdapters);

    expect(registry.list().map((tool) => tool.id)).toEqual(["capital.summary", "client.search", "project.list"]);

    const search = registry.getDefinition("client.search");
    expect(search).toMatchObject({
      version: "1.0.0",
      domain: "crm",
      action: "search",
      riskLevel: "LOW",
      readWriteMode: "READ",
      businessScoped: true,
      enabled: true,
      requiresApproval: false,
    });
    expect(search?.requiredPermissions).toContain("clients.read");
    expect(search?.estimatedCostPolicy.kind).toBe("NONE");
    expect(search?.timeoutPolicy.timeoutMs).toBeGreaterThan(0);
  });

  it("refuses a tool whose declared risk understates its semantics", () => {
    const registry = new ToolRegistry();
    const understated = defineTool(
      {
        id: "system.purge",
        name: "إتلاف",
        description: "يدّعي LOW رغم أنه إتلاف نهائي",
        domain: "system",
        action: "purge",
        riskLevel: "LOW",
        readWriteMode: "WRITE",
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        requiredPermissions: ["aiworkforce.access"],
      },
      readOnlyHandler,
    );

    expect(() => registry.register(understated)).toThrow(/at least CRITICAL/);
  });

  it("refuses a money-writing tool that does not require approval", () => {
    const registry = new ToolRegistry();
    const unsafeCapitalWrite = defineTool(
      {
        id: "capital.spend",
        name: "تسجيل مصروف رأس مال",
        description: "كتابة مالية بدون موافقة — يجب أن تُرفض",
        domain: "capital",
        action: "spend",
        riskLevel: "HIGH",
        readWriteMode: "WRITE",
        inputSchema: { kind: "object", fields: {} },
        outputSchema: { kind: "object", fields: {} },
        requiredPermissions: ["aiworkforce.access", "capital.write"],
        requiresApproval: false,
      },
      readOnlyHandler,
    );

    expect(() => registry.register(unsafeCapitalWrite)).toThrow(/must require approval/);
  });

  it("looks capabilities up by mode and risk ceiling", () => {
    const registry = new ToolRegistry();
    registry.registerAll(workforceToolAdapters);

    const lowReads = findCapabilities(registry, { readWriteMode: "READ", maxRiskLevel: "LOW" });
    expect(lowReads.map((tool) => tool.id)).toHaveLength(3);
    expect(findCapabilities(registry, { domain: "capital" }).map((tool) => tool.id)).toEqual(["capital.summary"]);
  });
});

/* ═══════════════════════════════════════════════════════
   2. Duplicate tool id
   ═══════════════════════════════════════════════════════ */

describe("2. duplicate Tool ID rejected", () => {
  it("throws DUPLICATE_TOOL_ID on a second registration", () => {
    const registry = new ToolRegistry();
    registry.register(clientSearchTool);

    try {
      registry.register(clientSearchTool);
      throw new Error("expected a duplicate-id failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AiWorkforceError);
      expect((error as AiWorkforceError).code).toBe("DUPLICATE_TOOL_ID");
    }

    expect(registry.size()).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════
   3. Disabled tool
   ═══════════════════════════════════════════════════════ */

describe("3. disabled Tool cannot execute", () => {
  it("is refused by capability lookup", () => {
    const { core } = createTestCore();
    expect(core.registry.has("system.hidden")).toBe(true);

    try {
      resolveCapability(core.registry, "system.hidden");
      throw new Error("expected the disabled tool to be refused");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("TOOL_DISABLED");
    }
  });

  it("never reaches tool execution through the runtime", async () => {
    const { core } = createTestCore();

    await expect(
      core.runtime.execute({ capability: "system.hidden", input: {}, context: makeContext({ actor: superAdminActor() }) }),
    ).rejects.toThrow(/disabled/);

    // Nothing was executed, so no run was recorded either.
    expect(await core.recorder.listRuns()).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════
   4. Permission denied
   ═══════════════════════════════════════════════════════ */

describe("4. permission denied", () => {
  it("refuses a capability the actor has no token for", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: employeeActor(), business: BIZ });

    await expect(core.runtime.execute({ capability: "project.list", input: { businessId: BIZ.id }, context })).rejects.toThrow(
      /Permission denied|no permission/i,
    );

    const [run] = await core.recorder.listRuns();
    expect(run.status).toBe("BLOCKED");
    expect(run.errorCode).toBe("PERMISSION_DENIED");
  });

  it("refuses when the execution scope is outside the actor's businesses", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: OTHER_BIZ });

    try {
      await core.runtime.execute({ capability: "client.search", input: { businessId: OTHER_BIZ.id, query: "شركة" }, context });
      throw new Error("expected a scope denial");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("SCOPE_DENIED");
    }
  });

  it("refuses tool input that tries to widen the session scope", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    try {
      await core.runtime.execute({ capability: "client.search", input: { businessId: OTHER_BIZ.id, query: "شركة" }, context });
      throw new Error("expected a scope denial");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("SCOPE_DENIED");
    }
  });

  it("refuses an actor with no workforce access at all", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: createSystemActor() });

    try {
      await core.runtime.execute({ capability: "capital.summary", input: {}, context });
      throw new Error("expected the module gate to fire");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("PERMISSION_DENIED");
      expect((error as AiWorkforceError).details?.reason).toBe("MODULE_DISABLED");
    }
  });

  it("allows the same read capability for an authorised actor (least privilege, both ways)", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: employeeActor(), business: BIZ });

    const result = await core.runtime.execute({
      capability: "client.search",
      input: { businessId: BIZ.id, query: "شركة" },
      context,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.permission.allowed).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════
   5. Approval required blocks execution
   ═══════════════════════════════════════════════════════ */

describe("5. approval required blocks execution", () => {
  it("blocks an autonomous execution of a HIGH capability", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "EVENT" });

    try {
      await core.runtime.execute({ capability: "system.report", input: {}, context });
      throw new Error("expected the approval gate to block execution");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("APPROVAL_REQUIRED");
    }

    const [run] = await core.recorder.listRuns();
    expect(run.status).toBe("WAITING_APPROVAL");
    expect(run.errorCode).toBe("APPROVAL_REQUIRED");
  });

  it("lets a manual human execution through (presence is the approval)", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "MANUAL" });

    const result = await core.runtime.execute({ capability: "system.report", input: {}, context });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.approval?.reason).toBe("HUMAN_PRESENT");
  });

  it("parks the job in WAITING_APPROVAL and raises an approval request", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "EVENT" });

    const job = await core.jobs.create({ capability: "system.report", input: {}, context });
    const outcome = await core.jobs.run(job.id);

    expect(outcome.status).toBe("WAITING_APPROVAL");
    expect(outcome.job.approvalId).toBeDefined();

    const [approval] = await core.approvals.list();
    expect(approval).toMatchObject({ status: "PENDING", toolId: "system.report", riskLevel: "HIGH" });
  });
});

/* ═══════════════════════════════════════════════════════
   6. LOW read tool executes
   ═══════════════════════════════════════════════════════ */

describe("6. LOW read tool executes", () => {
  it("returns structured data through the port", async () => {
    const { core, calls } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    const result = await core.runtime.execute({
      capability: "client.search",
      input: { businessId: BIZ.id, query: "شركة" },
      context,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.riskLevel).toBe("LOW");
    expect(result.output).toMatchObject({ businessId: BIZ.id, count: 1 });

    // Schema defaults are applied before the handler runs.
    expect(calls.clientSearch[0]).toMatchObject({ businessId: BIZ.id, limit: 20 });
  });

  it("executes capital.summary without a business scope", async () => {
    const { core, calls } = createTestCore();
    const context = makeContext({ actor: officeFinanceActor(), business: null });

    const result = await core.runtime.execute({ capability: "capital.summary", input: {}, context });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.output).toMatchObject({ currency: "EGP", available: 75_000, availablePiasters: 7_500_000 });
    expect(calls.capitalSummary).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════
   7. Invalid input
   ═══════════════════════════════════════════════════════ */

describe("7. invalid input rejected", () => {
  it("rejects an input that violates the schema", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    try {
      await core.runtime.execute({ capability: "client.search", input: { businessId: BIZ.id, query: "" }, context });
      throw new Error("expected input validation to fail");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("INVALID_INPUT");
    }

    const [run] = await core.recorder.listRuns();
    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBe("INVALID_INPUT");
  });

  it("rejects unknown fields and reports them in preflight", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    const preflight = await core.runtime.preflight({
      capability: "client.search",
      input: { businessId: BIZ.id, query: "شركة", surprise: 1 } as unknown as JsonObject,
      context,
    });

    expect(preflight.blocked).toBe(true);
    expect(preflight.inputValid).toBe(false);
    expect(preflight.inputIssues.map((issue) => issue.code)).toContain("unknown_field");
  });

  it("rejects an unknown capability", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor() });

    const preflight = await core.runtime.preflight({ capability: "nope.nothing", input: {}, context });
    expect(preflight.resolved).toBe(false);
    expect(preflight.blockedCode).toBe("TOOL_NOT_FOUND");
  });
});

/* ═══════════════════════════════════════════════════════
   8. Invalid job transition
   ═══════════════════════════════════════════════════════ */

describe("8. invalid job transition rejected", () => {
  const baseJob: Job = {
    id: "job_1",
    status: "COMPLETED",
    trigger: "MANUAL",
    autonomy: "HUMAN",
    capability: "client.search",
    input: {},
    actorUserId: "u1",
    correlationId: "c1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    history: [],
  };

  it("refuses to leave a terminal status", () => {
    expect(() => applyTransition(baseJob, "RUNNING", "nope", "2026-01-01T00:00:02.000Z")).toThrow(/Cannot move a job/);
  });

  it("refuses a transition that skips the state machine", () => {
    const created: Job = { ...baseJob, status: "CREATED" };
    expect(() => applyTransition(created, "RUNNING", "nope", "2026-01-01T00:00:02.000Z")).toThrow(/Cannot move a job/);

    const planned = applyTransition(created, "PLANNED", "ok", "2026-01-01T00:00:02.000Z");
    expect(planned.status).toBe("PLANNED");
    expect(planned.history).toHaveLength(1);
  });

  it("refuses to run a job that already finished", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });
    const job = await core.jobs.create({ capability: "client.search", input: { businessId: BIZ.id, query: "شركة" }, context });

    const first = await core.jobs.run(job.id);
    expect(first.status).toBe("COMPLETED");

    await expect(core.jobs.run(job.id)).rejects.toThrow(/already finished/);
  });
});

/* ═══════════════════════════════════════════════════════
   9 + 10. Run records
   ═══════════════════════════════════════════════════════ */

describe("9. failed tool creates failed Run", () => {
  it("records a FAILED run with the tool error code", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor() });

    await expect(core.runtime.execute({ capability: "system.explode", input: {}, context })).rejects.toThrow(/blew up/);

    const [run] = await core.recorder.listRuns();
    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBe("TOOL_EXECUTION_FAILED");

    const events = await core.recorder.listEvents();
    expect(events.map((event) => event.type)).toContain("tool.failed");
    const finished = events.find((event) => event.type === "run.finished");
    expect(finished?.payload).toMatchObject({ status: "FAILED" });
  });
});

describe("10. completed tool creates completed Run", () => {
  it("records a SUCCEEDED run with a full audit trail", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    const result = await core.runtime.execute({
      capability: "client.search",
      input: { businessId: BIZ.id, query: "شركة" },
      context,
    });

    expect(result.run?.status).toBe("SUCCEEDED");
    expect(result.run?.toolId).toBe("client.search");
    expect(result.run?.runtimeKind).toBe("LOCAL");

    const events = (await core.recorder.listEvents()).map((event) => event.type);
    expect(events).toContain("run.started");
    expect(events).toContain("capability.resolved");
    expect(events).toContain("policy.checked");
    expect(events).toContain("approval.evaluated");
    expect(events).toContain("tool.invoked");
    expect(events).toContain("tool.succeeded");
    expect(events).toContain("run.finished");
  });
});

/* ═══════════════════════════════════════════════════════
   11. CRITICAL cannot run autonomously
   ═══════════════════════════════════════════════════════ */

describe("11. CRITICAL cannot run autonomously", () => {
  it("refuses AGENT autonomy outright", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "EVENT" });

    try {
      await core.runtime.execute({ capability: "system.destroy", input: {}, context });
      throw new Error("expected the CRITICAL autonomy guard to fire");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("CRITICAL_AUTONOMY_FORBIDDEN");
    }
  });

  it("refuses a human execution without an explicit approval", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "MANUAL" });

    try {
      await core.runtime.execute({ capability: "system.destroy", input: {}, context });
      throw new Error("expected an explicit approval requirement");
    } catch (error) {
      expect((error as AiWorkforceError).code).toBe("APPROVAL_REQUIRED");
      expect((error as AiWorkforceError).details?.reason).toBe("CRITICAL_REQUIRES_EXPLICIT_APPROVAL");
    }
  });

  it("runs only after a recorded human approval", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "MANUAL" });

    const tool = core.registry.getDefinition("system.destroy")!;
    const approval = await core.approvals.request({ tool, context, reason: "تفويض إتلاف نهائي (اختبار)" });
    const decided = await core.approvals.decide({ approvalId: approval.id, decision: "APPROVED", byUserId: "user_super_admin" });

    expect(decided.status).toBe("APPROVED");

    const approvedContext = makeContext({ actor: superAdminActor(), source: "MANUAL", approvalId: decided.id });
    const result = await core.runtime.execute({ capability: "system.destroy", input: {}, context: approvedContext });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.approval?.reason).toBe("APPROVAL_APPROVED");
  });

  it("keeps an approval single-use", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: superAdminActor(), source: "MANUAL" });
    const tool = core.registry.getDefinition("system.destroy")!;
    const approval = await core.approvals.request({ tool, context, reason: "مرة واحدة" });

    await core.approvals.decide({ approvalId: approval.id, decision: "REJECTED", byUserId: "user_super_admin" });
    await expect(
      core.approvals.decide({ approvalId: approval.id, decision: "APPROVED", byUserId: "user_super_admin" }),
    ).rejects.toThrow(/already decided/);
  });
});

/* ═══════════════════════════════════════════════════════
   12. End-to-end manual job trace
   ═══════════════════════════════════════════════════════ */

describe("12. end-to-end manual job trace", () => {
  it("walks Human → Job → Runtime → Registry → Policy → Gate → Tool → Result → Audit", async () => {
    const { core } = createTestCore();
    const context = makeContext({ actor: nexupAdminActor(), business: BIZ });

    /* Job */
    const job = await core.jobs.create({
      capability: "client.search",
      input: { businessId: BIZ.id, query: "شركة" },
      context,
    });

    /* Runtime drives the rest */
    const outcome = await core.jobs.run(job.id);

    const events = (await core.recorder.listEvents(200)).reverse();
    const trace = events.map((event) => ({
      at: event.at,
      type: event.type,
      runId: event.runId ?? "-",
      tool: event.toolId ?? "-",
      payload: event.payload,
    }));

    console.log(
      [
        "",
        "════════ PHASE 1A — END-TO-END MANUAL JOB TRACE ════════",
        `job        ${outcome.job.id}`,
        `capability ${outcome.job.capability} → ${outcome.job.resolvedToolId}`,
        `trigger    ${outcome.job.trigger}   autonomy=${outcome.job.autonomy}`,
        `run        ${outcome.run?.id}   status=${outcome.run?.status}`,
        `job status ${outcome.job.status}`,
        `history    ${outcome.job.history.map((step: { from: string | null; to: string }) => `${step.from}→${step.to}`).join("  ")}`,
        "──────── audit events ────────",
        ...trace.map((item) => `${item.at}  ${item.type.padEnd(22)} run=${item.runId}  tool=${item.tool}`),
        `result     ${JSON.stringify(outcome.output)}`,
        "═══════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );

    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.job.history.map((step: { to: string }) => step.to)).toEqual([
      "PLANNED",
      "READY",
      "RUNNING",
      "COMPLETED",
    ]);

    // The audit trail is the ordered proof of the execution model.
    expect(trace.map((item) => item.type)).toEqual([
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

    // Every event is correlated to the same run and the same actor.
    expect(trace.every((item) => item.runId === "-" || item.runId === outcome.run?.id)).toBe(true);
    expect(outcome.run?.status).toBe("SUCCEEDED");
    expect(outcome.output).toMatchObject({ count: 1 });
  });

  it("does not touch the legacy surface (no ports, no writes, no external calls)", () => {
    const { core } = createTestCore();
    const description = core.runtime.describe();

    expect(description.kind).toBe("LOCAL");
    expect(description.aiProvider).toBe("NONE");
    expect(description.persistence).toBe("IN_MEMORY");
    expect(description.externalCalls).toBe(false);
    expect(description.tools).toMatchObject({ read: 6, write: 1 });
  });
});
