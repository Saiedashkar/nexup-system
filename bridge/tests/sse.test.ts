import { describe, expect, it, vi } from "vitest";

import { SseStream, createMemorySseWriter, formatSseComment, formatSseFrame } from "../src/stream/sse";

describe("SSE framing", () => {
  it("emits the exact event/data/blank-line frame", () => {
    expect(formatSseFrame("delta", { text: "hi" })).toBe('event: delta\ndata: {"text":"hi"}\n\n');
    expect(formatSseComment("ping")).toBe(": ping\n\n");
  });
});

describe("SseStream", () => {
  it("sends frames and tracks emitted bytes", () => {
    const writer = createMemorySseWriter();
    const stream = new SseStream(writer, { heartbeatMs: 0 });
    stream.send("delta", { text: "a" });
    stream.send("complete", { status: "succeeded" });
    expect(writer.chunks).toEqual([
      'event: delta\ndata: {"text":"a"}\n\n',
      'event: complete\ndata: {"status":"succeeded"}\n\n',
    ]);
    expect(stream.bytesOut).toBeGreaterThan(0);
  });

  it("stops writing and ends the writer after close, notifying listeners once", () => {
    const writer = createMemorySseWriter();
    const stream = new SseStream(writer, { heartbeatMs: 0 });
    const onClose = vi.fn();
    stream.onClose(onClose);
    stream.close();
    stream.send("delta", { text: "ignored" });
    expect(writer.finished).toBe(true);
    expect(writer.chunks).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stream.isClosed).toBe(true);
  });

  it("closes when the underlying writer is already finished", () => {
    const writer = createMemorySseWriter();
    writer.finished = true;
    const stream = new SseStream(writer, { heartbeatMs: 0 });
    stream.send("delta", { text: "x" });
    expect(stream.isClosed).toBe(true);
  });
});
