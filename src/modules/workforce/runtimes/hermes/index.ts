import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";

import {
  resolveHermesConfig,
  type HermesEnv,
  type HermesRuntimeCapabilities,
  type HermesRuntimeConfig,
} from "./hermes-config";
import { createHermesTransport, type CreateHermesTransportOptions, type HermesSpawnLike } from "./hermes-transports";
import type { HermesWebSocketFactory } from "./hermes-rpc-transport";
import { HermesRuntimeAdapter, type HermesRuntimeAdapterOptions } from "./hermes-runtime-adapter";
import type { RuntimeEventSink } from "./hermes-transport";
import type { HermesProtocolOverrides } from "./hermes-protocol";

export * from "./hermes-config";
export * from "./hermes-transport";
export * from "./hermes-protocol";
export * from "./hermes-spawn";
export * from "./hermes-rpc-transport";
export * from "./bridge-client";
export * from "./hermes-bridge-transport";
export * from "./hermes-transports";
export * from "./hermes-oneshot-transport";
export * from "./hermes-mapping";
export { HermesRuntimeAdapter } from "./hermes-runtime-adapter";
export type { HermesRuntimeAdapterOptions } from "./hermes-runtime-adapter";

/**
 * Hermes runtime — module surface.
 *
 * Nothing here is reachable from a core contract. The core only ever sees the
 * `AgentRuntime` port; this subpath is where Hermes-specific knowledge lives.
 */

export type HermesRuntimeFactoryResult =
  | { enabled: true; adapter: HermesRuntimeAdapter; reason: string }
  | { enabled: false; reason: string };

export type HermesRuntimeFactoryOptions = {
  eventSink?: RuntimeEventSink;
  now?: Clock;
  ids?: IdFactory;
  fetchImpl?: typeof fetch;
  spawnImpl?: HermesSpawnLike;
  /** Injected WebSocket factory for the RPC transport (tests). */
  webSocketFactory?: HermesWebSocketFactory;
  capabilities?: Partial<HermesRuntimeCapabilities>;
  /**
   * Adapter-owned protocol overrides. The `rpc` shape is the VERIFIED primary
   * contract; `http`/`cli` are quarantined scaffolding. Omit for the defaults.
   */
  protocol?: HermesProtocolOverrides;
};

/**
 * Builds the adapter from the environment.
 *
 * Returns `{ enabled: false, reason }` (never throwing, never faking) when the
 * environment does not configure Hermes — a deployment without Hermes stays
 * safe and simply does not register the runtime.
 *
 * The secret token, if present, is read here and handed to the transport. It is
 * NEVER logged, returned, or placed on the runtime identity.
 */
export function createHermesRuntimeFromEnv(
  env: HermesEnv = process.env,
  options: HermesRuntimeFactoryOptions = {},
): HermesRuntimeFactoryResult {
  const resolution = resolveHermesConfig(env, options.protocol ?? {});
  if (!resolution.enabled) return { enabled: false, reason: resolution.reason };

  const transportOptions: CreateHermesTransportOptions = {};
  if (options.fetchImpl) transportOptions.fetchImpl = options.fetchImpl;
  if (options.spawnImpl) transportOptions.spawnImpl = options.spawnImpl;
  if (options.webSocketFactory) transportOptions.webSocketFactory = options.webSocketFactory;
  const token = env.HERMES_RUNTIME_TOKEN;
  if (token) transportOptions.token = token;
  // The bridge HMAC secret is read here and handed to the transport; it is
  // never logged, returned, or placed on the runtime identity.
  const bridgeSecret = env.HERMES_RUNTIME_BRIDGE_SECRET;
  if (bridgeSecret) transportOptions.bridgeSecret = bridgeSecret;

  const transport = createHermesTransport(resolution.config, transportOptions);

  const adapterOptions: HermesRuntimeAdapterOptions = { config: resolution.config, transport };
  if (options.eventSink) adapterOptions.eventSink = options.eventSink;
  if (options.now) adapterOptions.now = options.now;
  if (options.ids) adapterOptions.ids = options.ids;
  if (options.capabilities) adapterOptions.capabilities = options.capabilities;

  return { enabled: true, adapter: new HermesRuntimeAdapter(adapterOptions), reason: resolution.reason };
}

/** Convenience: build directly from an explicit config + transport (tests, DI). */
export function createHermesRuntime(
  config: HermesRuntimeConfig,
  options: Omit<HermesRuntimeAdapterOptions, "config">,
): HermesRuntimeAdapter {
  return new HermesRuntimeAdapter({ config, ...options });
}
