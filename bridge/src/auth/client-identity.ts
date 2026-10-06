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
 * budgets. The edge must overwrite the header rather than forwarding it.
 *
 * Two edges have to be supported, because they are not the same shape:
 *
 *   - A Caddy-style edge can OVERWRITE an arbitrary header, so the value is one
 *     bare IP and only one value is usable.
 *   - Traefik cannot set an arbitrary header to the peer address, but it does
 *     APPEND the peer it saw to `X-Forwarded-For`. That list is usable ONLY from
 *     the right: a caller controls everything to the left of the address the edge
 *     appended, so reading the first element (the obvious implementation) lets
 *     any caller mint themselves a fresh pre-auth bucket per request. Only the
 *     headers in `EDGE_APPENDED_HEADERS` get list semantics; for every other
 *     header a list stays unusable, exactly as before.
 *
 * A trusted proxy may be named as a single address or as a NETWORK in CIDR form.
 * The network form exists because the peer address is the container-network
 * gateway, and Docker re-creates that network (and renumbers it) whenever the
 * container is recreated — which is precisely when this bridge is re-parented.
 */

/** Header the reverse proxy must OVERWRITE with the client address. */
export const DEFAULT_CLIENT_IP_HEADER = "x-nexup-client-ip";

/** Peers allowed to supply that header: the loopback proxy boundary. */
export const DEFAULT_TRUSTED_PROXIES: readonly string[] = ["127.0.0.1", "::1"];

/**
 * Headers the edge ADDS the peer address to rather than replacing. For these a
 * comma-separated list is expected and the LAST entry is the edge-observed peer.
 */
export const EDGE_APPENDED_HEADERS: readonly string[] = ["x-forwarded-for"];

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

/** Address bytes for an already-normalized literal, or null when it is not one. */
function addressBytes(literal: string): number[] | null {
  const normalized = normalizeIp(literal);
  if (!normalized) return null;
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts.length === 4 && parts.every((part) => Number.isInteger(part)) ? parts : null;
  }

  const [head, tail] = normalized.includes("::") ? normalized.split("::") : [normalized, null];
  const headGroups = head ? head.split(":").filter(Boolean) : [];
  const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
  if (tail === null && headGroups.length !== 8) return null;
  const fill = 8 - headGroups.length - tailGroups.length;
  if (fill < 0 || (tail !== null && fill === 0)) return null;
  const groups = tail === null ? headGroups : [...headGroups, ...Array<string>(fill).fill("0"), ...tailGroups];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

/**
 * Is `peer` inside `pattern`, where the pattern is one address or a CIDR
 * network? A malformed pattern matches NOTHING — the fail-closed direction.
 */
function withinTrustedProxy(peer: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const slash = trimmed.indexOf("/");
  if (slash < 0) return normalizeIp(trimmed) === peer;

  // Digits or nothing: `Number("")` is 0, so rejecting only non-numerics would
  // read a bare "172.16.0.0/" as /0 — "trust the whole internet".
  const prefixText = trimmed.slice(slash + 1).trim();
  if (!/^\d{1,3}$/.test(prefixText)) return false;
  const prefix = Number(prefixText);
  const network = addressBytes(trimmed.slice(0, slash));
  const address = addressBytes(peer);
  if (!Number.isInteger(prefix) || !network || !address || network.length !== address.length) return false;
  if (prefix < 0 || prefix > address.length * 8) return false;

  const whole = Math.floor(prefix / 8);
  for (let index = 0; index < whole; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  const remainder = prefix % 8;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((address[whole] as number) & mask) === ((network[whole] as number) & mask);
}

/**
 * The address a list-valued, edge-appended header ends with: the element the
 * edge itself added. Everything before it is caller-supplied.
 */
function rightmostEntry(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
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

  const peerIsProxy = input.trustedProxies.some((pattern) => withinTrustedProxy(socket, pattern));
  if (!peerIsProxy) return socket;

  const raw = singleHeaderValue(input.headers, input.headerName);
  const candidate = EDGE_APPENDED_HEADERS.includes(input.headerName.trim().toLowerCase())
    ? rightmostEntry(raw)
    : raw;
  return normalizeIp(candidate) ?? socket;
}
