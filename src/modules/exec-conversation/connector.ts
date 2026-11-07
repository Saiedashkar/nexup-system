/**
 * The connector port — the boundary a real model provider will eventually sit
 * behind. In this integration copy the ONLY implementation is the dummy
 * connector; the future Hermes connector adapts `HermesTransport.invoke`
 * without changing this shape.
 *
 * The port is deliberately minimal: one turn in, one text out. No tools, no
 * missions, no approvals, no capability invocation, no persisted state.
 */

export type ExecConnectorTurn = {
  /** Server-assigned correlation id — for logs only, never shown to a model. */
  requestId: string;
  /** Client-assigned correlation id, echoed back unchanged. */
  turnId: string;
  /** Opaque correlation echo. Never a transcript key, never stored. */
  conversationId: string | null;
  /** Already trimmed and validated. The only content that crosses the boundary. */
  message: string;
  /** Aborted when the turn exceeds its binding. Connectors SHOULD observe it. */
  signal: AbortSignal;
};

export type ExecConnectorReply = {
  text: string;
  durationMs: number;
};

export type ExecConnector = {
  readonly kind: "DUMMY";
  /** Where the text came from. `TEST` may never be presented as a live model. */
  readonly provenance: "TEST";
  send(turn: ExecConnectorTurn): Promise<ExecConnectorReply>;
};

/** Connector-side refusal, mapped to a status by the composition layer. */
export class ExecConnectorError extends Error {
  readonly code: "CONNECTOR_UNAVAILABLE" | "INTERNAL";

  constructor(code: "CONNECTOR_UNAVAILABLE" | "INTERNAL", message: string) {
    super(message);
    this.name = "ExecConnectorError";
    this.code = code;
  }
}

export function isExecConnectorError(error: unknown): error is ExecConnectorError {
  return error instanceof ExecConnectorError;
}
