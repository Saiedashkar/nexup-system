import { describe, expect, it } from "vitest";

import { createControlCore, type ControlCore } from "@/modules/ai-workforce/core/create-core";
import {
  createExecutionContext,
  createServiceIdentity,
  createSystemActor,
  type ActorContext,
} from "@/modules/ai-workforce/core/execution-context";
import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import type { WorkforcePorts } from "@/modules/ai-workforce/core/ports";
import { derivePermissionTokens } from "@/modules/ai-workforce/policies/permission-policy";
import { defineTool } from "@/modules/ai-workforce/registry/tool-definition";

import {
  AgentRuntimeDispatcher,
  assertSafeProfile,
  boundText,
  createHermesRuntimeFromEnv,
  createWorkforceDomain,
  DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL,
  DEFAULT_HERMES_CLI_PROTOCOL,
  DEFAULT_HERMES_HTTP_PROTOCOL,
  DeterministicRuntimeAdapter,
  FORBIDDEN_HERMES_FLAGS,
  hasCredentials,
  HERMES_PROTOCOL_PROVISIONAL_NOTICE,
  HermesCliOneshotTransport,
  HermesCliTransport,
  HermesHttpTransport,
  HermesRuntimeAdapter,
  mapHermesStatus,
  mapJobToHermesPayload,
  resolveHermesConfig,
  resolveHermesProtocol,
  toJobRunnerDispatcher,
  VERIFIED_HERMES_ONESHOT_NOTICE,
  type AgentRuntime,
  type HermesRuntimeAdapterOptions,
  type HermesRuntimeConfig,
  type HermesTransport,
  type HermesTransportProvenance,
  type HermesTransportRequest,
  type HermesTransportResult,
  type RuntimeEvent,
  type WorkforceDomain,
} from "@/modules/workforce";

import {
  assertAddressableProfile,
  DEFAULT_HERMES_RPC_PROTOCOL,
  DEFAULT_HERMES_TRANSPORT,
  HERMES_FORBIDDEN_PROFILES,
  HERMES_RPC_METHODS,
  HermesRpcTransport,
  NEXUP_HERMES_PROFILE,
  VERIFIED_HERMES_RPC_NOTICE,
  type HermesWebSocketEvent,
  type HermesWebSocketFactory,
  type HermesWebSocketLike,
} from "@/modules/workforce";

// The mock transport is NOT on the production module surface: it lives in its
// own test-support module and declares `provenance: "TEST"`.
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/* ═══════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════ */

function hermesConfig(overrides: Partial<HermesRuntimeConfig> = {}): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "HTTP",
    profile: "saieed",
    endpoint: "http://127.0.0.1:9/api",
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: false, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    ...overrides,
  };
}

/** Records every request while delegating to an inner transport. */
class RecordingTransport implements HermesTransport {
  readonly kind = "DETERMINISTIC";
  readonly provenance: HermesTransportProvenance;
  readonly requests: HermesTransportRequest[] = [];
  constructor(private readonly inner: HermesTransport) {
    this.provenance = inner.provenance;
  }
  async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
    this.requests.push(request);
    return this.inner.invoke(request);
  }
}

function hermesAdapter(options: {
  transport: HermesTransport;
  config?: Partial<HermesRuntimeConfig>;
  capabilities?: Partial<HermesRuntimeConfig["capabilities"]>;
  sink?: (event: RuntimeEvent) => void;
}) {
  const ids = createSequentialIdFactory("h");
  const now = sequentialClock("2026-04-01T00:00:00.000Z", 1000);
  const adapterOptions: HermesRuntimeAdapterOptions = {
    config: hermesConfig(options.config),
    transport: options.transport,
    ids,
    now,
    // These fixtures run on the deterministic transport, so the adapter's
    // provenance gate has to be opted into — exactly what production never does.
    allowTestTransport: true,
  };
  if (options.capabilities) adapterOptions.capabilities = options.capabilities;
  if (options.sink) adapterOptions.eventSink = options.sink;
  const adapter = new HermesRuntimeAdapter(adapterOptions);
  return { adapter, ids, now };
}

async function marketIntelligenceActor(domain: WorkforceDomain) {
  return domain.actors.register({
    slug: "market-intelligence",
    displayName: "Market Intelligence",
    type: "AI_AGENT",
    role: "specialist",
    department: "growth-revenue",
    reportsTo: null,
    collaborators: [],
    lifecycle: "SHADOW",
    runtimeBinding: { runtimeId: "runtime_hermes_saeed", runtimeType: "EXTERNAL_AGENT_RUNTIME" },
    modelPolicy: { strategy: "RUNTIME_DEFAULT" },
    autonomyLevel: "ASSISTED",
    memoryScope: { scope: "DEPARTMENT", retention: "SESSION" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "INHERIT" },
    escalationTarget: null,
    metadata: {},
  });
}

/* ═══════════════════════════════════════════════════════
   1. Contract + registry resolution
   ═══════════════════════════════════════════════════════ */

describe("1. AgentRuntime contract", () => {
  it("HermesRuntimeAdapter satisfies the AgentRuntime port", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport() });
    // Compile-time proof: the adapter IS an AgentRuntime.
    const asPort: AgentRuntime = adapter;
    expect(asPort.identity.type).toBe("EXTERNAL_AGENT_RUNTIME");
    expect(typeof asPort.submitJob).toBe("function");
    expect(typeof asPort.healthCheck).toBe("function");
    expect(typeof asPort.getExecutionStatus).toBe("function");
    expect(typeof asPort.cancelJob).toBe("function");
    expect(typeof asPort.resumeJob).toBe("function");
  });

  it("the RuntimeRegistry resolves the Hermes runtime for a bound AI actor", async () => {
    const domain = createWorkforceDomain({
      ids: createSequentialIdFactory("w"),
      now: sequentialClock("2026-04-01T00:00:00.000Z", 1000),
    });
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport() });
    domain.runtimes.register(adapter);

    expect(domain.runtimes.require("runtime_hermes_saeed").identity.id).toBe("runtime_hermes_saeed");

    const actor = await marketIntelligenceActor(domain);
    expect(domain.runtimes.runtimeForActor(actor)?.identity.id).toBe("runtime_hermes_saeed");
  });

  it("no Hermes field leaks into the runtime identity metadata", () => {
    const { adapter } = hermesAdapter({
      transport: new DeterministicHermesTransport(),
      config: { authTokenPresent: true },
    });
    const metadata = adapter.identity.metadata as Record<string, unknown>;
    // Only neutral descriptors + the opaque profileRef.
    expect(metadata.profileRef).toBe("saieed");
    expect(metadata.transport).toBe("HTTP");
    expect(JSON.stringify(adapter.identity)).not.toMatch(/token|secret|password|apiKey/i);
  });
});

/* ═══════════════════════════════════════════════════════
   2. Health
   ═══════════════════════════════════════════════════════ */

describe("2. health check", () => {
  it("reports HEALTHY for a reachable runtime", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport({ health: "HEALTHY" }) });
    const health = await adapter.healthCheck();
    expect(health.status).toBe("HEALTHY");
    expect(health.latencyMs).toBeTypeOf("number");
  });

  it("reports DEGRADED when the runtime reports degraded", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport({ health: "DEGRADED" }) });
    expect((await adapter.healthCheck()).status).toBe("DEGRADED");
  });

  it("reports UNAVAILABLE when the runtime is unreachable", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport({ failWith: "UNAVAILABLE" }) });
    expect((await adapter.healthCheck()).status).toBe("UNAVAILABLE");
  });

  it("emits a runtime.health event and mutates nothing", async () => {
    const events: RuntimeEvent[] = [];
    const inner = new DeterministicHermesTransport();
    const recording = new RecordingTransport(inner);
    const { adapter } = hermesAdapter({ transport: recording, sink: (e) => events.push(e) });

    await adapter.healthCheck();
    expect(events.map((e) => e.type)).toEqual(["runtime.health"]);
    // A health check performs exactly ONE transport call, of kind `health`.
    expect(recording.requests).toHaveLength(1);
    expect(recording.requests[0].operation).toBe("health");
  });
});

/* ═══════════════════════════════════════════════════════
   3. Submit + request mapping + output normalization
   ═══════════════════════════════════════════════════════ */

describe("3. submit (deterministic transport)", () => {
  it("maps a generic job to a bounded, side-effect-free Hermes payload", () => {
    const { payload, correlation } = mapJobToHermesPayload({
      actorId: "actor_mi",
      capabilityId: "market.research",
      missionId: "mission_1",
      jobId: "job_1",
      traceId: "trace_1",
      input: { instruction: "Summarize the assigned market-research task." },
      context: {
        actorRole: "specialist",
        actorType: "AI_AGENT",
        missionTitle: "Test Market Intelligence Runtime",
        missionGoal: "Return a structured response",
      },
    });

    const context = JSON.parse(payload.contextJson);
    expect(payload.instruction).toBe("Summarize the assigned market-research task.");
    expect(context.actor).toMatchObject({ id: "actor_mi", role: "specialist", type: "AI_AGENT" });
    expect(context.capability).toMatchObject({ id: "market.research" });
    expect(context.mission).toMatchObject({ id: "mission_1", goal: "Return a structured response" });
    expect(context.constraints.sideEffects).toBe("NONE");
    expect(correlation).toMatchObject({ jobId: "job_1", missionId: "mission_1", actorId: "actor_mi", traceId: "trace_1" });

    // No unrelated context, and no credentials.
    expect(hasCredentials(context)).toBe(false);
    expect(Object.keys(context)).toEqual(["actor", "capability", "mission", "constraints", "approval", "contextRefs"]);
  });

  it("submits, returns an execution id, and normalizes output", async () => {
    const recording = new RecordingTransport(new DeterministicHermesTransport());
    const { adapter } = hermesAdapter({ transport: recording });

    const handle = await adapter.submitJob({
      actorId: "actor_mi",
      capabilityId: "market.research",
      jobId: "job_1",
      traceId: "trace_1",
      input: { instruction: "Summarize the market." },
    });

    expect(handle.runtimeId).toBe("runtime_hermes_saeed");
    expect(handle.handleId).toBe("exec_0001");
    expect(handle.status).toBe("SUCCEEDED");

    const record = adapter.getExecutionRecord(handle.handleId);
    expect(record?.executionId).toBe("exec_0001");
    expect(record?.status).toBe("SUCCEEDED");
    expect(record?.output).toMatchObject({ summary: "deterministic market summary" });
    expect(recording.requests[0].operation).toBe("submit");
  });
});

/* ═══════════════════════════════════════════════════════
   4. Status mapping
   ═══════════════════════════════════════════════════════ */

describe("4. status mapping (deterministic transport)", () => {
  it("maps Hermes vocabulary into generic states", () => {
    expect(mapHermesStatus("queued")).toBe("ACCEPTED");
    expect(mapHermesStatus("in-progress")).toBe("RUNNING");
    expect(mapHermesStatus("awaiting_approval")).toBe("WAITING");
    expect(mapHermesStatus("SUCCEEDED")).toBe("SUCCEEDED");
    expect(mapHermesStatus("aborted")).toBe("CANCELLED");
    expect(mapHermesStatus("nonsense")).toBe("UNKNOWN");
  });

  it("observes an execution advancing through generic states", async () => {
    const transport = new DeterministicHermesTransport({ statusSequence: ["queued", "running", "succeeded"] });
    const { adapter } = hermesAdapter({ transport });

    const first = await adapter.getExecutionStatus("exec_0001");
    expect(first.status).toBe("ACCEPTED");
    expect((await adapter.getExecutionStatus("exec_0001")).status).toBe("RUNNING");
    expect((await adapter.getExecutionStatus("exec_0001")).status).toBe("SUCCEEDED");
  });

  it("reports UNKNOWN instead of inventing a state", async () => {
    const transport = new DeterministicHermesTransport({ statusSequence: ["esoteric-provider-state"] });
    const { adapter } = hermesAdapter({ transport });
    expect((await adapter.getExecutionStatus("exec_0001")).status).toBe("UNKNOWN");
  });
});

/* ═══════════════════════════════════════════════════════
   5. Failure handling
   ═══════════════════════════════════════════════════════ */

describe("5. failure", () => {
  it("normalizes a timeout as a retryable FAILED record", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport({ failWith: "TIMEOUT" }) });
    const handle = await adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    expect(handle.status).toBe("FAILED");
    const record = adapter.getExecutionRecord(handle.handleId);
    expect(record?.error?.category).toBe("TIMEOUT");
    expect(record?.error?.retryable).toBe(true);
  });

  it("normalizes a transport error as retryable, and malformed output as not", async () => {
    const unavailable = hermesAdapter({ transport: new DeterministicHermesTransport({ failWith: "UNAVAILABLE" }) });
    const recordA = unavailable.adapter.getExecutionRecord(
      (await unavailable.adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t" })).handleId,
    );
    expect(recordA?.error?.category).toBe("TRANSPORT");
    expect(recordA?.error?.retryable).toBe(true);

    const malformed = hermesAdapter({ transport: new DeterministicHermesTransport({ malformed: true }) });
    const handleB = await malformed.adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    const recordB = malformed.adapter.getExecutionRecord(handleB.handleId);
    expect(recordB?.error?.category).toBe("MALFORMED_OUTPUT");
    expect(recordB?.error?.retryable).toBe(false);
  });

  it("reports an unsupported operation instead of faking it", async () => {
    const { adapter } = hermesAdapter({ transport: new DeterministicHermesTransport() });
    await expect(adapter.cancelJob("exec_0001")).rejects.toThrow(/does not support cancellation/i);
    await expect(adapter.resumeJob("exec_0001")).rejects.toThrow(/does not support resuming/i);
    expect(adapter.supports("cancel")).toBe(false);
    expect(adapter.supports("submit")).toBe(true);
  });

  it("names an unresolvable runtime as a typed outcome, never a fake success", async () => {
    const domain = createWorkforceDomain({ ids: createSequentialIdFactory("w"), now: () => new Date() });
    // Authorization is mandatory now, so the refusal under test has to get PAST
    // it: a real actor bound to the ghost runtime, holding a real assignment.
    const actor = await domain.actors.register({
      slug: "ghost-bound",
      displayName: "Ghost-bound agent",
      type: "AI_AGENT",
      role: "specialist",
      department: "growth-revenue",
      reportsTo: null,
      collaborators: [],
      lifecycle: "SHADOW",
      runtimeBinding: { runtimeId: "runtime_ghost", runtimeType: "EXTERNAL_AGENT_RUNTIME" },
      modelPolicy: { strategy: "RUNTIME_DEFAULT" },
      autonomyLevel: "ASSISTED",
      memoryScope: { scope: "DEPARTMENT", retention: "SESSION" },
      permissions: [{ permission: "aiworkforce.access" }],
      approvalPolicy: { mode: "INHERIT" },
      escalationTarget: null,
      metadata: {},
    });
    const capability = await domain.capabilities.register({
      id: "ghost.capability",
      name: "Ghost capability",
      kind: "SKILL",
      version: "1.0.0",
      description: "test capability",
      owner: actor.id,
      riskLevel: "LOW",
      status: "ACTIVE",
      procedureRef: "sop://test/ghost",
    });
    await domain.assignments.assign({ actorId: actor.id, capabilityId: capability.id, grantedBy: "founder" });
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });
    const outcome = await dispatcher.dispatch({ actorId: actor.id, runtimeId: "runtime_ghost", capabilityId: capability.id });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("RUNTIME_UNRESOLVED");
    expect(outcome.error?.code).toBe("RUNTIME_NOT_FOUND");
  });
});

/* ═══════════════════════════════════════════════════════
   6. Security
   ═══════════════════════════════════════════════════════ */

describe("6. security", () => {
  it("rejects unsafe profile references", () => {
    expect(assertSafeProfile("saieed")).toBe("saieed");
    for (const unsafe of ["sa ieed", "saieed;rm -rf /", "../../etc/passwd", "$(whoami)", "saieed`id`", "a|b", "SAIEED"]) {
      expect(() => assertSafeProfile(unsafe)).toThrow(/not a safe slug/);
    }
  });

  it("does not carry a token on the identity, records or events", async () => {
    const events: RuntimeEvent[] = [];
    const recording = new RecordingTransport(new DeterministicHermesTransport());
    const { adapter } = hermesAdapter({ transport: recording, sink: (e) => events.push(e), config: { authTokenPresent: true } });

    const handle = await adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    expect(JSON.stringify(adapter.identity)).not.toMatch(/token|secret|password/i);
    expect(JSON.stringify(adapter.getExecutionRecord(handle.handleId))).not.toMatch(/token|secret|password/i);
    expect(JSON.stringify(events)).not.toMatch(/token|secret|password/i);
  });

  it("bounds output to the configured limit", async () => {
    const huge = "x".repeat(10_000);
    // A well-behaved transport bounds its own output to `maxOutputBytes`.
    const bigTransport: HermesTransport = {
      kind: "DETERMINISTIC",
      provenance: "TEST",
      async invoke(request) {
        const bounded = boundText(huge, request.maxOutputBytes);
        return { ok: true, raw: bounded.text, truncated: bounded.truncated, durationMs: 1 };
      },
    };
    const { adapter } = hermesAdapter({ transport: bigTransport, config: { maxOutputBytes: 128 } });
    const handle = await adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    const record = adapter.getExecutionRecord(handle.handleId);
    expect(record?.truncated).toBe(true);
    expect((record?.outputText ?? "").length).toBeLessThanOrEqual(128);
  });

  it("never interpolates a job payload into a command, and blocks non-allowlisted executables", async () => {
    const calls: { executablePath: string; args: string[]; stdin?: string }[] = [];
    const spawn = async (input: { executablePath: string; args: string[]; stdin?: string }) => {
      calls.push(input);
      return { code: 0, stdout: JSON.stringify({ status: "succeeded" }), stderr: "", killed: false, timedOut: false };
    };

    const cli = new HermesCliTransport({ executablePath: "/opt/hermes/bin/hermes", spawnImpl: spawn });
    // A malicious execution id must remain ONE argument, never a shell fragment.
    const args = cli.buildArgs({
      operation: "status",
      profile: "saieed",
      payload: { instruction: "", contextJson: "{}", executionId: "exec; rm -rf /" },
      timeoutMs: 1000,
      maxOutputBytes: 1000,
      correlation: { actorId: "a", traceId: "t" },
    });
    expect(args).toContain("exec; rm -rf /");
    expect(args.filter((a) => a === ";" || a.includes("rm -rf"))).toHaveLength(1);

    // Non-allowlisted executable is blocked and never spawned.
    const blocked = new HermesCliTransport({ executablePath: "/tmp/evil", spawnImpl: spawn });
    const result = await blocked.invoke({
      operation: "health",
      profile: "saieed",
      timeoutMs: 1000,
      maxOutputBytes: 1000,
      correlation: { actorId: "a", traceId: "t" },
    });
    expect(result.transportError).toBe("BLOCKED_COMMAND");
    expect(calls).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════
   7. Configuration
   ═══════════════════════════════════════════════════════ */

describe("7. configuration", () => {
  it("stays disabled without a safe profile, endpoint or executable", () => {
    expect(resolveHermesConfig({}).enabled).toBe(false);
    expect(resolveHermesConfig({ HERMES_RUNTIME_PROFILE: "sa ieed" }).enabled).toBe(false);
    expect(resolveHermesConfig({ HERMES_RUNTIME_PROFILE: "saieed", HERMES_RUNTIME_TRANSPORT: "HTTP" }).enabled).toBe(false);
    expect(
      resolveHermesConfig({ HERMES_RUNTIME_PROFILE: "saieed", HERMES_RUNTIME_TRANSPORT: "CLI" }).enabled,
    ).toBe(false);
  });

  it("resolves a valid config and never returns the token", () => {
    const resolution = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_TRANSPORT: "HTTP",
      HERMES_RUNTIME_ENDPOINT: "https://hermes.example/api",
      HERMES_RUNTIME_TOKEN: "super-secret-value",
    });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) return;
    expect(resolution.config.profile).toBe("saieed");
    expect(resolution.config.authTokenPresent).toBe(true);
    expect(JSON.stringify(resolution.config)).not.toContain("super-secret-value");
  });

  it("builds a runtime from the environment, or reports why it cannot", () => {
    const disabled = createHermesRuntimeFromEnv({});
    expect(disabled.enabled).toBe(false);

    const enabled = createHermesRuntimeFromEnv({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_TRANSPORT: "HTTP",
      HERMES_RUNTIME_ENDPOINT: "https://hermes.example/api",
      HERMES_RUNTIME_TOKEN: "super-secret-value",
    });
    expect(enabled.enabled).toBe(true);
    if (!enabled.enabled) return;
    expect(enabled.adapter.identity.metadata).toMatchObject({ profileRef: "saieed" });
    expect(JSON.stringify(enabled.adapter.identity)).not.toContain("super-secret-value");
  });
});

/* ═══════════════════════════════════════════════════════
   8. Compatibility
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

function context() {
  return createExecutionContext({
    serviceIdentity: createServiceIdentity("LOCAL"),
    actor: superAdminActor(),
    business: { id: "biz_nexup", slug: "nexup" },
    source: "MANUAL",
    now: new Date("2026-04-01T00:00:00.000Z"),
  });
}

/** Same actor, but the trigger is an autonomous (AGENT) execution. */
function agentContext() {
  return createExecutionContext({
    serviceIdentity: createServiceIdentity("LOCAL"),
    actor: superAdminActor(),
    business: { id: "biz_nexup", slug: "nexup" },
    source: "MANUAL",
    autonomy: "AGENT",
    now: new Date("2026-04-01T00:00:00.000Z"),
  });
}

describe("8. compatibility", () => {
  it("leaves legacy jobs on the local path — the dispatcher is never consulted", async () => {
    let dispatchCalls = 0;
    const core: ControlCore = createControlCore({
      ports: fakePorts(),
      tools: [pingTool],
      ids: createSequentialIdFactory("t"),
      now: sequentialClock("2026-04-01T00:00:00.000Z", 1000),
      sleep: async () => {},
      dispatchAgent: async () => {
        dispatchCalls += 1;
        return { dispatched: false };
      },
    });

    const job = await core.jobs.create({ capability: "system.ping", input: {}, context: context() });
    expect("runtimeId" in job).toBe(false);

    const outcome = await core.jobs.run(job.id);
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.output).toMatchObject({ ok: true });
    expect(dispatchCalls).toBe(0);
  });

  it("keeps the deterministic runtime adapter unaffected by the Hermes adapter", async () => {
    const domain = createWorkforceDomain({ ids: createSequentialIdFactory("w"), now: () => new Date() });
    domain.runtimes.register(new DeterministicRuntimeAdapter({ ids: domain.ids, now: domain.now }));
    domain.runtimes.register(hermesAdapter({ transport: new DeterministicHermesTransport() }).adapter);

    const handle = await domain.runtimes.require("runtime_deterministic").submitJob({ actorId: "a", capabilityId: "c", traceId: "t" });
    expect(handle.status).toBe("SUCCEEDED");
    expect(handle.handleId).toMatch(/^w_handle_/);
  });
});

/* ═══════════════════════════════════════════════════════
   9. Adapter-owned PROVISIONAL protocol
   ═══════════════════════════════════════════════════════ */

describe("9. provisional protocol (adapter-owned)", () => {
  it("the provisional HTTP transport emits the CONFIGURED paths (behavior, not a claimed contract)", async () => {
    const calls: { url: string; method: string }[] = [];
    const transport = new HermesHttpTransport({
      endpoint: "http://127.0.0.1:9/api",
      authHeaderName: "Authorization",
      authScheme: "Bearer",
      protocol: {
        ...DEFAULT_HERMES_HTTP_PROTOCOL,
        health: { method: "GET", path: "/custom/health?profile={profile}" },
        submit: { method: "POST", path: "/custom/jobs" },
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: String(init?.method) });
        return new Response(JSON.stringify({ status: "healthy" }), { status: 200 });
      },
    });

    await transport.invoke({
      operation: "health",
      profile: "saieed",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      correlation: { actorId: "a", traceId: "t" },
    });
    await transport.invoke({
      operation: "submit",
      profile: "saieed",
      payload: { instruction: "x", contextJson: "{}" },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      correlation: { actorId: "a", traceId: "t" },
    });

    expect(calls[0]).toEqual({ url: "http://127.0.0.1:9/api/custom/health?profile=saieed", method: "GET" });
    expect(calls[1]).toEqual({ url: "http://127.0.0.1:9/api/custom/jobs", method: "POST" });
  });

  it("the provisional CLI transport emits the CONFIGURED subcommand mapping (behavior)", () => {
    const cli = new HermesCliTransport({
      executablePath: "/opt/hermes/bin/hermes",
      protocol: {
        ...DEFAULT_HERMES_CLI_PROTOCOL,
        status: { command: ["inspect"], profileFlag: "--workspace", executionFlag: "--run" },
      },
      spawnImpl: async () => ({ code: 0, stdout: "{}", stderr: "", killed: false, timedOut: false }),
    });
    const args = cli.buildArgs({
      operation: "status",
      profile: "saieed",
      payload: { instruction: "", contextJson: "{}", executionId: "exec_42" },
      timeoutMs: 1_000,
      maxOutputBytes: 1_000,
      correlation: { actorId: "a", traceId: "t" },
    });
    expect(args).toEqual(["inspect", "--workspace", "saieed", "--run", "exec_42"]);
  });

  it("ships provisional defaults, clearly marked UNVERIFIED, and threads them through config", () => {
    const resolution = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_TRANSPORT: "HTTP",
      HERMES_RUNTIME_ENDPOINT: "https://hermes.example/api",
    });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) return;
    // The adapter carries the provisional protocol; nothing core-facing depends on it.
    expect(resolution.config.protocol?.http.submit.path).toBe(DEFAULT_HERMES_HTTP_PROTOCOL.submit.path);
    expect(HERMES_PROTOCOL_PROVISIONAL_NOTICE).toMatch(/UNVERIFIED/);

    // Overrides replace only what the caller names; the rest stay provisional.
    const custom = resolveHermesProtocol({ http: { submit: { method: "PUT", path: "/real/contract" } } });
    expect(custom.overridden).toBe(true);
    expect(custom.protocol.http.submit).toEqual({ method: "PUT", path: "/real/contract" });
    expect(custom.protocol.http.health.path).toBe(DEFAULT_HERMES_HTTP_PROTOCOL.health.path);
  });
});

/* ═══════════════════════════════════════════════════════
   10. End-to-end adapter architecture test
   ═══════════════════════════════════════════════════════ */

describe("10. end-to-end adapter architecture test", () => {
  it("runs Mission → Job → actor → RuntimeRegistry → deterministic transport → normalized Job result", async () => {
    const ids = createSequentialIdFactory("w");
    const now = sequentialClock("2026-04-01T00:00:00.000Z", 1000);
    const domain = createWorkforceDomain({ ids, now });

    // The ONE runtime-bound actor for this slice.
    const actor = await marketIntelligenceActor(domain);

    // The capability the job references (a read/research capability).
    const capability = await domain.capabilities.register({
      id: "market.research",
      name: "Market research",
      kind: "SKILL",
      version: "1.0.0",
      description: "research SOP",
      owner: actor.id,
      riskLevel: "LOW",
      status: "ACTIVE",
      procedureRef: "sop://growth/market-research",
    });
    await domain.assignments.assign({ actorId: actor.id, capabilityId: capability.id, grantedBy: "founder" });

    // The runtime, backed by the deterministic transport.
    const recording = new RecordingTransport(new DeterministicHermesTransport());
    const hermes = hermesAdapter({ transport: recording });
    domain.runtimes.register(hermes.adapter);

    // The mission above the job.
    const mission = await domain.missions.create({
      title: "Test Market Intelligence Runtime",
      goal: "Return a structured market summary",
      createdBy: "founder",
      owner: actor.id,
      priority: "LOW",
    });
    await domain.missions.transition(mission.id, "PLANNING");
    await domain.missions.transition(mission.id, "RUNNING");

    // The dispatcher seam, bound to the JobRunner.
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
      missions: domain.missions,
    });

    const core = createControlCore({
      ports: fakePorts(),
      tools: [],
      ids: createSequentialIdFactory("t"),
      now: sequentialClock("2026-04-01T00:00:00.000Z", 1000),
      sleep: async () => {},
      dispatchAgent: toJobRunnerDispatcher(dispatcher),
    });

    const job = await core.jobs.create({
      capability: "market.research",
      input: { instruction: "Summarize the assigned market-research task and return a structured response." },
      context: context(),
      actorId: actor.id,
      runtimeId: "runtime_hermes_saeed",
      capabilityId: capability.id,
      missionId: mission.id,
    });

    const outcome = await core.jobs.run(job.id);

    // Job result produced through the runtime.
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.output).toMatchObject({ summary: "deterministic market summary" });

    const stored = await core.jobs.requireJob(job.id);
    expect(stored.runtimeHandleId).toBe("exec_0001");
    expect(stored.actorId).toBe(actor.id);
    expect(stored.missionId).toBe(mission.id);

    // Mission ↔ Job reference.
    const withJob = await domain.missions.attachJob(mission.id, job.id);
    expect(withJob.jobRefs).toEqual([job.id]);

    // Exactly one submit; no cancel/status/other side effects.
    const operations = recording.requests.map((r) => r.operation);
    expect(operations).toEqual(["submit"]);
    expect(JSON.parse(recording.requests[0].payload!.contextJson).constraints.sideEffects).toBe("NONE");

    // No credentials anywhere in the flow.
    expect(hasCredentials(recording.requests[0].payload)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   11. VERIFIED one-shot CLI transport
   ═══════════════════════════════════════════════════════ */

describe("11. verified one-shot CLI transport", () => {
  const oneShotRequest = (overrides: Partial<Parameters<HermesCliOneshotTransport["buildArgs"]>[0]> = {}) => ({
    operation: "submit" as const,
    profile: "saieed",
    payload: { instruction: "Summarize the market.", contextJson: "{}" },
    timeoutMs: 1_000,
    maxOutputBytes: 1_000,
    correlation: { actorId: "a", traceId: "t" },
    ...overrides,
  });

  it("builds the VERIFIED invocation hermes -p <profile> -z <prompt>", () => {
    const cli = new HermesCliOneshotTransport({ executablePath: "/opt/hermes/bin/hermes" });
    const args = cli.buildArgs(oneShotRequest());
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("saieed");
    expect(args[2]).toBe("-z");
    expect(args[3]).toBe("Summarize the market.");
    // `--yolo` is forbidden and never emitted.
    expect(args).not.toContain("--yolo");
    expect(FORBIDDEN_HERMES_FLAGS).toContain("--yolo");
    expect(DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL).toEqual({ profileFlag: "-p", oneshotFlag: "-z" });
  });

  it("passes the prompt as a SINGLE argv element — never a shell fragment", () => {
    const cli = new HermesCliOneshotTransport({ executablePath: "/opt/hermes/bin/hermes" });
    const hostile = 'x"; rm -rf / && echo $(whoami) `id` | cat > /tmp/pwn';
    const args = cli.buildArgs(
      oneShotRequest({ payload: { instruction: hostile, contextJson: "{}" } }),
    );
    expect(args).toHaveLength(4);
    expect(args[3]).toBe(hostile);
  });

  it("refuses status/cancel/resume/health as UNSUPPORTED without spawning", async () => {
    let spawns = 0;
    const cli = new HermesCliOneshotTransport({
      executablePath: "/opt/hermes/bin/hermes",
      spawnImpl: async () => {
        spawns += 1;
        return { code: 0, stdout: "{}", stderr: "", killed: false, timedOut: false };
      },
    });
    for (const operation of ["status", "cancel", "resume", "health"] as const) {
      const result = await cli.invoke(oneShotRequest({ operation }));
      expect(result.transportError).toBe("UNSUPPORTED");
    }
    expect(spawns).toBe(0);
  });

  it("blocks a non-allowlisted executable before spawning", async () => {
    let spawns = 0;
    const cli = new HermesCliOneshotTransport({
      executablePath: "/tmp/evil",
      spawnImpl: async () => {
        spawns += 1;
        return { code: 0, stdout: "{}", stderr: "", killed: false, timedOut: false };
      },
    });
    const result = await cli.invoke(oneShotRequest());
    expect(result.transportError).toBe("BLOCKED_COMMAND");
    expect(spawns).toBe(0);
  });

  it("normalizes a successful one-shot run as SUCCEEDED with the final text", async () => {
    const cli = new HermesCliOneshotTransport({
      executablePath: "/opt/hermes/bin/hermes",
      spawnImpl: async () => ({ code: 0, stdout: "final answer text", stderr: "", killed: false, timedOut: false }),
    });
    const { adapter } = hermesAdapter({
      transport: cli,
      config: {
        transport: "CLI_ONESHOT",
        executablePath: "/opt/hermes/bin/hermes",
        capabilities: { submit: true, status: false, health: false, cancel: false, resume: false },
      },
    });
    const handle = await adapter.submitJob({ actorId: "a", capabilityId: "c", traceId: "t", input: { instruction: "hi" } });
    expect(handle.status).toBe("SUCCEEDED");
    const record = adapter.getExecutionRecord(handle.handleId);
    expect(record?.outputText).toBe("final answer text");
  });

  it("resolves CLI_ONESHOT and never claims a status/health surface for it", () => {
    const resolution = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_TRANSPORT: "CLI_ONESHOT",
      HERMES_RUNTIME_EXECUTABLE: "/opt/hermes/bin/hermes",
    });
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) return;
    expect(resolution.config.transport).toBe("CLI_ONESHOT");
    expect(resolution.config.capabilities).toMatchObject({ submit: true, status: false, health: false, cancel: false, resume: false });
    expect(resolution.config.protocol?.oneshot).toEqual(DEFAULT_HERMES_CLI_ONESHOT_PROTOCOL);
    expect(VERIFIED_HERMES_ONESHOT_NOTICE).toMatch(/VERIFIED/);
  });

  it("never falls back to a default profile — an explicit safe profile is required", () => {
    // No HERMES_RUNTIME_PROFILE: the adapter stays disabled rather than
    // addressing any implicit profile (in particular the `default` profile).
    expect(resolveHermesConfig({ HERMES_RUNTIME_TRANSPORT: "CLI_ONESHOT", HERMES_RUNTIME_EXECUTABLE: "/opt/hermes/bin/hermes" }).enabled).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
   12. authorization BEFORE runtime dispatch
   ═══════════════════════════════════════════════════════ */

describe("12. authorization before runtime dispatch", () => {
  function coreWithSpy() {
    let dispatchCalls = 0;
    const core = createControlCore({
      ports: fakePorts(),
      tools: [],
      ids: createSequentialIdFactory("t"),
      now: sequentialClock("2026-04-01T00:00:00.000Z", 1000),
      sleep: async () => {},
      dispatchAgent: async () => {
        dispatchCalls += 1;
        return { dispatched: true, status: "SUCCEEDED", output: { ok: true }, handleId: "h1" };
      },
    });
    return { core, dispatched: () => dispatchCalls };
  }

  it("parks an AGENT-autonomy runtime-bound job for approval and NEVER dispatches", async () => {
    const { core, dispatched } = coreWithSpy();
    const job = await core.jobs.create({
      capability: "market.research",
      input: {},
      context: agentContext(),
      actorId: "actor_mi",
      runtimeId: "runtime_hermes_saeed",
      capabilityId: "market.research",
    });
    const outcome = await core.jobs.run(job.id);
    expect(outcome.status).toBe("WAITING_APPROVAL");
    expect(dispatched()).toBe(0);
    const stored = await core.jobs.requireJob(job.id);
    expect(stored.approvalId).toBeTruthy();
  });

  it("blocks a runtime-bound job whose actor lacks workforce access, without dispatching", async () => {
    const { core, dispatched } = coreWithSpy();
    const ctx = createExecutionContext({
      serviceIdentity: createServiceIdentity("LOCAL"),
      actor: createSystemActor(),
      business: null,
      source: "MANUAL",
      now: new Date("2026-04-01T00:00:00.000Z"),
    });
    const job = await core.jobs.create({
      capability: "market.research",
      input: {},
      context: ctx,
      actorId: "actor_x",
      runtimeId: "runtime_hermes_saeed",
    });
    const outcome = await core.jobs.run(job.id);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.error?.code).toBe("PERMISSION_DENIED");
    expect(dispatched()).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════
   13. VERIFIED WebSocket JSON-RPC / WebSocket transport
   ═══════════════════════════════════════════════════════ */

type RpcFrame = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A minimal in-memory WebSocket whose "server" is a callback per request. */
class FakeWebSocket implements HermesWebSocketLike {
  readyState = 0;
  readonly received: RpcFrame[] = [];
  private readonly listeners: Record<string, ((event: HermesWebSocketEvent) => void)[]> = {};

  constructor(private readonly server?: (frame: RpcFrame, socket: FakeWebSocket) => void) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
      // VERIFIED: the server emits gateway.ready right after accept.
      this.notify({ type: "gateway.ready", payload: { change_events: true } });
    });
  }

  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: HermesWebSocketEvent) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as RpcFrame;
    this.received.push(frame);
    this.server?.(frame, this);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  reply(id: string | number, result: unknown): void {
    this.deliver({ jsonrpc: "2.0", id, result });
  }

  replyError(id: string | number, code: number, message: string): void {
    this.deliver({ jsonrpc: "2.0", id, error: { code, message } });
  }

  notify(params: Record<string, unknown>): void {
    this.deliver({ jsonrpc: "2.0", method: "event", params });
  }

  deliver(frame: RpcFrame): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  private emit(type: string, event: HermesWebSocketEvent): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

function rpcTransport(server?: (frame: RpcFrame, socket: FakeWebSocket) => void) {
  let socket: FakeWebSocket | null = null;
  const webSocketFactory: HermesWebSocketFactory = () => {
    socket = new FakeWebSocket(server);
    return socket;
  };
  const transport = new HermesRpcTransport({
    endpoint: "ws://127.0.0.1:9119/api/ws",
    profile: NEXUP_HERMES_PROFILE,
    webSocketFactory,
  });
  return { transport, getSocket: () => socket };
}

function rpcRequest(partial: Partial<HermesTransportRequest> = {}): HermesTransportRequest {
  return {
    operation: "status",
    profile: NEXUP_HERMES_PROFILE,
    payload: { instruction: "Summarize the market.", contextJson: "{}", executionId: "sess_1" },
    timeoutMs: 400,
    maxOutputBytes: 4_096,
    correlation: { actorId: "a", traceId: "t" },
    ...partial,
  };
}

describe("13. verified WebSocket JSON-RPC transport", () => {
  it("speaks the verified envelope and correlates responses by id (out of order)", async () => {
    const { transport, getSocket } = rpcTransport();
    const first = transport.invoke(rpcRequest({ payload: { instruction: "", contextJson: "{}", executionId: "A" } }));
    const second = transport.invoke(rpcRequest({ payload: { instruction: "", contextJson: "{}", executionId: "B" } }));
    await tick();

    const socket = getSocket()!;
    expect(socket.received).toHaveLength(2);
    expect(socket.received[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "session.status",
      params: { session_id: "A" },
    });
    expect(socket.received[0].id).toBeTruthy();
    expect(socket.received[0]).not.toHaveProperty("result");

    // Reply in the WRONG order; correlation must still deliver each result.
    socket.reply(socket.received[1].id!, { output: "B" });
    socket.reply(socket.received[0].id!, { output: "A" });
    const [r1, r2] = await Promise.all([first, second]);
    expect(JSON.parse(r1.raw)).toEqual({ output: "A" });
    expect(JSON.parse(r2.raw)).toEqual({ output: "B" });
    transport.close();
  });

  it("scopes session.create to profile saieed and consumes message.delta / message.complete", async () => {
    const { transport, getSocket } = rpcTransport((frame, socket) => {
      if (frame.method === HERMES_RPC_METHODS.sessionCreate) {
        socket.reply(frame.id!, { session_id: "sess_42", stored_session_id: "key" });
      } else if (frame.method === HERMES_RPC_METHODS.promptSubmit) {
        socket.reply(frame.id!, { status: "streaming" });
        socket.notify({ type: "message.delta", session_id: "sess_42", payload: { text: "Hello " } });
        socket.notify({ type: "message.delta", session_id: "sess_42", payload: { text: "world" } });
        // A complete frame with no text — the accumulated deltas must be used.
        socket.notify({ type: "message.complete", session_id: "sess_42", payload: { status: "complete" } });
      }
    });

    const result = await transport.invoke(rpcRequest({ operation: "submit" }));
    expect(result.ok).toBe(true);
    const body = JSON.parse(result.raw) as Record<string, unknown>;
    expect(body.executionId).toBe("sess_42");
    expect(body.text).toBe("Hello world");
    expect(body.status).toBe("complete");

    const socket = getSocket()!;
    const create = socket.received.find((f) => f.method === HERMES_RPC_METHODS.sessionCreate)!;
    expect(create.params).toEqual({ profile: "saieed" });
    const submit = socket.received.find((f) => f.method === HERMES_RPC_METHODS.promptSubmit)!;
    expect(submit.params).toEqual({ session_id: "sess_42", text: "Summarize the market." });
    transport.close();
  });

  it("maps cancel to the verified session.interrupt method", async () => {
    const { transport, getSocket } = rpcTransport((frame, socket) => {
      if (frame.method === HERMES_RPC_METHODS.sessionInterrupt) socket.reply(frame.id!, { status: "interrupted" });
    });
    const result = await transport.invoke(
      rpcRequest({ operation: "cancel", payload: { instruction: "", contextJson: "{}", executionId: "sess_9" } }),
    );
    expect(result.ok).toBe(true);
    const socket = getSocket()!;
    const call = socket.received.find((f) => f.method === HERMES_RPC_METHODS.sessionInterrupt)!;
    expect(call.params).toEqual({ session_id: "sess_9" });
    transport.close();
  });

  it("probes gateway.ping and degrades honestly when it is unsupported", async () => {
    const supported = rpcTransport((frame, socket) => socket.reply(frame.id!, { ok: true }));
    const healthy = await supported.transport.invoke(rpcRequest({ operation: "health" }));
    expect(healthy.ok).toBe(true);
    expect(JSON.parse(healthy.raw)).toMatchObject({ status: "healthy" });
    expect(supported.getSocket()!.received[0].method).toBe("gateway.ping");
    supported.transport.close();

    const unsupported = rpcTransport((frame, socket) => socket.replyError(frame.id!, -32601, "method not found"));
    const degraded = await unsupported.transport.invoke(rpcRequest({ operation: "health" }));
    expect(degraded.ok).toBe(true);
    expect(JSON.parse(degraded.raw)).toMatchObject({ status: "degraded" });
    unsupported.transport.close();
  });

  it("times out a request that is never answered", async () => {
    const { transport } = rpcTransport();
    const result = await transport.invoke(rpcRequest({ operation: "status", timeoutMs: 60 }));
    expect(result.transportError).toBe("TIMEOUT");
    transport.close();
  });

  it("rejects an in-flight request when the socket disconnects", async () => {
    const { transport, getSocket } = rpcTransport();
    const pending = transport.invoke(rpcRequest({ operation: "status" }));
    await tick();
    getSocket()!.close();
    const result = await pending;
    expect(result.transportError).toBe("UNAVAILABLE");
  });

  it("refuses resume as UNSUPPORTED and never connects", async () => {
    const { transport, getSocket } = rpcTransport();
    const result = await transport.invoke(rpcRequest({ operation: "resume" }));
    expect(result.transportError).toBe("UNSUPPORTED");
    expect(getSocket()).toBeNull();
  });

  it("refuses the forbidden default profile before touching the network", async () => {
    const { transport, getSocket } = rpcTransport();
    const result = await transport.invoke(rpcRequest({ profile: "default", operation: "submit" }));
    expect(result.transportError).toBe("FORBIDDEN");
    expect(getSocket()).toBeNull();
    expect(() => assertAddressableProfile("default")).toThrow(/forbidden/i);
    expect(HERMES_FORBIDDEN_PROFILES).toContain("default");
  });

  it("drops oversized inbound frames without breaking correlation", async () => {
    const { transport, getSocket } = rpcTransport((frame, socket) => socket.reply(frame.id!, { output: "ok" }));
    const pending = transport.invoke(rpcRequest({ operation: "status" }));
    await tick();
    const socket = getSocket()!;
    socket.notify({ type: "noise", payload: { text: "x".repeat(3_000_000) } });
    socket.reply(socket.received[0].id!, { output: "ok" });
    const result = await pending;
    expect(JSON.parse(result.raw)).toEqual({ output: "ok" });
    transport.close();
  });

  it("defaults to the verified RPC transport and demotes one-shot to a fallback", () => {
    expect(DEFAULT_HERMES_TRANSPORT).toBe("RPC");
    expect(DEFAULT_HERMES_RPC_PROTOCOL.wsPath).toBe("/api/ws");
    expect(HERMES_RPC_METHODS.promptSubmit).toBe("prompt.submit");
    expect(VERIFIED_HERMES_RPC_NOTICE).toMatch(/VERIFIED/);

    const rpc = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_RPC_URL: "wss://bridge.example/api/ws",
    });
    expect(rpc.enabled).toBe(true);
    if (!rpc.enabled) return;
    expect(rpc.config.transport).toBe("RPC");
    expect(rpc.config.rpcEndpoint).toBe("wss://bridge.example/api/ws");
    expect(rpc.config.capabilities).toMatchObject({ submit: true, status: true, health: true, cancel: true, resume: false });
    expect(rpc.config.protocol?.rpc.methods.sessionCreate).toBe("session.create");

    // No endpoint and no explicit transport -> disabled (never a guessed default).
    expect(resolveHermesConfig({ HERMES_RUNTIME_PROFILE: "saieed" }).enabled).toBe(false);
    // The forbidden default profile is rejected outright.
    expect(
      resolveHermesConfig({ HERMES_RUNTIME_PROFILE: "default", HERMES_RUNTIME_RPC_URL: "ws://x/api/ws" }).enabled,
    ).toBe(false);
    // One-shot remains available as an explicit fallback.
    const oneshot = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_TRANSPORT: "CLI_ONESHOT",
      HERMES_RUNTIME_EXECUTABLE: "/opt/hermes/bin/hermes",
    });
    expect(oneshot.enabled).toBe(true);
  });

  it("accepts an http(s) RPC url by mapping it to ws(s)", () => {
    const resolution = resolveHermesConfig({
      HERMES_RUNTIME_PROFILE: "saieed",
      HERMES_RUNTIME_RPC_URL: "https://bridge.example/api/ws",
    });
    expect(resolution.enabled).toBe(true);
    if (resolution.enabled) expect(resolution.config.rpcEndpoint).toBe("wss://bridge.example/api/ws");
  });
});
