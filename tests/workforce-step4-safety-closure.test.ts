import { describe, expect, it } from "vitest";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import {
  AgentRuntimeDispatcher,
  assertNexupProfile,
  bootstrapWorkforceDomain,
  createHermesRuntime,
  createHermesRuntimeFromEnv,
  createHermesTransport,
  createWorkforceDomain,
  HermesBridgeTransport,
  HermesRpcTransport,
  HermesRuntimeAdapter,
  NEXUP_ALLOWED_PROFILES,
  NEXUP_HERMES_PROFILE,
  resolveHermesConfig,
  type AgentJobHandle,
  type AgentJobRequest,
  type AgentRuntime,
  type AgentRuntimeDispatcherDeps,
  type HermesRuntimeConfig,
  type HermesTransport,
  type HermesTransportRequest,
  type RuntimeHealth,
} from "@/modules/workforce";
import { HermesBridgeClient } from "@/modules/workforce/runtimes/hermes/bridge-client";

// The mock transport is TEST SUPPORT: it is not on the production module surface
// and it declares `provenance: "TEST"`.
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * STEP 4 SAFETY CLOSURE — the three invariants the first Step-4 audit found
 * missing, each proven the way an attacker would attack it.
 *
 *   A1. Profile isolation is a NEXUP POSITIVE ALLOWLIST. `saieed` is the only
 *       addressable profile; `default`, another operator's profile and any
 *       unknown name are refused BEFORE a socket, request or process exists.
 *   A2. Capability authorization is MANDATORY and FAIL-CLOSED. A dispatch with
 *       no authorization source is refused; a refusal performs ZERO runtime
 *       and transport work.
 *   A3. The production composition cannot select or be handed a mock. Mock
 *       transports declare `provenance: "TEST"` and are refused by the runtime
 *       unless a caller explicitly opted in — which no application does.
 *
 * Nothing here touches Adel's or the `default` profile: every refusal is proven
 * with a spy that asserts the call never left the process.
 */

const ADEL = "adel";
const UNKNOWN = "some-other-operator";
const BRIDGE_URL = "https://bridge.invalid";
const SECRET = "s3cret";

function bridgeEnv(profile: string): Record<string, string | undefined> {
  return {
    HERMES_RUNTIME_TRANSPORT: "BRIDGE",
    HERMES_RUNTIME_PROFILE: profile,
    HERMES_RUNTIME_BRIDGE_URL: BRIDGE_URL,
    HERMES_RUNTIME_BRIDGE_SECRET: SECRET,
    HERMES_RUNTIME_TIMEOUT_MS: "5000",
  };
}

function saieedConfig(overrides: Partial<HermesRuntimeConfig> = {}): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "BRIDGE",
    profile: NEXUP_HERMES_PROFILE,
    bridgeEndpoint: BRIDGE_URL,
    bridgeKeyId: "nexup-vercel",
    bridgeSecretPresent: true,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
    ...overrides,
  };
}

function request(profile: string, operation: HermesTransportRequest["operation"] = "submit"): HermesTransportRequest {
  return {
    operation,
    profile,
    payload: { instruction: "hello", contextJson: "{}" },
    timeoutMs: 1_000,
    maxOutputBytes: 1_024,
    correlation: { actorId: "actor_test", traceId: "trace_test" },
  };
}

/* ═══════════════════════════════════════════════════════
   A1 — profile isolation is a positive allowlist
   ═══════════════════════════════════════════════════════ */

describe("A1 — NEXUP addresses exactly one profile, by allowlist", () => {
  it("allows only `saieed`", () => {
    expect(NEXUP_ALLOWED_PROFILES).toEqual([NEXUP_HERMES_PROFILE]);
    expect(assertNexupProfile("saieed")).toBe("saieed");
  });

  it("refuses adel, default and an unknown profile at the config boundary", () => {
    for (const profile of [ADEL, "default", UNKNOWN, "Saieed"]) {
      const resolution = resolveHermesConfig(bridgeEnv(profile));
      expect(resolution.enabled, `profile ${profile} must be refused`).toBe(false);
      if (!resolution.enabled) expect(resolution.reason).toMatch(/allowlist|forbidden|safe slug/i);
    }
  });

  it("builds NO runtime and makes ZERO network calls for a refused profile", async () => {
    let calls = 0;
    const spy = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    for (const profile of [ADEL, "default", UNKNOWN]) {
      const built = createHermesRuntimeFromEnv(bridgeEnv(profile), { fetchImpl: spy });
      expect(built.enabled, `profile ${profile} must not produce a runtime`).toBe(false);
    }
    expect(calls).toBe(0);
  });

  it("refuses a non-allowlisted profile at the TRANSPORT, before any request", async () => {
    let calls = 0;
    const spy = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new HermesBridgeClient({ baseUrl: BRIDGE_URL, keyId: "nexup-vercel", secret: SECRET, fetchImpl: spy });
    const transport = new HermesBridgeTransport({ client, profile: NEXUP_HERMES_PROFILE });

    for (const profile of [ADEL, "default", UNKNOWN]) {
      const result = await transport.invoke(request(profile));
      expect(result.ok).toBe(false);
      expect(result.transportError).toBe("FORBIDDEN");
    }
    // ...and the allowlisted profile is NOT refused (it is simply not reachable
    // here, which the bridge double reports as a failure, not a FORBIDDEN).
    const allowed = await transport.invoke(request(NEXUP_HERMES_PROFILE));
    expect(allowed.transportError).not.toBe("FORBIDDEN");
    expect(calls).toBeGreaterThan(0);
  });

  it("refuses a non-allowlisted profile before opening the RPC socket", async () => {
    let sockets = 0;
    const transport = new HermesRpcTransport({
      endpoint: "ws://127.0.0.1:1/api/ws",
      profile: NEXUP_HERMES_PROFILE,
      webSocketFactory: () => {
        sockets += 1;
        throw new Error("must not connect");
      },
    });
    for (const profile of [ADEL, "default", UNKNOWN]) {
      const result = await transport.invoke(request(profile));
      expect(result.transportError).toBe("FORBIDDEN");
    }
    expect(sockets).toBe(0);
  });

  it("refuses a non-allowlisted profile at the deterministic transport too", async () => {
    const transport = new DeterministicHermesTransport();
    await expect(transport.invoke(request(ADEL))).rejects.toThrow(/allowlist/i);
    await expect(transport.invoke(request("default"))).rejects.toThrow(/forbidden/i);
  });
});

/* ═══════════════════════════════════════════════════════
   A2 — capability authorization is mandatory and fail-closed
   ═══════════════════════════════════════════════════════ */

/** A runtime that counts how often it was actually asked to do work. */
class CountingRuntime implements AgentRuntime {
  readonly identity = {
    id: "runtime_counting",
    type: "EXTERNAL_AGENT_RUNTIME",
    displayName: "Counting runtime",
    capabilities: ["SKILL"],
    metadata: { counted: true },
  };
  submitCalls = 0;
  cancelCalls = 0;

  async healthCheck(): Promise<RuntimeHealth> {
    return { status: "HEALTHY", checkedAt: new Date().toISOString() };
  }
  async submitJob(request: AgentJobRequest): Promise<AgentJobHandle> {
    this.submitCalls += 1;
    return {
      handleId: `h_${this.submitCalls}`,
      runtimeId: this.identity.id,
      jobId: request.jobId,
      status: "SUCCEEDED",
      submittedAt: new Date().toISOString(),
    };
  }
  async resumeJob(handleId: string): Promise<AgentJobHandle> {
    return { handleId, runtimeId: this.identity.id, status: "SUCCEEDED", submittedAt: new Date().toISOString() };
  }
  async cancelJob(handleId: string): Promise<AgentJobHandle> {
    this.cancelCalls += 1;
    return { handleId, runtimeId: this.identity.id, status: "CANCELLED", submittedAt: new Date().toISOString() };
  }
  async getExecutionStatus(handleId: string): Promise<AgentJobHandle> {
    return { handleId, runtimeId: this.identity.id, status: "SUCCEEDED", submittedAt: new Date().toISOString() };
  }
}

async function authorizedDomain() {
  const ids = createSequentialIdFactory("w");
  const now = sequentialClock("2026-07-01T00:00:00.000Z", 1000);
  const domain = createWorkforceDomain({ ids, now });
  const runtime = new CountingRuntime();
  domain.runtimes.register(runtime);
  const actor = await domain.actors.register({
    slug: "counting-agent",
    displayName: "Counting agent",
    type: "AI_AGENT",
    role: "specialist",
    department: "growth-revenue",
    reportsTo: null,
    collaborators: [],
    lifecycle: "SHADOW",
    runtimeBinding: { runtimeId: runtime.identity.id, runtimeType: "EXTERNAL_AGENT_RUNTIME" },
    modelPolicy: { strategy: "RUNTIME_DEFAULT" },
    autonomyLevel: "ASSISTED",
    memoryScope: { scope: "DEPARTMENT", retention: "SESSION" },
    permissions: [{ permission: "aiworkforce.access" }],
    approvalPolicy: { mode: "INHERIT" },
    escalationTarget: null,
    metadata: {},
  });
  const capability = await domain.capabilities.register({
    id: "counting.run",
    name: "Counting capability",
    kind: "SKILL",
    version: "1.0.0",
    description: "counting capability",
    owner: actor.id,
    riskLevel: "LOW",
    status: "ACTIVE",
    procedureRef: "sop://test/counting",
  });
  return { domain, runtime, actor, capability };
}

describe("A2 — capability authorization is mandatory and fail-closed", () => {
  it("dispatches an ASSIGNED capability and calls the runtime exactly once", async () => {
    const { domain, runtime, actor, capability } = await authorizedDomain();
    await domain.assignments.assign({ actorId: actor.id, capabilityId: capability.id, grantedBy: "founder" });
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });

    const outcome = await dispatcher.dispatch({
      actorId: actor.id,
      runtimeId: runtime.identity.id,
      capabilityId: capability.id,
    });
    expect(outcome.dispatched).toBe(true);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(runtime.submitCalls).toBe(1);
  });

  it("refuses an UNASSIGNED capability with zero runtime calls", async () => {
    const { domain, runtime, actor } = await authorizedDomain();
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });

    const outcome = await dispatcher.startJob({
      actorId: actor.id,
      runtimeId: runtime.identity.id,
      capabilityId: "counting.never-granted",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("CAPABILITY_NOT_ASSIGNED");
    expect(outcome.error?.code).toBe("PERMISSION_DENIED");
    expect(runtime.submitCalls).toBe(0);
  });

  it("refuses to dispatch when NO authorization source was supplied (fail-closed)", async () => {
    const { domain, runtime, actor, capability } = await authorizedDomain();
    await domain.assignments.assign({ actorId: actor.id, capabilityId: capability.id, grantedBy: "founder" });

    // A caller that (wrongly) omits the assignment service. Deliberately cast,
    // because the type now makes this impossible to write honestly.
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
    } as unknown as AgentRuntimeDispatcherDeps);

    const outcome = await dispatcher.dispatch({
      actorId: actor.id,
      runtimeId: runtime.identity.id,
      capabilityId: capability.id,
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("AUTHORIZATION_UNAVAILABLE");
    expect(outcome.error?.code).toBe("PERMISSION_DENIED");
    expect(runtime.submitCalls).toBe(0);
  });

  it("refuses a HUMAN actor and never reaches the runtime", async () => {
    const { domain, runtime } = await authorizedDomain();
    const human = await domain.actors.register({
      slug: "the-founder",
      displayName: "The Founder",
      type: "HUMAN",
      role: "owner",
      department: "executive",
      reportsTo: null,
      collaborators: [],
      lifecycle: "ASSISTED",
      runtimeBinding: null,
      modelPolicy: { strategy: "RUNTIME_DEFAULT" },
      autonomyLevel: "MANUAL",
      memoryScope: { scope: "ORGANIZATION", retention: "LONG_TERM" },
      permissions: [{ permission: "aiworkforce.access" }],
      approvalPolicy: { mode: "NEVER" },
      escalationTarget: null,
      metadata: {},
    });
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });

    const outcome = await dispatcher.dispatch({
      actorId: human.id,
      runtimeId: runtime.identity.id,
      capabilityId: "counting.run",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("HUMAN_ACTOR");
    expect(runtime.submitCalls).toBe(0);
  });

  it("also refuses through the JobRunner binding path", async () => {
    const { domain, runtime, actor } = await authorizedDomain();
    const dispatcher = new AgentRuntimeDispatcher({
      runtimes: domain.runtimes,
      actors: domain.actors,
      assignments: domain.assignments,
    });
    const outcome = await dispatcher.dispatchJob({
      id: "job_unassigned",
      actorId: actor.id,
      runtimeId: runtime.identity.id,
      capabilityId: "counting.never-granted",
      correlationId: "trace_unassigned",
    });
    expect(outcome.dispatched).toBe(false);
    expect(outcome.reason).toBe("CAPABILITY_NOT_ASSIGNED");
    expect(runtime.submitCalls).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════
   A3 — a mock cannot reach a real actor execution
   ═══════════════════════════════════════════════════════ */

describe("A3 — the production path cannot select or be handed a mock", () => {
  it("declares the deterministic transport as TEST provenance", () => {
    expect(new DeterministicHermesTransport().provenance).toBe("TEST");
  });

  it("does NOT export the mock from the production module surface", async () => {
    const surface = await import("@/modules/workforce");
    expect("DeterministicHermesTransport" in surface).toBe(false);
  });

  it("refuses to bind a TEST transport unless the caller explicitly opted in", () => {
    expect(() =>
      new HermesRuntimeAdapter({ config: saieedConfig(), transport: new DeterministicHermesTransport() }),
    ).toThrow(/PRODUCTION transport/);

    // The explicit opt-in is what the test fixtures use — and only they do.
    const adapter = new HermesRuntimeAdapter({
      config: saieedConfig(),
      transport: new DeterministicHermesTransport(),
      allowTestTransport: true,
    });
    expect(adapter.identity.metadata.profileRef).toBe(NEXUP_HERMES_PROFILE);
  });

  it("refuses a transport that does not declare its provenance at all", () => {
    const undeclared = {
      kind: "BRIDGE",
      async invoke() {
        return { ok: true, raw: "{}", truncated: false, durationMs: 1 };
      },
    } as unknown as HermesTransport;
    expect(() => createHermesRuntime(saieedConfig(), { transport: undeclared })).toThrow(/undeclared/i);
  });

  it("builds only PRODUCTION-provenance transports from configuration", () => {
    const kinds: Array<{ env: Record<string, string | undefined> }> = [
      { env: bridgeEnv(NEXUP_HERMES_PROFILE) },
      {
        env: {
          HERMES_RUNTIME_TRANSPORT: "RPC",
          HERMES_RUNTIME_PROFILE: NEXUP_HERMES_PROFILE,
          HERMES_RUNTIME_RPC_URL: "ws://127.0.0.1:1/api/ws",
        },
      },
      {
        env: {
          HERMES_RUNTIME_TRANSPORT: "CLI_ONESHOT",
          HERMES_RUNTIME_PROFILE: NEXUP_HERMES_PROFILE,
          HERMES_RUNTIME_EXECUTABLE: "/usr/local/bin/hermes",
        },
      },
    ];
    for (const { env } of kinds) {
      const resolution = resolveHermesConfig(env);
      expect(resolution.enabled).toBe(true);
      if (!resolution.enabled) continue;
      expect(createHermesTransport(resolution.config, { bridgeSecret: SECRET }).provenance).toBe("PRODUCTION");
    }
  });

  it("starts the application with NO runtime of its own", async () => {
    const domain = await bootstrapWorkforceDomain({ seedExecutive: true });
    // The real actor is wired in explicitly (bootstrapStrategyAnalyst); nothing
    // that replays canned output is registered on the application's behalf.
    expect(domain.runtimes.count()).toBe(0);
    expect(domain.runtimes.findByType("DETERMINISTIC_LOCAL")).toEqual([]);
  });
});
