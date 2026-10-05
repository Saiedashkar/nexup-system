import {
  DEFAULT_HERMES_RPC_PROTOCOL,
  type HermesRpcProtocol,
} from "@/modules/workforce/runtimes/hermes/hermes-protocol";
import {
  HermesRpcTransport,
  type HermesRpcEvent,
  type HermesWebSocketFactory,
} from "@/modules/workforce/runtimes/hermes/hermes-rpc-transport";
import type { HermesTransport } from "@/modules/workforce/runtimes/hermes/hermes-transport";

import { guardHermesTransport } from "./method-guard";

/**
 * The bridge's Hermes client.
 *
 * It reuses the app's VERIFIED `HermesRpcTransport` — the same JSON-RPC 2.0
 * client, the same terminal-event completion logic, the same frame bounding —
 * so the bridge and the NEXUP adapter cannot drift.
 *
 * The one bridge-specific detail is auth: Hermes on loopback authenticates a
 * WebSocket with a `?token=<HERMES_DASHBOARD_SESSION_TOKEN>` query parameter
 * (the legacy/gated rules reject a bare header). The token is appended here and
 * ALSO passed to the transport as `options.token` so it is redacted from any
 * captured output.
 *
 * Every transport this factory returns is wrapped by `guardHermesTransport`, so
 * each outbound operation is checked against the Hermes method allowlist at
 * runtime before a frame reaches the socket. Both the transport and the guard
 * read the SAME protocol object, so they cannot drift.
 */

export type BridgeHermesClientOptions = {
  rpcUrl: string;
  sessionToken: string;
  /** The pinned profile; the transport request carries the authoritative one. */
  profile: string;
  /** Origin the Hermes host guard expects (e.g. `http://127.0.0.1:9119`). */
  origin: string;
  /**
   * Adapter-owned protocol. Shared verbatim by the transport AND the runtime
   * method guard, so the allowlist check is a faithful pre-image of the wire.
   */
  protocol?: HermesRpcProtocol;
  /** Injected WebSocket factory for tests. */
  webSocketFactory?: HermesWebSocketFactory;
};

/** Builds the loopback-authenticated WS endpoint (`?token=`). */
export function buildHermesEndpoint(rpcUrl: string, sessionToken: string): string {
  const separator = rpcUrl.includes("?") ? "&" : "?";
  return `${rpcUrl}${separator}token=${encodeURIComponent(sessionToken)}`;
}

/** Per-run transport factory. A fresh transport per run isolates each session. */
export type BridgeTransportFactory = (options: {
  onEvent?: (event: HermesRpcEvent) => void;
  onSession?: (sessionId: string) => void;
}) => HermesTransport;

export function createBridgeTransportFactory(options: BridgeHermesClientOptions): BridgeTransportFactory {
  const protocol = options.protocol ?? DEFAULT_HERMES_RPC_PROTOCOL;
  return ({ onEvent, onSession }) =>
    guardHermesTransport(
      new HermesRpcTransport({
        endpoint: buildHermesEndpoint(options.rpcUrl, options.sessionToken),
        profile: options.profile,
        protocol,
        // Present only so the transport redacts it from captured output; the
        // loopback handshake uses the `?token=` query parameter above.
        token: options.sessionToken,
        headers: { Origin: options.origin },
        ...(options.webSocketFactory ? { webSocketFactory: options.webSocketFactory } : {}),
        ...(onEvent ? { onEvent } : {}),
        ...(onSession ? { onSession } : {}),
      }),
      protocol,
    );
}
