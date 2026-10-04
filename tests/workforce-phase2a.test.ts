import { describe, expect, it } from "vitest";

import { createControlCore, type ControlCore } from "@/modules/ai-workforce/core/create-core";
import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import {
  createExecutionContext,
  createServiceIdentity,
  type ActorContext,
} from "@/modules/ai-workforce/core/execution-context";
import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { derivePermissionTokens } from "@/modules/ai-workforce/policies/permission-policy";
import { defineTool } from "@/modules/ai-workforce/registry/tool-definition";

import {
  assertExecutionContextSafe,
  createActorExecutionContext,
  createWorkforceDomain,
  DeterministicRuntimeAdapter,
  execActorRegistration,
  founderActorRegistration,
  hasCredentials,
  type Actor,
  type ActorExecutionContext,
  type WorkforceDomain,
} from "@/modules/workforce";

/* ═══════════════════════════════════════════════════════
   Fixtures — no database, no network, no AI provider
   ═══════════════════════════════════════════════════════ */

function domain(): WorkforceDomain {
  return createWorkforceDomain({
    ids: createSequentialIdFactory("w"),
    now: sequentialClock("2026-03-01T00:00:00.000Z", 1000),
  });
}

async function aiAgent(domainRef: WorkforceDomain, slug = "growth-lead"): Promise<Actor> {
  return domainRef.actors.register({
    slug,
    displayName: "Growth Lead",
    type: "AI_AGENT",
    role: "specialist",
    department: "growth-revenue",
    reportsTo: null,
    collaborators: [],
    lifecycle: "SHADOW",
    runtimeBinding: { runtimeId: "runtime_deterministic", runtimeType: "DETERMINISTIC_LOCAL" },
    modelPolicy: { strategy: "RUNTIME_DEFAULT" },
    autonomyLevel: "ASSISTED",
    memoryScope: { scope: "DEPARTMENT", retention: "SESSION" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "INHERIT" },
    escalationTarget: null,
    metadata: {},
  });
}

async function humanActor(domainRef: WorkforceDomain, slug = "sales-lead"): Promise<Actor> {
  return domainRef.actors.register({
    slug,
    displayName: "Sales Lead",
    type: "HUMAN",
    role: "department-lead",
    department: "growth-revenue",
    reportsTo: null,
    collaborators: [],
    lifecycle: "APPROVED_AUTONOMY",
    runtimeBinding: null,
    modelPolicy: null,
    autonomyLevel: "AUTONOMOUS",
    memoryScope: { scope: "ORGANIZATION", retention: "LONG_TERM" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "NEVER" },
    escalationTarget: null,
    metadata: {},
  });
}

/* ═══════════════════════════════════════════════════════
   1. Actor Registry
   ═══════════════════════════════════════════════════════ */

describe("1. actor registry", () => {
  it("registers an AI actor and a human actor as first-class identities", async () => {
    const d = domain();
    const agent = await aiAgent(d);
    const human = await humanActor(d);

    expect(agent.type).toBe("AI_AGENT");
    expect(agent.runtimeBinding?.runtimeId).toBe("runtime_deterministic");
    expect(human.type).toBe("HUMAN");
    // A human carries NO runtime binding — human work is first-class without a fake runtime.
    expect(human.runtimeBinding).toBeNull();
  });

  it("resolves by id and by slug", async () => {
    const d = domain();
    const agent = await aiAgent(d);

    expect((await d.actors.require(agent.id)).slug).toBe("growth-lead");
    expect((await d.actors.findBySlug("growth-lead"))?.id).toBe(agent.id);
    expect((await d.actors.resolve("growth-lead")).id).toBe(agent.id);
    await expect(d.actors.resolve("does-not-exist")).rejects.toThrow(/No actor matches/);
  });

  it("rejects a duplicate slug", async () => {
    const d = domain();
    await aiAgent(d);
    await expect(aiAgent(d)).rejects.toThrow(/already taken/);
  });

  it("enforces the lifecycle state machine", async () => {
    const d = domain();
    const agent = await aiAgent(d); // SHADOW
    expect(agent.lifecycle).toBe("SHADOW");

    const assisted = await d.actors.updateLifecycle(agent.id, "ASSISTED", "graduated from shadow");
    expect(assisted.lifecycle).toBe("ASSISTED");
    // The reason is retained as audit context.
    expect(assisted.metadata.lifecycleReason).toBe("graduated from shadow");

    await expect(d.actors.updateLifecycle(agent.id, "DRAFT")).rejects.toThrow(/cannot move from/i);
  });

  it("refuses to store credentials in an actor record", async () => {
    const d = domain();
    await expect(
      d.actors.register({
        slug: "leaky-agent",
        displayName: "Leaky",
        type: "AI_AGENT",
        role: "specialist",
        department: null,
        reportsTo: null,
        collaborators: [],
        lifecycle: "DRAFT",
        runtimeBinding: null,
        modelPolicy: null,
        autonomyLevel: "MANUAL",
        memoryScope: { scope: "NONE" },
        permissions: [],
        approvalPolicy: { mode: "INHERIT" },
        escalationTarget: null,
        // A secret smuggled into metadata must be caught by the guard.
        metadata: { apiKey: "sk-live-should-never-be-stored" },
      }),
    ).rejects.toThrow(/must not carry credentials/);
  });

  it("rejects a human actor that carries a runtime binding", async () => {
    const d = domain();
    await expect(
      d.actors.register({
        slug: "fake-human",
        displayName: "Fake Human",
        type: "HUMAN",
        role: "specialist",
        department: null,
        reportsTo: null,
        collaborators: [],
        lifecycle: "APPROVED_AUTONOMY",
        runtimeBinding: { runtimeId: "runtime_deterministic", runtimeType: "DETERMINISTIC_LOCAL" },
        modelPolicy: null,
        autonomyLevel: "MANUAL",
        memoryScope: { scope: "NONE" },
        permissions: [],
        approvalPolicy: { mode: "INHERIT" },
        escalationTarget: null,
        metadata: {},
      }),
    ).rejects.toThrow(/must not carry a runtime binding/);
  });

  it("represents EXEC as a special actor and the Founder as human authority", async () => {
    const d = domain();
    const exec = await d.actors.register(execActorRegistration());
    const founder = await d.actors.register(founderActorRegistration());

    expect(exec.type).toBe("EXECUTIVE");
    expect(exec.role).toBe("orchestrator");
    expect(exec.runtimeBinding).toBeNull();
    expect(exec.escalationTarget).toBe(founder.id);
    expect(founder.type).toBe("HUMAN");
  });
});

/* ═══════════════════════════════════════════════════════
   2. Capability Registry
   ═══════════════════════════════════════════════════════ */

describe("2. capability registry", () => {
  it("keeps tool, skill and workflow distinct", async () => {
    const d = domain();

    const tool = await d.capabilities.register({
      id: "lead.create",
      name: "Create lead",
      kind: "TOOL",
      version: "1.0.0",
      description: "atomic lead creation",
      owner: "growth-lead",
      riskLevel: "MEDIUM",
    });

    const skill = await d.capabilities.register({
      id: "lead.qualify",
      name: "Qualify a Saudi legal lead",
      kind: "SKILL",
      version: "1.0.0",
      description: "procedural SOP knowledge",
      owner: "growth-lead",
      riskLevel: "LOW",
      procedureRef: "sop://growth/qualify-saudi-legal",
    });

    const workflow = await d.capabilities.register({
      id: "lead.flow",
      name: "Lead pipeline",
      kind: "WORKFLOW",
      version: "1.0.0",
      description: "create → score → human review",
      owner: "growth-lead",
      riskLevel: "MEDIUM",
      composition: {
        steps: [
          { kind: "TOOL", ref: "lead.create", version: "1.0.0" },
          { kind: "SKILL", ref: "lead.qualify" },
          { kind: "HUMAN", roleRef: "department-lead" },
        ],
      },
    });

    expect(tool.kind).toBe("TOOL");
    expect(skill.kind).toBe("SKILL");
    expect(workflow.kind).toBe("WORKFLOW");
    expect(workflow.composition?.steps).toHaveLength(3);
  });

  it("rejects a shape that blurs the kinds", async () => {
    const d = domain();

    // SKILL without its SOP reference.
    await expect(
      d.capabilities.register({
        id: "lead.bad-skill",
        name: "No SOP",
        kind: "SKILL",
        version: "1.0.0",
        description: "missing procedureRef",
        owner: "growth-lead",
        riskLevel: "LOW",
      }),
    ).rejects.toThrow(/requires a procedureRef/);

    // WORKFLOW without a composition.
    await expect(
      d.capabilities.register({
        id: "lead.empty-flow",
        name: "Empty workflow",
        kind: "WORKFLOW",
        version: "1.0.0",
        description: "no steps",
        owner: "growth-lead",
        riskLevel: "LOW",
      }),
    ).rejects.toThrow(/requires a composition/);
  });

  it("treats id + version as the identity", async () => {
    const d = domain();
    const base = {
      id: "lead.score",
      name: "Score lead",
      kind: "TOOL" as const,
      description: "score a lead",
      owner: "growth-lead",
      riskLevel: "LOW" as const,
      status: "ACTIVE" as const,
    };

    await d.capabilities.register({ ...base, version: "1.0.0" });
    await d.capabilities.register({ ...base, version: "1.1.0" });

    // Same id + version is a conflict, never a silent overwrite.
    await expect(d.capabilities.register({ ...base, version: "1.0.0" })).rejects.toThrow(AiWorkforceError);

    // A bare id resolves to the highest ACTIVE version; an explicit version is exact.
    expect((await d.capabilities.require("lead.score")).version).toBe("1.1.0");
    expect((await d.capabilities.require("lead.score", "1.0.0")).version).toBe("1.0.0");
    expect(await d.capabilities.listVersions("lead.score")).toHaveLength(2);
  });

  it("refuses credentials inside a capability record", async () => {
    const d = domain();
    await expect(
      d.capabilities.register({
        id: "x.publish",
        name: "Publish to X",
        kind: "TOOL",
        version: "1.0.0",
        description: "outbound publish",
        owner: "growth-lead",
        riskLevel: "HIGH",
        // Provider credentials smuggled into metadata must be caught.
        metadata: { accessToken: "bearer-should-never-be-stored" },
      }),
    ).rejects.toThrow(/must not carry credentials/);
  });
});

/* ═══════════════════════════════════════════════════════
   3. Actor ↔ capability assignment
   ═══════════════════════════════════════════════════════ */

describe("3. actor ↔ capability assignment", () => {
  async function setup() {
    const d = domain();
    const agent = await aiAgent(d);
    const capability = await d.capabilities.register({
      id: "lead.create",
      name: "Create lead",
      kind: "TOOL",
      version: "1.0.0",
      description: "atomic",
      owner: "growth-lead",
      riskLevel: "MEDIUM",
      status: "ACTIVE",
    });
    return { d, agent, capability };
  }

  it("grants and revokes a capability edge independently of the actor record", async () => {
    const { d, agent, capability } = await setup();

    const assignment = await d.assignments.assign({
      actorId: agent.id,
      capabilityId: capability.id,
      grantedBy: "founder",
    });
    expect(assignment.status).toBe("ACTIVE");
    expect(assignment.capabilityVersion).toBe("1.0.0");
    expect(d.assignments.hasCapability(agent.id, capability.id)).toBe(true);

    const revoked = await d.assignments.revoke(assignment.id, "founder", "no longer needed");
    expect(revoked.status).toBe("REVOKED");
    expect(d.assignments.hasCapability(agent.id, capability.id)).toBe(false);
    expect(d.assignments.listForActor(agent.id)).toHaveLength(0);
    expect(d.assignments.listForActor(agent.id, { includeRevoked: true })).toHaveLength(1);

    // The actor record itself was never touched.
    const reloaded = await d.actors.require(agent.id);
    expect(reloaded).toEqual(agent);
  });

  it("rejects an assignment that points at an unknown actor or capability", async () => {
    const { d, agent, capability } = await setup();

    await expect(
      d.assignments.assign({ actorId: "actor_ghost", capabilityId: capability.id, grantedBy: "founder" }),
    ).rejects.toThrow(/unknown actor/);

    await expect(
      d.assignments.assign({ actorId: agent.id, capabilityId: "does.not.exist", grantedBy: "founder" }),
    ).rejects.toThrow(/unknown capability/);
  });

  it("refuses a duplicate active edge", async () => {
    const { d, agent, capability } = await setup();
    await d.assignments.assign({ actorId: agent.id, capabilityId: capability.id, grantedBy: "founder" });
    await expect(
      d.assignments.assign({ actorId: agent.id, capabilityId: capability.id, grantedBy: "founder" }),
    ).rejects.toThrow(/already has capability/);
  });
});

/* ═══════════════════════════════════════════════════════
   4. Runtime Registry
   ═══════════════════════════════════════════════════════ */

describe("4. runtime registry", () => {
  it("resolves a registered runtime and reports a health contract", async () => {
    const d = domain();
    d.runtimes.register(new DeterministicRuntimeAdapter({ ids: d.ids, now: d.now }));

    const runtime = d.runtimes.require("runtime_deterministic");
    const health = await runtime.healthCheck();
    expect(health.status).toBe("HEALTHY");
    expect(typeof health.checkedAt).toBe("string");

    const handle = await runtime.submitJob({
      actorId: "actor_1",
      capabilityId: "lead.create",
      traceId: "trace_1",
    });
    expect(handle.status).toBe("SUCCEEDED");

    const observed = await runtime.getExecutionStatus(handle.handleId);
    expect(observed.handleId).toBe(handle.handleId);
    expect((await runtime.cancelJob(handle.handleId)).status).toBe("CANCELLED");
  });

  it("reports an unsupported runtime as a typed error", async () => {
    const d = domain();
    expect(() => d.runtimes.require("runtime_ghost")).toThrow(/No runtime registered/);
    d.runtimes.register(new DeterministicRuntimeAdapter({ ids: d.ids, now: d.now }));
    expect(() => d.runtimes.register(new DeterministicRuntimeAdapter({ ids: d.ids, now: d.now }))).toThrow(
      /already registered/,
    );
  });

  it("returns null for humans but demands a runtime for an AI actor", async () => {
    const d = domain();
    d.runtimes.register(new DeterministicRuntimeAdapter({ ids: d.ids, now: d.now }));

    const human = await humanActor(d);
    expect(d.runtimes.runtimeForActor(human)).toBeNull();

    const bound = await aiAgent(d, "bound-agent");
    expect(d.runtimes.runtimeForActor(bound)?.identity.id).toBe("runtime_deterministic");

    const unbound = await d.actors.register({
      slug: "unbound-agent",
      displayName: "Unbound Agent",
      type: "AI_AGENT",
      role: "specialist",
      department: null,
      reportsTo: null,
      collaborators: [],
      lifecycle: "SHADOW",
      runtimeBinding: null,
      modelPolicy: { strategy: "NONE" },
      autonomyLevel: "MANUAL",
      memoryScope: { scope: "NONE" },
      permissions: [],
      approvalPolicy: { mode: "INHERIT" },
      escalationTarget: null,
      metadata: {},
    });
    expect(() => d.runtimes.runtimeForActor(unbound)).toThrow(/requires a runtime but has no runtime binding/);
  });

  it("lets a future provider adapter satisfy the same port without core changes", async () => {
    // A stand-in for a future HermesRuntimeAdapter: provider-specific detail
    // lives entirely in metadata, so the core never sees a Hermes field.
    const d = domain();
    const hermesLike = new DeterministicRuntimeAdapter({ ids: d.ids, now: d.now, id: "runtime_hermes", displayName: "Hermes" });
    d.runtimes.register(hermesLike);
    expect(d.runtimes.list().map((identity) => identity.id)).toContain("runtime_hermes");
    expect(hermesLike.identity.type).toBe("DETERMINISTIC_LOCAL");
  });
});

/* ═══════════════════════════════════════════════════════
   5. Mission
   ═══════════════════════════════════════════════════════ */

describe("5. mission", () => {
  it("creates a mission above jobs and transitions it", async () => {
    const d = domain();
    const mission = await d.missions.create({
      title: "Close Q3 legal pipeline",
      goal: "Book 10 qualified Saudi legal leads",
      createdBy: "actor_founder",
      owner: "actor_exec",
      businessId: "biz_nexup",
      priority: "HIGH",
    });

    expect(mission.state).toBe("DRAFT");
    expect(mission.jobRefs).toEqual([]);

    await d.missions.transition(mission.id, "PLANNING", "goal accepted");
    const running = await d.missions.transition(mission.id, "RUNNING", "work started");
    expect(running.state).toBe("RUNNING");
    expect(running.startedAt).toBeDefined();

    await expect(d.missions.transition(mission.id, "DRAFT", "rewind")).rejects.toThrow(/cannot move from/i);
  });

  it("attaches jobs and ownership references without duplicating job semantics", async () => {
    const d = domain();
    const mission = await d.missions.create({ title: "t", goal: "g", createdBy: "actor_founder" });

    await d.missions.attachJob(mission.id, "job_1");
    const afterAttach = await d.missions.attachJob(mission.id, "job_1"); // idempotent
    expect(afterAttach.jobRefs).toEqual(["job_1"]);

    const withOwner = await d.missions.setOwner(mission.id, "actor_exec");
    expect(withOwner.owner).toBe("actor_exec");

    const detach = await d.missions.detachJob(mission.id, "job_1");
    expect(detach.jobRefs).toEqual([]);
  });

  it("surfaces a lost compare-and-set instead of silently overwriting", async () => {
    const d = domain();
    const mission = await d.missions.create({ title: "t", goal: "g", createdBy: "actor_founder" });
    await d.missions.transition(mission.id, "PLANNING"); // stored state is now PLANNING

    // A stale writer that still believes the mission is DRAFT must lose.
    const lost = await d.missionRepository.update({ ...mission, state: "RUNNING" }, ["DRAFT"]);
    expect(lost).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
   6. Job compatibility (Phase 1 behaviour preserved)
   ═══════════════════════════════════════════════════════ */

const pingTool = defineTool(
  {
    id: "system.ping",
    name: "ping",
    description: "test read capability",
    domain: "system",
    action: "ping",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: { kind: "object", fields: {} },
    outputSchema: { kind: "object", fields: {} },
    requiredPermissions: ["aiworkforce.access"],
  },
  async () => ({ ok: true }),
);

function fakePorts(): WorkforcePorts {
  return {
    clients: { async search() { return []; } },
    projects: { async list() { return []; } },
    capital: { async summary() { return { totalReceived: 0, totalSpent: 0, available: 0, contributionCount: 0, spendCount: 0, funderCount: 0 }; } },
  };
}

function superAdminActor(): ActorContext {
  return {
    userId: "user_super",
    name: "SUPER_ADMIN",
    role: "SUPER_ADMIN",
    isSuperAdmin: true,
    hasOfficeFinanceFull: true,
    accessibleBusinessSlugs: ["nexup"],
    permissionTokens: derivePermissionTokens({
      role: "SUPER_ADMIN",
      isSuperAdmin: true,
      hasOfficeFinanceFull: true,
      accessibleBusinessSlugs: ["nexup"],
    }),
  };
}

function core(): ControlCore {
  return createControlCore({
    ports: fakePorts(),
    tools: [pingTool],
    ids: createSequentialIdFactory("t"),
    now: sequentialClock("2026-03-01T00:00:00.000Z", 1000),
    sleep: async () => {},
  });
}

function context() {
  return createExecutionContext({
    serviceIdentity: createServiceIdentity("LOCAL"),
    actor: superAdminActor(),
    business: { id: "biz_nexup", slug: "nexup" },
    source: "MANUAL",
    now: new Date("2026-03-01T00:00:00.000Z"),
  });
}

describe("6. job compatibility", () => {
  it("a legacy job with no actor/mission/runtime still runs exactly as before", async () => {
    const c = core();
    const job = await c.jobs.create({ capability: "system.ping", input: {}, context: context() });

    // The Phase-2A fields were never supplied, so they are absent (not null).
    expect("actorId" in job).toBe(false);
    expect("missionId" in job).toBe(false);
    expect("capabilityId" in job).toBe(false);
    expect("runtimeId" in job).toBe(false);

    const outcome = await c.jobs.run(job.id);
    expect(outcome.status).toBe("COMPLETED");
  });

  it("an actor-owned job keeps its references and preserves runner behaviour", async () => {
    const c = core();
    const job = await c.jobs.create({
      capability: "system.ping",
      input: {},
      context: context(),
      actorId: "actor_growth_lead",
      runtimeId: "runtime_deterministic",
      capabilityId: "system.ping",
      missionId: "mission_1",
    });

    expect(job.actorId).toBe("actor_growth_lead");
    expect(job.missionId).toBe("mission_1");

    const outcome = await c.jobs.run(job.id);
    expect(outcome.status).toBe("COMPLETED");

    // The references survive the state transitions untouched.
    const stored = await c.jobs.requireJob(job.id);
    expect(stored.actorId).toBe("actor_growth_lead");
    expect(stored.capabilityId).toBe("system.ping");
    expect(stored.runtimeId).toBe("runtime_deterministic");
    expect(stored.missionId).toBe("mission_1");
  });
});

/* ═══════════════════════════════════════════════════════
   7. Security
   ═══════════════════════════════════════════════════════ */

describe("7. security", () => {
  it("detects credential-looking keys without false positives on permission tokens", () => {
    expect(hasCredentials({ apiKey: "x" })).toBe(true);
    expect(hasCredentials({ nested: { authorization: "Bearer x" } })).toBe(true);
    expect(hasCredentials({ private_key: "x" })).toBe(true);
    // Legitimate domain fields must NOT be flagged.
    expect(hasCredentials({ permissionTokens: ["clients.read"], tokenIds: ["t1"] })).toBe(false);
  });

  it("builds an actor execution context that carries references, never credentials", () => {
    const base = createExecutionContext({
      serviceIdentity: createServiceIdentity("LOCAL"),
      actor: superAdminActor(),
      business: { id: "biz_nexup", slug: "nexup" },
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const actorContext: ActorExecutionContext = createActorExecutionContext({
      ...base,
      missionId: "mission_1",
      capabilityId: "lead.create",
      runtimeId: "runtime_deterministic",
      delegatedActor: { actorId: "actor_growth_lead", actorType: "AI_AGENT", slug: "growth-lead", runtimeId: "runtime_deterministic" },
      // Permissions and approval travel as REFERENCE ids, never as grants/tokens.
      permissionsSnapshotRef: "perm_snapshot_1",
      approvalRef: "approval_1",
      traceId: "trace_1",
    });

    expect(actorContext.missionId).toBe("mission_1");
    expect(actorContext.delegatedActor?.slug).toBe("growth-lead");
    expect(actorContext.permissionsSnapshotRef).toBe("perm_snapshot_1");
    expect(actorContext.approvalRef).toBe("approval_1");
    expect(actorContext.traceId).toBe("trace_1");
    expect(hasCredentials(actorContext)).toBe(false);
  });

  it("refuses an execution context that smuggled a credential", () => {
    const unsafe = {
      correlationId: "c1",
      source: "MANUAL",
      actor: { userId: "u1" },
      headers: { authorization: "Bearer leaked-token" },
    };
    expect(() => assertExecutionContextSafe(unsafe as unknown as ActorExecutionContext)).toThrow(
      /must not carry credentials/,
    );
  });

  it("does not persist credentials with a job's execution snapshot", async () => {
    const c = core();
    const job = await c.jobs.create({ capability: "system.ping", input: {}, context: context() });
    const snapshot = job.contextSnapshot;
    expect(snapshot).toBeDefined();
    expect(hasCredentials(snapshot)).toBe(false);
  });
});
