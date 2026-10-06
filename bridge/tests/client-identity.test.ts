import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_IP_HEADER,
  DEFAULT_TRUSTED_PROXIES,
  resolveClientIdentity,
} from "../src/auth/client-identity";

/**
 * Client attribution behind the loopback reverse proxy.
 *
 * The bridge only ever sees the proxy as its TCP peer, so a client address must
 * come from a header — but ONLY when the peer is the known proxy and the value is
 * a plain IP. Everything else degrades to the socket address, never to a shared
 * "trusted" bucket and never to an unlimited one.
 */

const resolve = (overrides: Partial<Parameters<typeof resolveClientIdentity>[0]> = {}) =>
  resolveClientIdentity({
    headers: {},
    socketAddress: "127.0.0.1",
    trustedProxies: DEFAULT_TRUSTED_PROXIES,
    headerName: DEFAULT_CLIENT_IP_HEADER,
    ...overrides,
  });

describe("client identity", () => {
  it("attributes the proxy-supplied client when the peer is the trusted proxy", () => {
    expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" } })).toBe("203.0.113.7");
  });

  it("keeps the socket address when the trusted proxy sends no header", () => {
    expect(resolve()).toBe("127.0.0.1");
  });

  it("ignores a forwarded identity from a peer that is not the trusted proxy", () => {
    const identity = resolve({
      socketAddress: "10.0.0.9",
      headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" },
    });
    expect(identity).toBe("10.0.0.9");
  });

  it("degrades a malformed or empty value to the socket address", () => {
    for (const value of [
      "",
      "   ",
      "not-an-ip",
      "203.0.113.7, 198.51.100.4",
      "203.0.113.7:443",
      "999.1.1.1",
      "x".repeat(300),
      "127.0.0.1 ",
    ]) {
      expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: value } })).toBe("127.0.0.1");
    }
  });

  it("treats a repeated header as unusable rather than picking one", () => {
    expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: ["198.51.100.4", "203.0.113.7"] } })).toBe("127.0.0.1");
  });

  it("finds the header case-insensitively and trims the value", () => {
    expect(resolve({ headers: { "X-Nexup-Client-IP": "  198.51.100.4  " } })).toBe("198.51.100.4");
  });

  it("normalizes a bracketed IPv6 literal and IPv6 case to one bucket", () => {
    expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: "[2001:db8::1]" } })).toBe("2001:db8::1");
    expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: "2001:DB8::1" } })).toBe("2001:db8::1");
    expect(resolve({ socketAddress: "[::1]" })).toBe("::1");
  });

  it("handles IPv6 clients and IPv4-mapped peers", () => {
    expect(resolve({ socketAddress: "::1", headers: { [DEFAULT_CLIENT_IP_HEADER]: "2001:db8::1" } })).toBe("2001:db8::1");
    expect(resolve({ socketAddress: "::ffff:127.0.0.1", headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" } })).toBe(
      "203.0.113.7",
    );
    expect(resolve({ socketAddress: "::ffff:10.0.0.9", headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" } })).toBe(
      "10.0.0.9",
    );
  });

  it("reports 'unknown' only when there is no socket address at all", () => {
    expect(resolve({ socketAddress: undefined })).toBe("unknown");
    expect(resolve({ socketAddress: undefined, headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" } })).toBe("unknown");
    expect(resolve({ socketAddress: "" })).toBe("unknown");
  });

  it("honours an explicitly configured proxy address", () => {
    expect(
      resolve({
        socketAddress: "10.0.0.9",
        trustedProxies: ["10.0.0.9"],
        headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" },
      }),
    ).toBe("203.0.113.7");
  });

  it("ignores the header entirely when no proxy is trusted", () => {
    expect(
      resolve({ trustedProxies: [], headers: { [DEFAULT_CLIENT_IP_HEADER]: "203.0.113.7" } }),
    ).toBe("127.0.0.1");
  });

  it("overwrites exactly the header this module trusts, with the real client address", async () => {
    // The two halves of the trust boundary live in different artifacts — the
    // proxy config and this module — so a rename on either side must fail here.
    const caddyfile = await readFile(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
    const directive = caddyfile
      .split("\n")
      .find((line) => line.trim().startsWith("header_up"))
      ?.trim();
    expect(directive).toBeDefined();
    const [, field, value] = directive!.split(/\s+/);
    expect(field.toLowerCase()).toBe(DEFAULT_CLIENT_IP_HEADER);
    // `header_up` sets (overwrites) rather than appends, and the placeholder is
    // the host part of the peer address — a bare IP, which is what this module
    // accepts. Anything else would degrade to the socket address.
    expect(value).toBe("{http.request.remote.host}");
  });
});
