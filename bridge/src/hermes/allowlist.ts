import { HERMES_RPC_METHODS } from "@/modules/workforce/runtimes/hermes/hermes-protocol";

import { BridgeError } from "../api/errors";

/**
 * The strict allowlist of Hermes JSON-RPC methods the bridge will ever emit.
 *
 * These are the six methods the verified contract exposes for a NEXUP run
 * plus `gateway.ping` for health. The list is DERIVED from the app's verified
 * `HERMES_RPC_METHODS` registry so the bridge and the adapter cannot drift.
 *
 * `llm.oneshot` is DELIBERATELY EXCLUDED: it is a free-form single-shot model
 * call that would let a caller drive an arbitrary model prompt outside the
 * run/session contract. A bridge that forwarded it would be a generic proxy,
 * which this design forbids.
 */
export const BRIDGE_ALLOWED_HERMES_METHODS = [
  HERMES_RPC_METHODS.health,
  HERMES_RPC_METHODS.sessionCreate,
  HERMES_RPC_METHODS.promptSubmit,
  HERMES_RPC_METHODS.sessionStatus,
  HERMES_RPC_METHODS.sessionHistory,
  HERMES_RPC_METHODS.sessionInterrupt,
  HERMES_RPC_METHODS.sessionEventsSince,
] as const;

/** Methods that exist on the Hermes surface but are never reachable here. */
export const BRIDGE_EXCLUDED_HERMES_METHODS = [HERMES_RPC_METHODS.llmOneshot] as const;

export function isAllowedHermesMethod(method: string): boolean {
  return (BRIDGE_ALLOWED_HERMES_METHODS as readonly string[]).includes(method);
}

/** @throws BridgeError METHOD_NOT_ALLOWED for anything off the allowlist. */
export function assertAllowedHermesMethod(method: string): string {
  if (!isAllowedHermesMethod(method)) {
    throw new BridgeError("METHOD_NOT_ALLOWED", `Hermes method "${method}" is not permitted by the NEXUP bridge`);
  }
  return method;
}
