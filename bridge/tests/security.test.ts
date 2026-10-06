import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BridgeSigner,
  canonicalRequestString,
  computeSignature,
  sha256Hex,
  timingSafeEqualHex,
  verifySignature,
} from "@/modules/workforce/bridge/signing";

import { BridgeError, mapTransportErrorKind, toErrorEnvelope, httpStatusForCode } from "../src/api/errors";
import {
  DEFAULT_CLIENT_IP_HEADER,
  DEFAULT_TRUSTED_PROXIES,
} from "../src/auth/client-identity";
import { NonceStore } from "../src/auth/nonce-store";
import { DEFAULT_AUTH_FAILURE_AUDIT_MAX, PreAuthGuard } from "../src/auth/pre-auth-guard";
import { RateLimiter } from "../src/auth/rate-limit";
import { verifySignedRequest } from "../src/auth/signature";
import { isLoopbackHost, readBridgeSecrets, resolveBridgeConfig } from "../src/config";
import {
  BRIDGE_ALLOWED_HERMES_METHODS,
  BRIDGE_EXCLUDED_HERMES_METHODS,
  assertAllowedHermesMethod,
  isAllowedHermesMethod,
} from "../src/hermes/allowlist";
import { assertNoCallerProfile, assertPinnableProfile } from "../src/hermes/profile-policy";

const SECRET = "0123456789abcdef0123456789abcdef";
const KEY_ID = "nexup-vercel";

const FULL_ENV = {
  NEXUP_BRIDGE_HMAC_SECRET: SECRET,
  NEXUP_BRIDGE_ALLOWED_KEY_IDS: KEY_ID,
  HERMES_SESSION_TOKEN: "hermes-session-token-value",
  HERMES_PROFILE: "saieed",
  HERMES_RPC_URL: "ws://127.0.0.1:9119/api/ws",
};

describe("1. canonical signing", () => {
  it("builds the documented canonical string, hashing the body", () => {
    const parts = { method: "post", path: "/v1/runs", timestamp: "1700", nonce: "abc", body: '{"a":1}' };
    const canonical = canonicalRequestString(parts);
    expect(canonical.split("\n")).toEqual(["POST", "/v1/runs", "1700", "abc", sha256Hex('{"a":1}')]);
  });

  it("matches well-known SHA-256 vectors for the body hash", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("signs exactly HMAC-SHA256(secret, canonical)", () => {
    const parts = { method: "GET", path: "/v1/health", timestamp: "1700", nonce: "n1", body: "" };
    const expected = createHmac("sha256", SECRET).update(canonicalRequestString(parts)).digest("hex");
    expect(computeSignature(SECRET, parts)).toBe(expected);
    expect(verifySignature(SECRET, parts, expected)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret and a malformed signature", () => {
    const parts = { method: "POST", path: "/v1/runs", timestamp: "1700", nonce: "n1", body: '{"a":1}' };
    const signature = computeSignature(SECRET, parts);
    expect(verifySignature(SECRET, { ...parts, body: '{"a":2}' }, signature)).toBe(false);
    expect(verifySignature("a-different-secret-value", parts, signature)).toBe(false);
    expect(verifySignature(SECRET, parts, "not-hex")).toBe(false);
  });

  it("compares in constant time and rejects unequal lengths", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(false);
  });

  it("produces the four signing headers with a fresh nonce", () => {
    let counter = 0;
    const signer = new BridgeSigner({
      keyId: KEY_ID,
      secret: SECRET,
      now: () => new Date(1_700_000_000_000),
      nonceFactory: () => `nonce-${(counter += 1)}`,
    });
    const first = signer.sign({ method: "GET", path: "/v1/health" });
    const second = signer.sign({ method: "GET", path: "/v1/health" });
    expect(Object.keys(first).sort()).toEqual([
      "x-nexup-key-id",
      "x-nexup-nonce",
      "x-nexup-signature",
      "x-nexup-timestamp",
    ]);
    expect(first["x-nexup-key-id"]).toBe(KEY_ID);
    expect(first["x-nexup-timestamp"]).toBe("1700000000");
    expect(first["x-nexup-nonce"]).not.toBe(second["x-nexup-nonce"]);
    expect(verifySignature(SECRET, { method: "GET", path: "/v1/health", timestamp: "1700000000", nonce: "nonce-1", body: "" }, first["x-nexup-signature"])).toBe(true);
  });
});

describe("2. request verification", () => {
  function verify(overrides: Partial<Parameters<typeof verifySignedRequest>[0]> = {}) {
    const nonceStore = new NonceStore({ ttlMs: 300_000 });
    const nowMs = 1_700_000_000_000;
    const parts = { method: "GET", path: "/v1/health", timestamp: String(nowMs / 1000), nonce: "n1", body: "" };
    const signature = computeSignature(SECRET, parts);
    const headers = {
      "x-nexup-key-id": KEY_ID,
      "x-nexup-signature": signature,
      "x-nexup-timestamp": parts.timestamp,
      "x-nexup-nonce": parts.nonce,
    };
    return verifySignedRequest({
      method: "GET",
      path: "/v1/health",
      headers,
      body: "",
      nowMs,
      hmacSecret: SECRET,
      allowedKeyIds: [KEY_ID],
      clockSkewSeconds: 300,
      nonceStore,
      ...overrides,
    });
  }

  it("accepts a correctly signed, fresh request", () => {
    expect(verify()).toEqual({ keyId: KEY_ID });
  });

  it("rejects missing headers, unknown keys, bad signatures and stale timestamps", () => {
    expect(() => verify({ headers: {} })).toThrow(BridgeError);
    expect(() => verify({ allowedKeyIds: ["someone-else"] })).toThrow(/Unknown bridge key id/);
    expect(() => verify({ headers: { ...verifyHeaders(), "x-nexup-signature": "deadbeef" } })).toThrow(
      /signature did not match/,
    );
    expect(() => verify({ nowMs: 1_700_000_000_000 + 3_600_000 })).toThrow(/outside the acceptance window/);
  });

  it("rejects a replayed nonce", () => {
    const nonceStore = new NonceStore({ ttlMs: 300_000 });
    const nowMs = 1_700_000_000_000;
    const parts = { method: "GET", path: "/v1/health", timestamp: String(nowMs / 1000), nonce: "reused", body: "" };
    const headers = {
      "x-nexup-key-id": KEY_ID,
      "x-nexup-signature": computeSignature(SECRET, parts),
      "x-nexup-timestamp": parts.timestamp,
      "x-nexup-nonce": parts.nonce,
    };
    const base = {
      method: "GET",
      path: "/v1/health",
      headers,
      body: "",
      nowMs,
      hmacSecret: SECRET,
      allowedKeyIds: [KEY_ID],
      clockSkewSeconds: 300,
      nonceStore,
    };
    expect(verifySignedRequest(base)).toEqual({ keyId: KEY_ID });
    expect(() => verifySignedRequest(base)).toThrow(/nonce was already used/);
  });

  function verifyHeaders() {
    const nowMs = 1_700_000_000_000;
    const parts = { method: "GET", path: "/v1/health", timestamp: String(nowMs / 1000), nonce: "n1", body: "" };
    return {
      "x-nexup-key-id": KEY_ID,
      "x-nexup-signature": computeSignature(SECRET, parts),
      "x-nexup-timestamp": parts.timestamp,
      "x-nexup-nonce": parts.nonce,
    };
  }
});

describe("3. nonce store", () => {
  it("remembers a nonce once and forgets it after the TTL", () => {
    const store = new NonceStore({ ttlMs: 1000 });
    expect(store.consume(KEY_ID, "a", 0)).toBe(true);
    expect(store.consume(KEY_ID, "a", 10)).toBe(false);
    expect(store.consume(KEY_ID, "b", 10)).toBe(true);
    // After the window, the old nonce is swept and would be accepted again —
    // which is safe because the timestamp window has also closed.
    expect(store.consume(KEY_ID, "a", 2000)).toBe(true);
  });

  it("evicts the oldest entries when capped", () => {
    const store = new NonceStore({ ttlMs: 100_000, maxEntries: 2 });
    store.consume(KEY_ID, "a", 0);
    store.consume(KEY_ID, "b", 1);
    store.consume(KEY_ID, "c", 2);
    expect(store.size).toBe(2);
    expect(store.consume(KEY_ID, "c", 3)).toBe(false);
  });
});

describe("4. rate limiter", () => {
  it("allows a burst then blocks, and refills over time", () => {
    const limiter = new RateLimiter({ limitPerMinute: 60 });
    for (let i = 0; i < 60; i += 1) expect(limiter.check(KEY_ID, 0)).toBe(true);
    expect(limiter.check(KEY_ID, 0)).toBe(false);
    // 1000 ms at 60/min = 1 token back.
    expect(limiter.check(KEY_ID, 1000)).toBe(true);
  });

  it("tracks buckets per key", () => {
    const limiter = new RateLimiter({ limitPerMinute: 1 });
    expect(limiter.check("a", 0)).toBe(true);
    expect(limiter.check("a", 0)).toBe(false);
    expect(limiter.check("b", 0)).toBe(true);
  });
});

describe("5. Hermes method allowlist", () => {
  it("permits the run/health methods and excludes llm.oneshot", () => {
    expect(isAllowedHermesMethod("session.create")).toBe(true);
    expect(isAllowedHermesMethod("prompt.submit")).toBe(true);
    expect(isAllowedHermesMethod("session.interrupt")).toBe(true);
    expect(isAllowedHermesMethod("gateway.ping")).toBe(true);
    expect(isAllowedHermesMethod("llm.oneshot")).toBe(false);
    expect(isAllowedHermesMethod("shell.exec")).toBe(false);
    expect(BRIDGE_EXCLUDED_HERMES_METHODS).toContain("llm.oneshot");
    expect(BRIDGE_ALLOWED_HERMES_METHODS).not.toContain("llm.oneshot");
  });

  it("throws METHOD_NOT_ALLOWED for a disallowed method", () => {
    try {
      assertAllowedHermesMethod("llm.oneshot");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError);
      expect((error as BridgeError).code).toBe("METHOD_NOT_ALLOWED");
    }
  });
});

describe("6. profile policy", () => {
  it("accepts a safe pinned profile and refuses default", () => {
    expect(assertPinnableProfile("saieed")).toBe("saieed");
    expect(() => assertPinnableProfile("default")).toThrow();
    expect(() => assertPinnableProfile("bad profile")).toThrow();
  });

  it("rejects any caller-supplied profile", () => {
    expect(() => assertNoCallerProfile({ instruction: "hi" })).not.toThrow();
    expect(() => assertNoCallerProfile({ profile: "default" })).toThrow(/pins the Hermes profile/);
    expect(() => assertNoCallerProfile({ profile: "saieed" })).toThrow(/pins the Hermes profile/);
  });
});

describe("7. configuration", () => {
  it("fails closed without a secret, a session token, or a safe profile", () => {
    expect(resolveBridgeConfig({}).enabled).toBe(false);
    expect(resolveBridgeConfig({ NEXUP_BRIDGE_HMAC_SECRET: "short" }).enabled).toBe(false);
    expect(resolveBridgeConfig({ ...FULL_ENV, HERMES_SESSION_TOKEN: undefined }).enabled).toBe(false);
    expect(resolveBridgeConfig({ ...FULL_ENV, HERMES_PROFILE: "default" }).enabled).toBe(false);
    expect(resolveBridgeConfig({ ...FULL_ENV, NEXUP_BRIDGE_ENABLED: "false" }).enabled).toBe(false);
  });

  it("refuses a non-loopback Hermes URL", () => {
    const resolution = resolveBridgeConfig({ ...FULL_ENV, HERMES_RPC_URL: "ws://10.0.0.5:9119/api/ws" });
    expect(resolution.enabled).toBe(false);
    if (!resolution.enabled) expect(resolution.reason).toMatch(/loopback/);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
  });

  it("resolves a valid config and never echoes the secret", () => {
    const resolution = resolveBridgeConfig(FULL_ENV);
    expect(resolution.enabled).toBe(true);
    if (!resolution.enabled) return;
    expect(resolution.config.hermes.profile).toBe("saieed");
    expect(resolution.config.hermes.origin).toBe("http://127.0.0.1:9119");
    expect(resolution.config.allowedKeyIds).toEqual([KEY_ID]);
    expect(JSON.stringify(resolution.config)).not.toContain(SECRET);
    expect(resolution.reason).not.toContain(SECRET);
    expect(resolution.config).toMatchObject({ hmacSecretPresent: true });
    expect(resolution.config.hermes.sessionTokenPresent).toBe(true);
  });

  it("trusts only loopback proxies by default, and accepts an explicit boundary", () => {
    const defaults = resolveBridgeConfig(FULL_ENV);
    expect(defaults.enabled).toBe(true);
    if (!defaults.enabled) return;
    expect(defaults.config.trustedProxyAddresses).toEqual([...DEFAULT_TRUSTED_PROXIES]);
    expect(defaults.config.clientIpHeader).toBe(DEFAULT_CLIENT_IP_HEADER);

    const pinned = resolveBridgeConfig({
      ...FULL_ENV,
      NEXUP_BRIDGE_TRUSTED_PROXIES: "10.0.0.9, 10.0.0.10",
      NEXUP_BRIDGE_CLIENT_IP_HEADER: "X-Real-Client-IP",
    });
    expect(pinned.enabled).toBe(true);
    if (!pinned.enabled) return;
    expect(pinned.config.trustedProxyAddresses).toEqual(["10.0.0.9", "10.0.0.10"]);
    expect(pinned.config.clientIpHeader).toBe("X-Real-Client-IP");
  });

  /**
   * The mission pins ONE profile: `saieed`. "default is refused" is not the same
   * statement as "only saieed is addressable" — the real VPS daemon accepted
   * `HERMES_PROFILE=adel`, started listening and served 401s, which is a scope
   * violation the code did not prevent. `adel` is the root of `/opt/data`, i.e.
   * the same place `default` resolves to, so accepting it is the same class of
   * mistake as accepting `default`.
   */
  describe("profile pinning is an allowlist, not just a `default` refusal", () => {
    it("addresses saieed", () => {
      const resolution = resolveBridgeConfig({ ...FULL_ENV, HERMES_PROFILE: "saieed" });
      expect(resolution.enabled).toBe(true);
      if (!resolution.enabled) return;
      expect(resolution.config.hermes.profile).toBe("saieed");
    });

    it("refuses every profile outside the allowlist, including Adel's names", () => {
      for (const profile of ["adel", "creative-director", "Adel", "cleanup-hygiene", "saieed2"]) {
        const resolution = resolveBridgeConfig({ ...FULL_ENV, HERMES_PROFILE: profile });
        expect(resolution.enabled).toBe(false);
        if (!resolution.enabled) expect(resolution.reason).toMatch(/ALLOWED_PROFILES|forbidden/);
      }
    });

    it("trims surrounding whitespace before matching, as the other settings do", () => {
      const padded = resolveBridgeConfig({ ...FULL_ENV, HERMES_PROFILE: "  saieed\t" });
      expect(padded.enabled).toBe(true);
      if (!padded.enabled) return;
      expect(padded.config.hermes.profile).toBe("saieed");
      // ...but a case difference is a different name, not padding.
      expect(resolveBridgeConfig({ ...FULL_ENV, HERMES_PROFILE: "SAIEED" }).enabled).toBe(false);
    });

    it("refuses an explicit allowlist that tries to widen the scope", () => {
      // An operator can name a set, but it may never contain `default`, and the
      // set itself is what is honoured — never a caller-supplied value.
      const widened = resolveBridgeConfig({
        ...FULL_ENV,
        NEXUP_BRIDGE_ALLOWED_PROFILES: "saieed,adel",
        HERMES_PROFILE: "adel",
      });
      expect(widened.enabled).toBe(true);
      if (!widened.enabled) return;
      expect(widened.config.hermes.profile).toBe("adel");

      const withForbidden = resolveBridgeConfig({
        ...FULL_ENV,
        NEXUP_BRIDGE_ALLOWED_PROFILES: "saieed,default",
        HERMES_PROFILE: "saieed",
      });
      expect(withForbidden.enabled).toBe(false);
    });
  });

  it("reads the secrets separately from the config", () => {
    expect(readBridgeSecrets(FULL_ENV)).toEqual({
      hmacSecret: SECRET,
      hermesSessionToken: "hermes-session-token-value",
    });
    expect(readBridgeSecrets({})).toBeNull();
  });

  it("rejects a non-loopback bind address (the bridge is never published directly)", () => {
    for (const host of ["0.0.0.0", "10.0.0.5", "bridge.example"]) {
      const resolution = resolveBridgeConfig({ ...FULL_ENV, NEXUP_BRIDGE_HOST: host });
      expect(resolution.enabled).toBe(false);
      if (!resolution.enabled) expect(resolution.reason).toMatch(/loopback/);
    }
    expect(resolveBridgeConfig({ ...FULL_ENV, NEXUP_BRIDGE_HOST: "127.0.0.1" }).enabled).toBe(true);
  });

  /**
   * Revised C: the bridge is its own container sharing the Hermes network
   * namespace, so inside that namespace it must bind the namespace's private
   * interface (Traefik follows `NetworkMode` to the OWNER's address). That is a
   * non-loopback bind, so the guard above needs exactly one narrow, explicit
   * opt-in — and the opt-in alone is not enough.
   */
  describe("shared-network-namespace bind (revised C)", () => {
    const IN_NETNS = {
      ...FULL_ENV,
      NEXUP_BRIDGE_HOST: "0.0.0.0",
      NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND: "true",
      NEXUP_BRIDGE_TRUSTED_PROXIES: "172.16.0.0/16",
      NEXUP_BRIDGE_CLIENT_IP_HEADER: "x-forwarded-for",
    };

    it("accepts a non-loopback bind only with the explicit opt-in", () => {
      const resolution = resolveBridgeConfig(IN_NETNS);
      expect(resolution.enabled).toBe(true);
      if (!resolution.enabled) return;
      expect(resolution.config.host).toBe("0.0.0.0");
      expect(resolution.config.trustedProxyAddresses).toEqual(["172.16.0.0/16"]);
      expect(resolution.config.clientIpHeader).toBe("x-forwarded-for");
      // Hermes stays loopback-only even here: the transport does not move.
      expect(resolution.config.hermes.rpcUrl).toBe("ws://127.0.0.1:9119/api/ws");
    });

    it("refuses the opt-in when the trusted edge is left at the loopback default", () => {
      // Binding off-loopback while trusting only loopback peers means no peer is
      // ever trusted, so every caller collapses into ONE pre-auth bucket: at
      // 120/min a single client starves the rest. That is a real defect, so the
      // combination is refused rather than silently degraded.
      for (const trusted of [undefined, "", "127.0.0.1,::1", "127.0.0.1"]) {
        const resolution = resolveBridgeConfig({
          ...IN_NETNS,
          ...(trusted === undefined ? { NEXUP_BRIDGE_TRUSTED_PROXIES: undefined } : { NEXUP_BRIDGE_TRUSTED_PROXIES: trusted }),
        });
        expect(resolution.enabled).toBe(false);
        if (!resolution.enabled) expect(resolution.reason).toMatch(/NEXUP_BRIDGE_TRUSTED_PROXIES/);
      }
    });

    it("refuses the opt-in when the client-address header is left implicit", () => {
      // The edge that reaches a shared-namespace bridge is Traefik, which APPENDS
      // to X-Forwarded-For and cannot set the Caddy-style overwrite header at
      // all. Taking the default here would silently attribute every request to
      // the proxy, so the header must be chosen explicitly.
      const resolution = resolveBridgeConfig({ ...IN_NETNS, NEXUP_BRIDGE_CLIENT_IP_HEADER: undefined });
      expect(resolution.enabled).toBe(false);
      if (!resolution.enabled) expect(resolution.reason).toMatch(/NEXUP_BRIDGE_CLIENT_IP_HEADER/);
    });

    it("still refuses a non-loopback bind without the opt-in", () => {
      const resolution = resolveBridgeConfig({ ...IN_NETNS, NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND: "false" });
      expect(resolution.enabled).toBe(false);
      if (!resolution.enabled) expect(resolution.reason).toMatch(/NEXUP_BRIDGE_ALLOW_NON_LOOPBACK_BIND/);
    });

    it("leaves a loopback bind working with no opt-in and no trusted-proxy ceremony", () => {
      const resolution = resolveBridgeConfig(FULL_ENV);
      expect(resolution.enabled).toBe(true);
      if (!resolution.enabled) return;
      expect(resolution.config.host).toBe("127.0.0.1");
      expect(resolution.config.trustedProxyAddresses).toEqual([...DEFAULT_TRUSTED_PROXIES]);
    });
  });
});

describe("8. error model", () => {
  it("maps codes to statuses and retryability, then to the wire envelope", () => {
    expect(httpStatusForCode("SIGNATURE_INVALID")).toBe(401);
    expect(httpStatusForCode("RATE_LIMITED")).toBe(429);
    expect(httpStatusForCode("HERMES_UNAVAILABLE")).toBe(503);
    expect(httpStatusForCode("RUN_NOT_FOUND")).toBe(404);

    const { status, envelope } = toErrorEnvelope(new BridgeError("FORBIDDEN_PROFILE", "no default", "detail"));
    expect(status).toBe(403);
    expect(envelope.error).toEqual({
      code: "FORBIDDEN_PROFILE",
      message: "no default",
      retryable: false,
      detail: "detail",
    });
  });

  it("maps Hermes transport kinds onto bridge codes", () => {
    expect(mapTransportErrorKind("TIMEOUT")).toBe("HERMES_TIMEOUT");
    expect(mapTransportErrorKind("MALFORMED")).toBe("HERMES_PROTOCOL_ERROR");
    expect(mapTransportErrorKind("FORBIDDEN")).toBe("FORBIDDEN_PROFILE");
    expect(mapTransportErrorKind(undefined)).toBe("HERMES_UNAVAILABLE");
  });

  it("wraps a non-BridgeError as INTERNAL", () => {
    const { status, envelope } = toErrorEnvelope(new Error("boom"));
    expect(status).toBe(500);
    expect(envelope.error.code).toBe("INTERNAL");
  });
});

describe("9. pre-auth guard", () => {
  const base = {
    perRemoteLimitPerMinute: 60,
    globalLimitPerMinute: 600,
    ttlMs: 300_000,
    failureAuditMax: DEFAULT_AUTH_FAILURE_AUDIT_MAX,
    failureAuditWindowMs: 60_000,
  };

  it("allows a bounded burst per remote, independently", () => {
    const guard = new PreAuthGuard({ ...base, perRemoteLimitPerMinute: 3 });
    expect(guard.check("a", 0)).toBe(true);
    expect(guard.check("a", 0)).toBe(true);
    expect(guard.check("a", 0)).toBe(true);
    expect(guard.check("a", 0)).toBe(false);
    expect(guard.check("b", 0)).toBe(true);
  });

  it("enforces a global ceiling across remotes", () => {
    const guard = new PreAuthGuard({ ...base, perRemoteLimitPerMinute: 100, globalLimitPerMinute: 2 });
    expect(guard.check("a", 0)).toBe(true);
    expect(guard.check("b", 0)).toBe(true);
    expect(guard.check("c", 0)).toBe(false);
  });

  it("refills over time and keeps its bucket state bounded", () => {
    const guard = new PreAuthGuard({
      ...base,
      perRemoteLimitPerMinute: 1,
      globalLimitPerMinute: 1_000,
      maxBuckets: 1,
    });
    expect(guard.check("a", 0)).toBe(true);
    expect(guard.check("a", 0)).toBe(false);
    expect(guard.check("a", 60_000)).toBe(true); // refilled
    expect(guard.check("b", 60_001)).toBe(true); // evicts the oldest bucket
    expect(guard.check("a", 60_002)).toBe(true); // "a" was evicted → fresh bucket
  });

  it("downsamples repeated auth failures per window", () => {
    const guard = new PreAuthGuard({ ...base });
    const decisions = Array.from({ length: 9 }, () => guard.shouldAuditAuthFailure("a", 0));
    expect(decisions.filter(Boolean)).toHaveLength(DEFAULT_AUTH_FAILURE_AUDIT_MAX);
    expect(guard.shouldAuditAuthFailure("a", 61_000)).toBe(true); // new window
  });
});
