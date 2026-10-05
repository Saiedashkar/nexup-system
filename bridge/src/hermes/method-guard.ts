import {
  DEFAULT_HERMES_RPC_PROTOCOL,
  type HermesRpcProtocol,
} from "@/modules/workforce/runtimes/hermes/hermes-protocol";
import type {
  HermesTransport,
  HermesTransportRequest,
  HermesTransportResult,
} from "@/modules/workforce/runtimes/hermes/hermes-transport";

import { BridgeError } from "../api/errors";
import { assertAllowedHermesMethod } from "./allowlist";

/**
 * Runtime Hermes method guard.
 *
 * The bridge is NOT a proxy: it can only ever emit the fixed set of Hermes
 * methods that back the run/health contract. `assertAllowedHermesMethod` is the
 * allowlist, but an allowlist that is only proven by construction or by unit
 * tests is not a control — it has to sit ON the outbound path, between a run
 * request and the socket.
 *
 * `guardHermesTransport` is that control. It wraps the ONE transport the bridge
 * ever builds (`createBridgeTransportFactory`) and, before delegating any
 * `invoke`, derives the exact methods the operation will put on the wire from
 * the SAME protocol object the transport uses and asserts each of them against
 * the allowlist. A non-allowlisted method — including a drifted or tampered
 * protocol — fails CLOSED with `METHOD_NOT_ALLOWED` before a single frame is
 * sent. The protocol is shared with the transport, so the guard and the wire
 * cannot drift.
 *
 * There is no caller-supplied method anywhere: an operation is chosen in code
 * and mapped here to a fixed method plan. `resume` (and anything unknown)
 * emits nothing and is refused.
 */

/** The methods each bridge operation emits, derived from the live protocol. */
export function hermesMethodsForOperation(
  operation: string,
  protocol: HermesRpcProtocol = DEFAULT_HERMES_RPC_PROTOCOL,
): string[] {
  const methods = protocol.methods;
  switch (operation) {
    case "health":
      return [methods.health];
    case "submit":
      // The verified run sequence: create the session, then submit the prompt.
      return [methods.sessionCreate, methods.promptSubmit];
    case "status":
      return [methods.sessionStatus];
    case "cancel":
      return [methods.sessionInterrupt];
    default:
      // `resume` and any unknown operation have no verified method; emitting
      // nothing is a denial, never a pass-through.
      return [];
  }
}

/**
 * Asserts every Hermes method the operation will emit is allowlisted.
 *
 * @throws BridgeError METHOD_NOT_ALLOWED when the operation is unknown or any
 * of its methods is off the allowlist. Fails closed.
 */
export function assertOperationMethodsAllowed(
  operation: string,
  protocol: HermesRpcProtocol = DEFAULT_HERMES_RPC_PROTOCOL,
): readonly string[] {
  const methods = hermesMethodsForOperation(operation, protocol);
  if (methods.length === 0) {
    throw new BridgeError(
      "METHOD_NOT_ALLOWED",
      `Hermes operation "${operation}" is not permitted by the NEXUP bridge`,
    );
  }
  for (const method of methods) assertAllowedHermesMethod(method);
  return methods;
}

/**
 * Wraps a transport so every outbound `invoke` first passes the runtime method
 * guard. Preserves `kind` and forwards `close` so run teardown is unchanged.
 */
export function guardHermesTransport(
  transport: HermesTransport,
  protocol: HermesRpcProtocol = DEFAULT_HERMES_RPC_PROTOCOL,
): HermesTransport & { close?: () => void } {
  const guarded = {
    kind: transport.kind,
    async invoke(request: HermesTransportRequest): Promise<HermesTransportResult> {
      // Fail closed BEFORE the delegate touches the socket.
      assertOperationMethodsAllowed(request.operation, protocol);
      return transport.invoke(request);
    },
  } as HermesTransport & { close?: () => void };

  const closable = transport as { close?: () => void };
  if (typeof closable.close === "function") {
    guarded.close = () => closable.close?.();
  }
  return guarded;
}
