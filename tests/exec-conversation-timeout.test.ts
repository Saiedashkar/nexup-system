import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The deadline is enforced by the ROUTE, with a connector that ignores its
 * AbortSignal and answers late.
 *
 * The only thing shortened here is the binding itself (20s → 25ms) and the
 * connector: the route handler, the gate order, the envelope and the real
 * `runExecTurn` binder are the shipped ones.
 */

const hostile = vi.hoisted(() => {
  const state = { calls: 0, lateFulfillments: 0, signalWasAborted: false };
  const connector = {
    kind: "DUMMY" as const,
    provenance: "TEST" as const,
    async send(turn: { signal: AbortSignal }) {
      state.calls += 1;
      // Deliberately ignores the signal: it answers whenever it feels like it.
      await new Promise((resolve) => setTimeout(resolve, 180));
      state.signalWasAborted = turn.signal.aborted;
      state.lateFulfillments += 1;
      return { text: "رد متأخر يجب ألا يظهر", durationMs: 180 };
    },
  };
  return { state, connector };
});

const authState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentSession: async () => authState.current };
});

vi.mock("@/modules/exec-conversation/composition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/exec-conversation/composition")>();
  return {
    ...actual,
    resolveExecConnector: () => ({ kind: "connector", connector: hostile.connector, delayMs: 0 }),
    // Same real binder; only the deadline is shortened so the proof stays fast.
    runExecTurn: (input: Parameters<typeof actual.runExecTurn>[0]) =>
      actual.runExecTurn({ ...input, timeoutMs: 25 }),
  };
});

import { POST } from "@/app/api/exec/turn/route";
import { EXEC_REQUEST_ID_HEADER } from "@/modules/exec-conversation/contracts";

const TRUSTED = "http://localhost:3100";
const TURN_URL = `${TRUSTED}/api/exec/turn`;

process.env.AUTH_SECRET ||= "exec-review-test-secret-value-at-least-32-chars";
process.env.EXEC_TRUSTED_ORIGIN = TRUSTED;

beforeEach(() => {
  authState.current = {
    userId: "review-exec-user",
    name: "EXEC Review",
    role: "EMPLOYEE",
    businessId: "review",
    canAccessNexup: false,
    canAccessRebound: false,
    canAccessAbomazen: false,
    canAccessOfficeFinanceFull: false,
  };
  hostile.state.calls = 0;
  hostile.state.lateFulfillments = 0;
  hostile.state.signalWasAborted = false;
});

function turnRequest(): NextRequest {
  return new NextRequest(TURN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", origin: TRUSTED },
    body: JSON.stringify({ turnId: "timeout-1", message: "مرحبا" }),
  });
}

describe("route — an abandoned turn can never produce a reply", () => {
  it("answers 504 CONNECTOR_TIMEOUT and never the late text", async () => {
    const response = await POST(turnRequest());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(504);
    expect(body.error).toBe("CONNECTOR_TIMEOUT");
    expect(body.details).toBeNull();
    expect(body.reply).toBeUndefined();
    expect(body.contract).toBeUndefined();
    expect(body.requestId).toBe(response.headers.get(EXEC_REQUEST_ID_HEADER));
    expect(JSON.stringify(body)).not.toContain("رد متأخر");

    // The connector did answer — after the deadline — and that answer was
    // consumed and discarded rather than delivered.
    expect(hostile.state.calls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(hostile.state.lateFulfillments).toBe(1);
    expect(hostile.state.signalWasAborted).toBe(true);
    expect(hostile.state.calls).toBe(1); // no retry, no second attempt
  });

  it("does not carry state between turns: a second turn is a fresh request", async () => {
    const first = await POST(turnRequest());
    const second = await POST(turnRequest());
    const firstBody = (await first.json()) as Record<string, unknown>;
    const secondBody = (await second.json()) as Record<string, unknown>;

    expect(first.status).toBe(504);
    expect(second.status).toBe(504);
    expect(firstBody.requestId).not.toBe(secondBody.requestId);
    expect(hostile.state.calls).toBe(2);
  });
});
