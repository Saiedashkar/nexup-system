import { afterEach, describe, expect, it, vi } from "vitest";

import {
  postExecTurn,
  type ExecConversationResult,
} from "@/components/command/exec-lab/exec-conversation-client";
import {
  ExecTurnGate,
  beginExecConversationTurn,
  finishExecConversationTurn,
} from "@/components/command/exec-lab/exec-conversation-state";
import { createExperience, newConversation } from "@/components/command/exec-lab/engine";
import { EXEC_TURN_PATH, type ExecTurnSuccess } from "@/modules/exec-conversation/contracts";

const success = (turnId = "turn-1", conversationId = "conv-1"): ExecTurnSuccess => ({
  contract: "exec-conversation/v1",
  requestId: "request-1",
  turnId,
  conversationId,
  reply: { text: "Dummy reply", truncated: false, durationMs: 3 },
  connector: { kind: "DUMMY", provenance: "TEST" },
});

afterEach(() => vi.useRealTimers());

describe("EXEC conversation HTTP client", () => {
  it("posts one message to the relative v1 endpoint without history", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(success()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await postExecTurn(
      { turnId: "turn-1", message: "  hello  ", conversationId: "conv-1" },
      { fetchImpl },
    );

    expect(result).toMatchObject({ kind: "success", value: success() });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe(EXEC_TURN_PATH);
    expect(calls[0].init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      turnId: "turn-1",
      message: "hello",
      conversationId: "conv-1",
    });
  });

  it("rejects a success envelope for another turn instead of rendering it", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(success("turn-late")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const result = await postExecTurn(
      { turnId: "turn-current", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );

    expect(result).toEqual({ kind: "error", code: "PROTOCOL_ERROR", requestId: "request-1" });
  });

  it("maps a well-formed error envelope to its code", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "CONNECTOR_UNAVAILABLE",
          message: "الموصل غير متاح في هذه البيئة.",
          requestId: "request-503",
          details: null,
        }),
        {
          status: 503,
          headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-503" },
        },
      ),
    ) as unknown as typeof fetch;

    const result: ExecConversationResult = await postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );

    expect(result).toEqual({ kind: "error", code: "CONNECTOR_UNAVAILABLE", requestId: "request-503" });
  });

  it("rejects an error envelope that leaks details or drops the safe message", async () => {
    const leaky = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: "CONNECTOR_UNAVAILABLE",
          message: "internal connector text",
          requestId: "request-503",
          details: { secret: "must-not-render" },
        }),
        {
          status: 503,
          headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-503" },
        },
      ),
    ) as unknown as typeof fetch;

    const leaking = await postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl: leaky },
    );

    expect(leaking).toEqual({ kind: "error", code: "PROTOCOL_ERROR", requestId: "request-503" });
    expect(JSON.stringify(leaking)).not.toContain("must-not-render");
    expect(JSON.stringify(leaking)).not.toContain("internal connector text");

    const silent = vi.fn(async () =>
      new Response(JSON.stringify({ error: "CONNECTOR_UNAVAILABLE", requestId: "request-503", details: null }), {
        status: 503,
        headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-503" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      postExecTurn({ turnId: "turn-1", message: "hello", conversationId: "conv-1" }, { fetchImpl: silent }),
    ).resolves.toEqual({ kind: "error", code: "PROTOCOL_ERROR", requestId: "request-503" });
  });

  it("rejects a success echo for another conversation", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(success("turn-1", "conv-other")), {
        status: 200,
        headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-1" },
      }),
    ) as unknown as typeof fetch;

    const result = await postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );

    expect(result).toEqual({ kind: "error", code: "PROTOCOL_ERROR", requestId: "request-1" });
  });

  it("rejects a response whose request id differs between header and body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(success()), {
        status: 200,
        headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-header" },
      }),
    ) as unknown as typeof fetch;

    const result = await postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );

    expect(result).toEqual({ kind: "error", code: "PROTOCOL_ERROR", requestId: "request-header" });
  });

  it("aborts at the client deadline without retrying", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    ) as unknown as typeof fetch;

    const pending = postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(pending).resolves.toEqual({ kind: "error", code: "CLIENT_TIMEOUT", requestId: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active after headers and times out a delayed JSON body", async () => {
    vi.useFakeTimers();
    let bodyAborted = false;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bytes = new TextEncoder().encode(JSON.stringify(success()));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const timer = setTimeout(() => {
              controller.enqueue(bytes);
              controller.close();
            }, 30_000);
            init?.signal?.addEventListener(
              "abort",
              () => {
                bodyAborted = true;
                clearTimeout(timer);
                controller.error(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          },
        }),
        { status: 200, headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-1" } },
      );
    }) as unknown as typeof fetch;

    const pending = postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl },
    );
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(pending).resolves.toEqual({ kind: "error", code: "CLIENT_TIMEOUT", requestId: "request-1" });
    expect(bodyAborted).toBe(true);
  });

  it("keeps caller cancellation connected while the JSON body is being read", async () => {
    const caller = new AbortController();
    let bodyAborted = false;
    let markBodyRead!: () => void;
    const bodyRead = new Promise<void>((resolve) => {
      markBodyRead = resolve;
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => {
                bodyAborted = true;
                controller.error(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          },
          pull() {
            markBodyRead();
          },
        }),
        { status: 200, headers: { "content-type": "application/json", "X-Nexup-Request-Id": "request-1" } },
      ),
    ) as unknown as typeof fetch;

    const pending = postExecTurn(
      { turnId: "turn-1", message: "hello", conversationId: "conv-1" },
      { fetchImpl, signal: caller.signal },
    );
    await bodyRead;
    caller.abort();

    await expect(pending).resolves.toEqual({ kind: "error", code: "NETWORK_ERROR", requestId: "request-1" });
    expect(bodyAborted).toBe(true);
  });
});

describe("EXEC turn gate", () => {
  it("refuses a second turn synchronously while the first is pending", () => {
    const gate = new ExecTurnGate();
    const first = gate.start("turn-1", "conv-1");

    expect(first?.signal.aborted).toBe(false);
    expect(gate.start("turn-2", "conv-1")).toBeNull();
    expect(gate.pending).toBe(true);
  });

  it("aborts on context change and rejects the late settlement", () => {
    const gate = new ExecTurnGate();
    const pending = gate.start("turn-1", "conv-1");

    gate.cancel();

    expect(pending?.signal.aborted).toBe(true);
    expect(gate.settle("turn-1", "conv-1")).toBe(false);
    expect(gate.pending).toBe(false);
  });
});

describe("EXEC conversation state", () => {
  it("adds the user's free message without invoking the scripted demo reply", () => {
    const initial = createExperience("en");
    const next = beginExecConversationTurn(initial, {
      turnId: "turn-1",
      message: "hello",
      at: "10:24",
    });

    expect(next.general).toEqual([
      { id: "api-user-turn-1", from: "founder", at: "10:24", text: "hello", cards: [] },
    ]);
  });

  it("appends only the matching dummy reply and ignores a reply after conversation change", () => {
    const started = beginExecConversationTurn(createExperience("en"), {
      turnId: "turn-1",
      message: "hello",
      at: "10:24",
    });
    const changed = newConversation(started);

    const stale = finishExecConversationTurn(changed, {
      turnId: "turn-1",
      conversationId: started.activeId,
      at: "10:25",
      result: { kind: "success", value: success("turn-1", started.activeId) },
    });
    expect(stale).toBe(changed);

    const current = finishExecConversationTurn(started, {
      turnId: "turn-1",
      conversationId: started.activeId,
      at: "10:25",
      result: { kind: "success", value: success("turn-1", started.activeId) },
    });
    expect(current.general.at(-1)).toEqual({
      id: "api-reply-turn-1",
      from: "exec",
      at: "10:25",
      text: "Dummy reply",
      cards: [],
    });
  });

  it("renders a localized safe error with its request id and no unresolved placeholder", () => {
    const started = beginExecConversationTurn(createExperience("ar"), {
      turnId: "turn-1",
      message: "مرحبا",
      at: "10:24",
    });
    const failed = finishExecConversationTurn(started, {
      turnId: "turn-1",
      conversationId: started.activeId,
      at: "10:25",
      result: { kind: "error", code: "CONNECTOR_UNAVAILABLE", requestId: "request-503" },
    });

    expect(failed.general.at(-1)).toMatchObject({
      id: "api-error-turn-1",
      text: "الموصل الاختباري غير متاح. لم يُنفَّذ شيء. المرجع: request-503",
    });
    expect(failed.general.at(-1)?.text).not.toContain("{requestId}");
  });
});
