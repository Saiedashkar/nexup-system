import { assertAddressableProfile, toWebSocketEndpoint } from "@/modules/workforce/runtimes/hermes/hermes-config";

import { DEFAULT_CLIENT_IP_HEADER, DEFAULT_TRUSTED_PROXIES } from "./auth/client-identity";

/**
 * Bridge configuration.
 *
 * Resolved ONCE at startup from the environment and never mutated. The resolver
 * FAILS CLOSED: a missing secret, a missing Hermes session token, a forbidden
 * profile or a non-loopback Hermes URL all produce `{ enabled: false, reason }`
 * rather than a half-configured server. Like the app's Hermes config, it never
 * throws for a merely missing setting and never returns a secret in `reason`.
 */

export type BridgeEnv = Record<string, string | undefined>;

export type BridgeHermesConfig = {
  /** WebSocket JSON-RPC URL, always loopback. */
  rpcUrl: string;
  /** Reported, never returned: whether a Hermes session token was provided. */
  sessionTokenPresent: boolean;
  /** Host/Origin guard value Hermes expects (e.g. `http://127.0.0.1:9119`). */
  origin: string;
  /** The single pinned profile. Never read from a caller. */
  profile: string;
};

export type BridgeConfig = {
  host: string;
  port: number;
  /** Reported, never returned: whether an HMAC secret was provided. */
  hmacSecretPresent: boolean;
  /** Key ids the bridge will accept. Multiple ids allow rotation. */
  allowedKeyIds: readonly string[];
  hermes: BridgeHermesConfig;
  timeoutMs: number;
  maxOutputBytes: number;
  maxConcurrency: number;
  rateLimitPerMinute: number;
  /** Pre-auth limit per remote address, per minute. */
  preAuthPerRemotePerMinute: number;
  /** Pre-auth limit across all remote addresses, per minute. */
  preAuthGlobalPerMinute: number;
  /** Max accepted |now - timestamp| for a signed request. */
  clockSkewSeconds: number;
  maxBodyBytes: number;
  /** TCP peers whose client-address header is believed (the proxy boundary). */
  trustedProxyAddresses: readonly string[];
  /** Header the trusted proxy overwrites with the client address. */
  clientIpHeader: string;
};

export type BridgeConfigResolution =
  | { enabled: true; config: BridgeConfig; reason: string }
  | { enabled: false; reason: string };

export const BRIDGE_DEFAULTS = {
  host: "127.0.0.1",
  port: 9220,
  hermesRpcUrl: "ws://127.0.0.1:9119/api/ws",
  hermesProfile: "saieed",
  timeoutMs: 120_000,
  maxOutputBytes: 262_144,
  maxConcurrency: 4,
  rateLimitPerMinute: 60,
  // Pre-authentication limits, applied BEFORE signature verification so an
  // unauthenticated flood is bounded and cannot amplify the audit log.
  preAuthPerRemotePerMinute: 120,
  preAuthGlobalPerMinute: 600,
  clockSkewSeconds: 300,
  maxBodyBytes: 256 * 1024,
  keyId: "nexup-vercel",
  // Behind the loopback proxy every request shares one TCP peer, so the client
  // address only has a trustworthy source once the peer is the proxy itself.
  trustedProxyAddresses: DEFAULT_TRUSTED_PROXIES,
  clientIpHeader: DEFAULT_CLIENT_IP_HEADER,
} as const;

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readCsv(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value) return [...fallback];
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [...fallback];
}

/**
 * Loopback-only guard. Hermes must never be reachable except through this
 * bridge, so a non-loopback Hermes URL is a hard configuration error rather
 * than a warning.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "0:0:0:0:0:0:0:1";
}

function isWebSocketOrHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:" || url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveBridgeConfig(env: BridgeEnv = process.env): BridgeConfigResolution {
  if (!readBool(env.NEXUP_BRIDGE_ENABLED, true)) {
    return { enabled: false, reason: "NEXUP_BRIDGE_ENABLED is false" };
  }

  const hmacSecret = env.NEXUP_BRIDGE_HMAC_SECRET?.trim();
  if (!hmacSecret) return { enabled: false, reason: "NEXUP_BRIDGE_HMAC_SECRET is not set" };
  if (hmacSecret.length < 16) {
    return { enabled: false, reason: "NEXUP_BRIDGE_HMAC_SECRET is too short (min 16 chars)" };
  }

  const allowedKeyIds = readCsv(env.NEXUP_BRIDGE_ALLOWED_KEY_IDS, [BRIDGE_DEFAULTS.keyId]);
  if (allowedKeyIds.length === 0) return { enabled: false, reason: "NEXUP_BRIDGE_ALLOWED_KEY_IDS is empty" };

  const rawRpcUrl = env.HERMES_RPC_URL?.trim() || BRIDGE_DEFAULTS.hermesRpcUrl;
  if (!isWebSocketOrHttpUrl(rawRpcUrl)) {
    return { enabled: false, reason: "HERMES_RPC_URL must be a ws(s):// or http(s):// URL" };
  }
  const rpcUrl = toWebSocketEndpoint(rawRpcUrl);
  const parsed = new URL(rpcUrl);
  if (!isLoopbackHost(parsed.hostname)) {
    return {
      enabled: false,
      reason: `HERMES_RPC_URL must point at loopback (Hermes must stay non-public); got host "${parsed.hostname}"`,
    };
  }

  const sessionToken = env.HERMES_SESSION_TOKEN?.trim();
  if (!sessionToken) {
    return { enabled: false, reason: "HERMES_SESSION_TOKEN is not set (set HERMES_DASHBOARD_SESSION_TOKEN on Hermes first)" };
  }

  // Default origin from the RPC URL's scheme/host, so it matches what Hermes
  // itself would compute.
  const originScheme = parsed.protocol === "wss:" ? "https:" : "http:";
  const origin = env.HERMES_ORIGIN?.trim() || `${originScheme}//${parsed.host}`;

  const rawProfile = env.HERMES_PROFILE?.trim() || env.NEXUP_HERMES_PROFILE?.trim() || BRIDGE_DEFAULTS.hermesProfile;
  let profile: string;
  try {
    profile = assertAddressableProfile(rawProfile);
  } catch {
    return { enabled: false, reason: `HERMES_PROFILE "${rawProfile}" is unsafe or forbidden (default is never addressable)` };
  }

  // The bridge must never be published directly: a non-loopback bind address
  // would bypass TLS and the reverse proxy, so it is a hard configuration
  // error. There is deliberately no override in this phase.
  const host = env.NEXUP_BRIDGE_HOST?.trim() || BRIDGE_DEFAULTS.host;
  if (!isLoopbackHost(host)) {
    return {
      enabled: false,
      reason: `NEXUP_BRIDGE_HOST must be loopback (the bridge is not published directly); got "${host}"`,
    };
  }

  const config: BridgeConfig = {
    host,
    port: readPositiveInt(env.NEXUP_BRIDGE_PORT, BRIDGE_DEFAULTS.port),
    hmacSecretPresent: true,
    allowedKeyIds,
    hermes: { rpcUrl, sessionTokenPresent: true, origin, profile },
    timeoutMs: readPositiveInt(env.NEXUP_BRIDGE_TIMEOUT_MS, BRIDGE_DEFAULTS.timeoutMs),
    maxOutputBytes: readPositiveInt(env.NEXUP_BRIDGE_MAX_OUTPUT_BYTES, BRIDGE_DEFAULTS.maxOutputBytes),
    maxConcurrency: readPositiveInt(env.NEXUP_BRIDGE_MAX_CONCURRENCY, BRIDGE_DEFAULTS.maxConcurrency),
    rateLimitPerMinute: readPositiveInt(env.NEXUP_BRIDGE_RATE_LIMIT_PER_MINUTE, BRIDGE_DEFAULTS.rateLimitPerMinute),
    preAuthPerRemotePerMinute: readPositiveInt(
      env.NEXUP_BRIDGE_PREAUTH_PER_REMOTE_PER_MINUTE,
      BRIDGE_DEFAULTS.preAuthPerRemotePerMinute,
    ),
    preAuthGlobalPerMinute: readPositiveInt(env.NEXUP_BRIDGE_PREAUTH_GLOBAL_PER_MINUTE, BRIDGE_DEFAULTS.preAuthGlobalPerMinute),
    clockSkewSeconds: readPositiveInt(env.NEXUP_BRIDGE_CLOCK_SKEW_SECONDS, BRIDGE_DEFAULTS.clockSkewSeconds),
    maxBodyBytes: readPositiveInt(env.NEXUP_BRIDGE_MAX_BODY_BYTES, BRIDGE_DEFAULTS.maxBodyBytes),
    trustedProxyAddresses: readCsv(env.NEXUP_BRIDGE_TRUSTED_PROXIES, DEFAULT_TRUSTED_PROXIES),
    clientIpHeader: env.NEXUP_BRIDGE_CLIENT_IP_HEADER?.trim() || BRIDGE_DEFAULTS.clientIpHeader,
  };

  return {
    enabled: true,
    config,
    reason: `Bridge configured for Hermes profile "${profile}" at ${rpcUrl}`,
  };
}

/**
 * Reads the two secrets the bridge holds in memory, SEPARATELY from the config.
 *
 * Following the app's Hermes convention, `resolveBridgeConfig` reports only the
 * PRESENCE of a secret so a config object can be logged or serialized safely.
 * The values themselves are read here, at startup, and held by the server —
 * never placed on a config that could be echoed.
 */
export function readBridgeSecrets(
  env: BridgeEnv = process.env,
): { hmacSecret: string; hermesSessionToken: string } | null {
  const hmacSecret = env.NEXUP_BRIDGE_HMAC_SECRET?.trim();
  const hermesSessionToken = env.HERMES_SESSION_TOKEN?.trim();
  if (!hmacSecret || !hermesSessionToken) return null;
  return { hmacSecret, hermesSessionToken };
}
