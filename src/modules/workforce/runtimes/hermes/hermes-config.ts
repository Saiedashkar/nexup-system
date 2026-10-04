import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";

import {
  resolveHermesProtocol,
  type HermesProtocolConfig,
  type HermesProtocolOverrides,
} from "./hermes-protocol";

/**
 * Hermes adapter configuration.
 *
 * Provider-neutral rule: NOTHING here is part of the core contracts. Every
 * Hermes-specific knob lives in this file, is read from the environment, and is
 * validated before it can reach a transport. Credentials are NEVER stored in
 * source and never returned by this module — only their PRESENCE is reported.
 *
 * The adapter targets exactly ONE profile (`saieed`). Other profiles are never
 * addressed, never enumerated and never modified by this code.
 */

/** Provider-neutral runtime type string the core sees (no "hermes" in the type). */
export const HERMES_RUNTIME_TYPE = "EXTERNAL_AGENT_RUNTIME";
export const DEFAULT_HERMES_RUNTIME_ID = "runtime_hermes_saeed";
export const DEFAULT_HERMES_DISPLAY_NAME = "Hermes Agent Runtime";
export const DEFAULT_HERMES_TIMEOUT_MS = 120_000;
export const DEFAULT_HERMES_MAX_OUTPUT_BYTES = 262_144;

/**
 * `RPC` is the PRIMARY transport: the VERIFIED Hermes WebSocket JSON-RPC 2.0
 * contract on `/api/ws`. `CLI_ONESHOT` is a VERIFIED fallback/diagnostic.
 * `HTTP` and `CLI` are PROVISIONAL, quarantined scaffolding — never defaults.
 */
export type HermesTransportKind = "RPC" | "HTTP" | "CLI" | "CLI_ONESHOT";

/** The transport used when `HERMES_RUNTIME_TRANSPORT` is not set. */
export const DEFAULT_HERMES_TRANSPORT: HermesTransportKind = "RPC";

/**
 * The profile this adapter addresses for NEXUP Phase 2B. The adapter NEVER
 * falls back to `default` (see `HERMES_FORBIDDEN_PROFILES`).
 */
export const NEXUP_HERMES_PROFILE = "saieed";

export type HermesRuntimeCapabilities = {
  submit: boolean;
  status: boolean;
  cancel: boolean;
  resume: boolean;
  health: boolean;
};

export type HermesRuntimeConfig = {
  runtimeId: string;
  displayName: string;
  transport: HermesTransportKind;
  /** The single operational profile this adapter may address. */
  profile: string;
  /** HTTP base URL (transport = HTTP; PROVISIONAL/quarantined). */
  endpoint?: string;
  /**
   * WebSocket JSON-RPC endpoint URL (transport = RPC). VERIFIED primary
   * transport. Fully configurable so a future NEXUP bridge on the VPS can
   * expose the Hermes contract without changing the adapter.
   */
  rpcEndpoint?: string;
  /** Executable path (transport = CLI / CLI_ONESHOT). */
  executablePath?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  capabilities: HermesRuntimeCapabilities;
  /** Reported, never returned: whether an auth token was provided via env. */
  authTokenPresent: boolean;
  authHeaderName: string;
  authScheme: string;
  /**
   * Adapter-owned, EXPLICITLY PROVISIONAL transport protocol (assumed HTTP
   * paths / CLI subcommands). Optional: transports fall back to their own
   * provisional defaults when absent. Never part of a generic core contract.
   * The real Hermes transport contract is UNVERIFIED.
   */
  protocol?: HermesProtocolConfig;
};

export type HermesConfigResolution =
  | { enabled: true; config: HermesRuntimeConfig; reason: string }
  | { enabled: false; reason: string };

export type HermesEnv = Record<string, string | undefined>;

/* ═══════════════════════════════════════════════════════
   Profile safety
   ═══════════════════════════════════════════════════════

   A profile reference is an OPAGUE IDENTIFIER, never something that could be
   interpolated into a shell or a path. We accept a conservative slug and
   reject everything else — whitespace, separators, quotes, globs, traversal,
   and any shell metacharacter. */

const SAFE_PROFILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Profiles this adapter must NEVER address or fall back to. `default` is the
 * Hermes launch profile — using it would escape NEXUP's scoped runtime.
 */
export const HERMES_FORBIDDEN_PROFILES: readonly string[] = ["default"];

export function isSafeProfile(profile: string): boolean {
  return typeof profile === "string" && SAFE_PROFILE_PATTERN.test(profile);
}

/** True when the profile is one this adapter refuses on principle. */
export function isForbiddenProfile(profile: string): boolean {
  return typeof profile === "string" && HERMES_FORBIDDEN_PROFILES.includes(profile.trim().toLowerCase());
}

/**
 * The single guard every caller uses before addressing a profile: it must be a
 * safe slug AND not a forbidden profile (`default`).
 *
 * @throws RUNTIME_UNSUPPORTED when the profile is unsafe or forbidden.
 * @returns the profile unchanged when addressable.
 */
export function assertAddressableProfile(profile: string): string {
  if (isForbiddenProfile(profile)) {
    throw new AiWorkforceError(
      "RUNTIME_UNSUPPORTED",
      'Hermes profile "default" is forbidden — NEXUP must address its own scoped profile',
      { reason: "FORBIDDEN_PROFILE", profile },
    );
  }
  return assertSafeProfile(profile);
}

/**
 * @throws RUNTIME_UNSUPPORTED when the profile reference is not a safe slug.
 * @returns the profile unchanged when safe.
 */
export function assertSafeProfile(profile: string): string {
  if (!isSafeProfile(profile)) {
    throw new AiWorkforceError(
      "RUNTIME_UNSUPPORTED",
      "Hermes profile reference is not a safe slug (expected ^[a-z0-9][a-z0-9_-]{0,63}$)",
      { reason: "UNSAFE_PROFILE_REFERENCE" },
    );
  }
  return profile;
}

/* ═══════════════════════════════════════════════════════
   Environment resolution
   ═══════════════════════════════════════════════════════ */

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a configured RPC endpoint to a `ws(s)://` URL. Accepts `ws://`,
 * `wss://`, and `http(s)://` (mapped to the matching ws scheme) so operators can
 * point the adapter at either form a bridge might expose.
 */
export function toWebSocketEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  return url.toString();
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

/**
 * Resolves config from the environment. Returns a DISABLED resolution (with a
 * human-readable reason) when anything required is absent — it never throws for
 * a merely missing setting, so a deployment without Hermes configured stays
 * safe and the adapter simply is not registered.
 */
export function resolveHermesConfig(
  env: HermesEnv = process.env,
  protocolOverrides: HermesProtocolOverrides = {},
): HermesConfigResolution {
  if (!readBool(env.HERMES_RUNTIME_ENABLED, true)) {
    return { enabled: false, reason: "HERMES_RUNTIME_ENABLED is false" };
  }

  const profile = env.HERMES_RUNTIME_PROFILE?.trim();
  if (!profile) {
    return { enabled: false, reason: "HERMES_RUNTIME_PROFILE is not set" };
  }
  if (isForbiddenProfile(profile)) {
    return { enabled: false, reason: `HERMES_RUNTIME_PROFILE "${profile}" is forbidden (never use the default profile)` };
  }
  if (!isSafeProfile(profile)) {
    return { enabled: false, reason: "HERMES_RUNTIME_PROFILE is not a safe slug" };
  }

  const transport = ((env.HERMES_RUNTIME_TRANSPORT?.trim().toUpperCase() as HermesTransportKind | undefined) ??
    DEFAULT_HERMES_TRANSPORT) as HermesTransportKind;
  if (transport !== "RPC" && transport !== "HTTP" && transport !== "CLI" && transport !== "CLI_ONESHOT") {
    return {
      enabled: false,
      reason: `Unsupported HERMES_RUNTIME_TRANSPORT "${transport}" (expected RPC, CLI_ONESHOT, HTTP or CLI)`,
    };
  }

  const endpoint = env.HERMES_RUNTIME_ENDPOINT?.trim();
  const executablePath = env.HERMES_RUNTIME_EXECUTABLE?.trim();
  // RPC endpoint: dedicated var first, then the generic endpoint var.
  const rpcEndpointRaw = env.HERMES_RUNTIME_RPC_URL?.trim() || env.HERMES_RUNTIME_ENDPOINT?.trim();

  if (transport === "RPC") {
    if (!rpcEndpointRaw) return { enabled: false, reason: "HERMES_RUNTIME_RPC_URL is required for the RPC transport" };
    if (!isWebSocketUrl(rpcEndpointRaw) && !isHttpUrl(rpcEndpointRaw)) {
      return { enabled: false, reason: "HERMES_RUNTIME_RPC_URL must be a ws(s):// or http(s):// URL" };
    }
  }
  if (transport === "HTTP") {
    if (!endpoint) return { enabled: false, reason: "HERMES_RUNTIME_ENDPOINT is required for the HTTP transport" };
    if (!isHttpUrl(endpoint)) return { enabled: false, reason: "HERMES_RUNTIME_ENDPOINT must be an http(s) URL" };
  }
  if ((transport === "CLI" || transport === "CLI_ONESHOT") && !executablePath) {
    return { enabled: false, reason: "HERMES_RUNTIME_EXECUTABLE is required for the CLI transports" };
  }

  const config: HermesRuntimeConfig = {
    runtimeId: env.HERMES_RUNTIME_ID?.trim() || DEFAULT_HERMES_RUNTIME_ID,
    displayName: env.HERMES_RUNTIME_DISPLAY_NAME?.trim() || DEFAULT_HERMES_DISPLAY_NAME,
    transport,
    profile,
    timeoutMs: parsePositiveInt(env.HERMES_RUNTIME_TIMEOUT_MS, DEFAULT_HERMES_TIMEOUT_MS),
    maxOutputBytes: parsePositiveInt(env.HERMES_RUNTIME_MAX_OUTPUT_BYTES, DEFAULT_HERMES_MAX_OUTPUT_BYTES),
    capabilities: {
      // Every transport can submit. A synchronous one-shot run exposes NO
      // status/health surface, so those are never claimed for it.
      submit: true,
      status: transport !== "CLI_ONESHOT",
      health: transport !== "CLI_ONESHOT",
      // Cancellation: RPC maps to the VERIFIED `session.interrupt`; the other
      // transports only claim it when the environment says so. Never one-shot.
      cancel:
        transport === "RPC"
          ? true
          : transport === "CLI_ONESHOT"
            ? false
            : readBool(env.HERMES_RUNTIME_SUPPORTS_CANCEL, false),
      // Resume is never claimed for RPC (no verified resume method) or one-shot.
      resume:
        transport === "RPC" || transport === "CLI_ONESHOT"
          ? false
          : readBool(env.HERMES_RUNTIME_SUPPORTS_RESUME, false),
    },
    // Never the token itself — only whether it exists.
    authTokenPresent: Boolean(env.HERMES_RUNTIME_TOKEN),
    authHeaderName: env.HERMES_RUNTIME_AUTH_HEADER?.trim() || "Authorization",
    authScheme: env.HERMES_RUNTIME_AUTH_SCHEME?.trim() || "Bearer",
    // adapter-owned: RPC (verified) + quarantined HTTP/CLI + fallback one-shot.
    protocol: resolveHermesProtocol(protocolOverrides).protocol,
  };
  if (transport === "RPC" && rpcEndpointRaw) config.rpcEndpoint = toWebSocketEndpoint(rpcEndpointRaw);
  if (transport === "HTTP" && endpoint) config.endpoint = endpoint;
  if ((transport === "CLI" || transport === "CLI_ONESHOT") && executablePath) config.executablePath = executablePath;

  return { enabled: true, config, reason: `Hermes runtime configured for profile "${profile}" via ${transport}` };
}
