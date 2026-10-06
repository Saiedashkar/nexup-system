import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_IP_HEADER,
  DEFAULT_TRUSTED_PROXIES,
  EDGE_APPENDED_HEADERS,
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
    // edge config and this module — so a rename on either side must fail here.
    // The edge that reaches a shared-namespace bridge is Traefik, whose routing
    // and header policy can only live in the compose labels.
    const compose = await readFile(new URL("../deploy/docker-compose.bridge.yml", import.meta.url), "utf8");
    const labels = compose
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- traefik."));
    // Traefik APPENDS the peer to X-Forwarded-For and cannot set an arbitrary
    // overwrite header, so this deployment reads the appended list — and the
    // module must therefore be told about it by name.
    expect(labels.some((label) => label.includes("forwarded") || label.includes("customRequestHeaders"))).toBe(false);
    expect(DEFAULT_CLIENT_IP_HEADER).toBe("x-nexup-client-ip");
    expect(EDGE_APPENDED_HEADERS).toContain("x-forwarded-for");
  });

  /**
   * Revised C: the client address arrives from Traefik, which APPENDS the peer
   * it saw to `X-Forwarded-For`. That makes a list-valued header usable — but
   * only from the RIGHT: anything a caller puts in the header appears to the
   * LEFT of the real address, so reading the leftmost element (the obvious, and
   * wrong, implementation) hands every attacker a fresh pre-auth bucket.
   */
  describe("edge-appended forwarded list (revised C)", () => {
    const forwarded = (value: string | string[] | undefined, overrides: object = {}): string =>
      resolve({
        trustedProxies: ["172.16.0.0/16"],
        socketAddress: "172.16.0.1",
        headerName: "x-forwarded-for",
        headers: value === undefined ? {} : { "x-forwarded-for": value },
        ...overrides,
      });

    it("takes the RIGHTMOST entry of the list, which is the peer the edge saw", () => {
      expect(forwarded("203.0.113.7, 198.51.100.4")).toBe("198.51.100.4");
      expect(forwarded("203.0.113.7")).toBe("203.0.113.7");
      expect(forwarded("  203.0.113.7 ,, 198.51.100.4 ")).toBe("198.51.100.4");
    });

    it("ignores an attacker-prepended address instead of trusting it", () => {
      // `curl -H 'X-Forwarded-For: 1.2.3.4'` reaches the bridge as
      // "1.2.3.4, <real client>". The leftmost read is the classic bypass; every
      // caller must still land in its own bucket, and this request must land in
      // the REAL one.
      expect(forwarded("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
      expect(forwarded("1.2.3.4, 5.6.7.8, 203.0.113.7")).toBe("203.0.113.7");
      // Padding the list on the left changes nothing: the result is still the
      // entry the edge appended, never an address the caller chose.
      expect(forwarded(",,, 1.2.3.4 ,, 203.0.113.7")).toBe("203.0.113.7");
    });

    it("degrades a list whose usable entry is not a bare IP to the socket address", () => {
      expect(forwarded("203.0.113.7, not-an-ip")).toBe("172.16.0.1");
      expect(forwarded("203.0.113.7, 198.51.100.4:443")).toBe("172.16.0.1");
      expect(forwarded("")).toBe("172.16.0.1");
      expect(forwarded("   ")).toBe("172.16.0.1");
      expect(forwarded(["198.51.100.4", "203.0.113.7"])).toBe("172.16.0.1");
    });

    it("only takes the rightmost entry when the peer is a trusted proxy", () => {
      expect(
        resolve({
          socketAddress: "10.9.9.9",
          trustedProxies: ["172.16.0.0/16"],
          headerName: "x-forwarded-for",
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
        }),
      ).toBe("10.9.9.9");
    });

    it("keeps a list unusable for the overwrite-style header", () => {
      // `X-Nexup-Client-IP` is never appended to by Traefik, so a list in it is
      // caller-supplied noise. Only the headers the edge is known to append to
      // get list semantics.
      expect(EDGE_APPENDED_HEADERS).not.toContain(DEFAULT_CLIENT_IP_HEADER);
      expect(resolve({ headers: { [DEFAULT_CLIENT_IP_HEADER]: "1.2.3.4, 203.0.113.7" } })).toBe("127.0.0.1");
    });
  });

  describe("trusted proxy boundaries as networks", () => {
    const fromPeer = (peer: string, trustedProxies: readonly string[]): string =>
      resolve({
        socketAddress: peer,
        trustedProxies,
        headerName: "x-forwarded-for",
        headers: { "x-forwarded-for": "203.0.113.7" },
      });

    it("trusts a peer inside the configured network", () => {
      // Docker re-creates the network on every recreation (the measured run
      // moved the gateway through 172.16.1.1 and 172.16.2.1), so the boundary is
      // named as a network rather than as one address that would rot.
      expect(fromPeer("172.16.0.1", ["172.16.0.0/16"])).toBe("203.0.113.7");
      expect(fromPeer("172.16.9.254", ["172.16.0.0/16"])).toBe("203.0.113.7");
      expect(fromPeer("fd00::5", ["fd00::/8"])).toBe("203.0.113.7");
    });

    it("refuses a peer outside the network, at the edge of it, and past it", () => {
      expect(fromPeer("172.17.0.1", ["172.16.0.0/16"])).toBe("172.17.0.1");
      expect(fromPeer("172.15.255.255", ["172.16.0.0/16"])).toBe("172.15.255.255");
      expect(fromPeer("192.168.0.1", ["172.16.0.0/16"])).toBe("192.168.0.1");
      // A network of a different family can never contain the peer.
      expect(fromPeer("172.16.0.1", ["fd00::/8"])).toBe("172.16.0.1");
      expect(fromPeer("fd00::5", ["172.16.0.0/16"])).toBe("fd00::5");
    });

    it("never trusts anything on a malformed network, and keeps exact addresses working", () => {
      for (const bad of ["172.16.0.0/40", "172.16.0.0/-1", "172.16.0.0/", "172.16.0.0/16/16", "not-a-network/16", "/16"]) {
        expect(fromPeer("172.16.0.1", [bad])).toBe("172.16.0.1");
      }
      // A /32 is a single address, and an exact address stays supported.
      expect(fromPeer("172.16.0.1", ["172.16.0.1/32"])).toBe("203.0.113.7");
      expect(fromPeer("172.16.0.1", ["172.16.0.1"])).toBe("203.0.113.7");
    });
  });
});
