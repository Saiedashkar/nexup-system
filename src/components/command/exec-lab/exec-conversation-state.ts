import type { ExecConversationResult } from "./exec-conversation-client";
import { t } from "./i18n";
import type { ExperienceState, Message, MessageKey } from "./types";

type PendingTurn = {
  turnId: string;
  conversationId: string;
  controller: AbortController;
};

export class ExecTurnGate {
  private current: PendingTurn | null = null;

  get pending(): boolean {
    return this.current !== null;
  }

  start(turnId: string, conversationId: string): { signal: AbortSignal } | null {
    if (this.current) return null;
    const controller = new AbortController();
    this.current = { turnId, conversationId, controller };
    return { signal: controller.signal };
  }

  cancel(): void {
    const pending = this.current;
    this.current = null;
    pending?.controller.abort();
  }

  settle(turnId: string, conversationId: string): boolean {
    const pending = this.current;
    if (!pending || pending.turnId !== turnId || pending.conversationId !== conversationId) return false;
    this.current = null;
    return !pending.controller.signal.aborted;
  }
}

export function beginExecConversationTurn(
  state: ExperienceState,
  turn: { turnId: string; message: string; at: string },
): ExperienceState {
  const cards: Message["cards"] = state.attachments.map((attachment) => ({
    kind: "attachment",
    id: `att-${attachment.id}`,
    nameKey: attachment.nameKey,
    ...(attachment.name ? { name: attachment.name } : {}),
    fileKind: attachment.fileKind,
    ...(attachment.local ? { local: true } : {}),
    demo: true,
  }));
  const message: Message = {
    id: `api-user-${turn.turnId}`,
    from: "founder",
    at: turn.at,
    text: turn.message,
    cards,
  };
  return { ...state, conversation: "general", general: [...state.general, message], attachments: [] };
}

const ERROR_KEY: Record<Extract<ExecConversationResult, { kind: "error" }>["code"], MessageKey> = {
  INVALID_INPUT: "conversation.error.invalidInput",
  UNAUTHORIZED: "conversation.error.unauthorized",
  CSRF_REJECTED: "conversation.error.csrfRejected",
  MESSAGE_TOO_LARGE: "conversation.error.messageTooLarge",
  PAYLOAD_TOO_LARGE: "conversation.error.messageTooLarge",
  UNSUPPORTED_MEDIA_TYPE: "conversation.error.protocol",
  CONNECTOR_UNAVAILABLE: "conversation.error.connectorUnavailable",
  CONNECTOR_TIMEOUT: "conversation.error.timeout",
  INTERNAL: "conversation.error.internal",
  PROTOCOL_ERROR: "conversation.error.protocol",
  NETWORK_ERROR: "conversation.error.network",
  CLIENT_TIMEOUT: "conversation.error.timeout",
};

export function finishExecConversationTurn(
  state: ExperienceState,
  turn: {
    turnId: string;
    conversationId: string;
    at: string;
    result: ExecConversationResult;
  },
): ExperienceState {
  if (state.activeId !== turn.conversationId) return state;

  const message: Message =
    turn.result.kind === "success"
      ? {
          id: `api-reply-${turn.turnId}`,
          from: "exec",
          at: turn.at,
          text: turn.result.value.reply.text,
          cards: [],
        }
      : {
          id: `api-error-${turn.turnId}`,
          from: "exec",
          at: turn.at,
          text: t(state.locale, ERROR_KEY[turn.result.code], { requestId: turn.result.requestId ?? "—" }),
          cards: [],
        };
  return { ...state, conversation: "general", general: [...state.general, message] };
}
