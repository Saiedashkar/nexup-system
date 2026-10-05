/**
 * Server-Sent Events framing.
 *
 * Kept pure and separate from Node's `http` so the exact wire bytes can be
 * golden-tested. One `event:`/`data:` pair per frame, terminated by a blank
 * line, exactly as the SSE specification requires.
 */

export function formatSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment frame used as a keep-alive; proxies and browsers ignore it. */
export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}

export type SseWriter = {
  write(chunk: string): void;
  end(): void;
  /** Node `ServerResponse#writableEnded`, or a test equivalent. */
  finished: boolean;
};

export type SseStreamOptions = {
  heartbeatMs?: number;
  now?: () => Date;
};

/**
 * An SSE stream over a writer.
 *
 * Tracks emitted bytes (so the bridge can bound total output) and sends a
 * periodic comment so idle connections are not reaped. `onClose` lets the route
 * tear down the underlying run when the client goes away.
 */
export class SseStream {
  private closed = false;
  private bytes = 0;
  private readonly heartbeatMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    private readonly writer: SseWriter,
    options: SseStreamOptions = {},
  ) {
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.startHeartbeat();
  }

  get bytesOut(): number {
    return this.bytes;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.write(formatSseFrame(event, data));
  }

  comment(text: string): void {
    if (this.closed) return;
    this.write(formatSseComment(text));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.writer.end();
    } catch {
      /* ignore */
    }
    for (const listener of [...this.closeListeners]) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
    this.closeListeners.clear();
  }

  private write(chunk: string): void {
    if (this.writer.finished) {
      this.close();
      return;
    }
    try {
      this.writer.write(chunk);
      this.bytes += chunk.length;
    } catch {
      this.close();
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0) return;
    const tick = () => {
      if (this.closed) return;
      this.comment("ping");
      this.timer = setTimeout(tick, this.heartbeatMs);
      if (typeof this.timer.unref === "function") this.timer.unref();
    };
    this.timer = setTimeout(tick, this.heartbeatMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }
}

/** An in-memory writer for tests. */
export function createMemorySseWriter(): SseWriter & { chunks: string[] } {
  const chunks: string[] = [];
  return {
    chunks,
    finished: false,
    write(chunk: string) {
      chunks.push(chunk);
    },
    end() {
      this.finished = true;
    },
  };
}
