import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The review session must be a REAL session, minted for an UNPRIVILEGED user,
 * and it must stay claim-compatible with `createSessionToken`.
 *
 * `scripts/exec-review-session.mjs` cannot import the app module directly (it
 * runs in plain Node, and `@/lib/auth` pulls `next/headers`), so it mirrors the
 * claims with `jose`. This file is what keeps that mirror honest: the canonical
 * verifier accepts the minted token, and the payload matches the canonical
 * signer's payload claim for claim.
 */

// Only the cookie reader is stubbed: nothing here is inside a request scope.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { createSessionToken, verifySessionToken } from "@/lib/auth";
import {
  REVIEW_SESSION,
  buildCookieJar,
  buildReviewSessionToken,
} from "../scripts/exec-review-session.mjs";

const SECRET = "exec-review-session-test-secret-at-least-32-chars";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("review session — real token, no privileges, no database", () => {
  it("is accepted by the canonical verifier as an unprivileged EMPLOYEE", async () => {
    const token = await buildReviewSessionToken({ secret: SECRET });
    const session = await verifySessionToken(token);

    expect(session).not.toBeNull();
    expect(session?.role).toBe("EMPLOYEE");
    expect(session?.userId).toBe(REVIEW_SESSION.userId);
    expect(session?.businessId).toBe(REVIEW_SESSION.businessId);
    expect(session?.canAccessNexup).toBe(false);
    expect(session?.canAccessRebound).toBe(false);
    expect(session?.canAccessAbomazen).toBe(false);
    expect(session?.canAccessOfficeFinanceFull).toBe(false);
  });

  it("matches createSessionToken claim for claim", async () => {
    const minted = await buildReviewSessionToken({ secret: SECRET });
    const canonical = await createSessionToken(
      REVIEW_SESSION as unknown as Parameters<typeof createSessionToken>[0],
    );

    // Time-bound claims are compared separately; everything else must match.
    const strip = (payload: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "iat" && key !== "exp"));

    expect(strip(decodeJwt(minted))).toEqual(strip(decodeJwt(canonical)));
    expect(decodeJwt(minted).exp! - decodeJwt(minted).iat!).toBe(
      decodeJwt(canonical).exp! - decodeJwt(canonical).iat!,
    );
  });

  it("refuses a missing or too-short secret instead of signing weakly", async () => {
    await expect(buildReviewSessionToken({ secret: "" })).rejects.toThrow(/AUTH_SECRET/);
    await expect(buildReviewSessionToken({ secret: "short" })).rejects.toThrow(/AUTH_SECRET/);
  });

  it("writes a Netscape cookie jar that curl can use, without exposing the token in the summary", async () => {
    const token = await buildReviewSessionToken({ secret: SECRET });
    const jar = buildCookieJar(token, { host: "localhost", expiresAtUnix: 1_800_000_000 });

    expect(jar).toContain("# Netscape HTTP Cookie File");
    expect(jar).toContain("\tnexup_session\t");
    expect(jar.startsWith("# Netscape HTTP Cookie File")).toBe(true);
    const line = jar.split("\n").find((entry) => entry.startsWith("#HttpOnly_"));
    expect(line).toBeDefined();
    expect(line!.split("\t")).toHaveLength(7);
    expect(line!.split("\t")[0]).toBe("#HttpOnly_localhost");
    expect(line!.split("\t")[5]).toBe("nexup_session");
  });
});
