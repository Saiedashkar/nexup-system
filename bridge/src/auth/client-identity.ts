import { isIP } from "node:net";

/**
 * Client identity behind the loopback reverse proxy.
 *
 * The bridge binds loopback only, so its TCP peer is always the local proxy and
 * `req.socket.remoteAddress` cannot distinguish callers. A client address has to
 * come from a header — but a header is caller-controlled unless the peer is the
 * proxy that overwrites it. So:
 *
 *   1. the peer must be one of the configured trusted proxy addresses;
 *   2. the value must be a bare IP literal (nothing else: no lists, no ports);
 *   3. otherwise the socket address is used.
 *
 * Step 3 is the important one: an untrusted, missing or malformed value degrades
 * to the peer address, which is a REAL bucket — never a shared "trusted" bucket
 * and never an unbounded one, so a spoofed header cannot mint fresh pre-auth
 * budgets. `deploy/Caddyfile` overwrites the header rather than forwarding it.
 */

/** Header the reverse proxy must OVERWRITE with the client address. */
export const DEFAULT_CLIENT_IP_HEADER = "x-nexup-client-ip";

/** Peers allowed to supply that header: the loopback proxy boundary. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ["127.0.0.1", "::1"];

/** Recorded only when the request carries no socket address at all. */
export const UNKNOWN_CLIENT = "unknown";

export type ClientIdentityInput = {
  headers: Record<string, string | string[] | undefined>;
  socketAddress?: string | undefined;
  /** Addresses whose client-address header is believed. */
  trustedProxies: readonly string[];
  headerName: string;
};

/** A bare IP literal, normalized: brackets stripped, IPv4-mapped form reduced. */
function normalizeIp(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  let candidate = value.trim();
  if (candidate.startsWith("[") && candidate.endsWith("]")) candidate = candidate.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped) candidate = mapped[1] as string;
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

/** Case-insensitive lookup. A repeated header is ambiguous, so it is unusable. */
function singleHeaderValue(headers: ClientIdentityInput["headers"], name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

/**
 * The bucket/audit identity for a request: the proxy-supplied client when the
 * peer is trusted and the value is a usable IP, otherwise the peer address.
 */
export function resolveClientIdentity(input: ClientIdentityInput): string {
  const socket = normalizeIp(input.socketAddress);
  if (!socket) return UNKNOWN_CLIENT;

  const peerIsProxy = input.trustedProxies.some((proxy) => normalizeIp(proxy) === socket);
  if (!peerIsProxy) return socket;

  return normalizeIp(singleHeaderValue(input.headers, input.headerName)) ?? socket;
}
