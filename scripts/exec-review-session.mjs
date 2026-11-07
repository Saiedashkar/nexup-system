#!/usr/bin/env node
/**
 * Review-only EXEC session mint — local, non-privileged, no database.
 *
 * WHY THIS EXISTS
 * The EXEC turn route needs a real signed session cookie, and the review
 * environment must not depend on `/api/auth/login` (which needs the legacy
 * database), on a seed, or on a migration. So the review session is minted
 * here: the same HS256 claims `createSessionToken` writes, signed locally with
 * the SAME `AUTH_SECRET`, for a deliberately UNPRIVILEGED EMPLOYEE whose four
 * permission flags are all false.
 *
 * WHAT IT DOES NOT DO
 *   - it never prints the token or the secret (only a SHA-256 fingerprint);
 *   - it writes no file inside the worktree by default (output goes to the OS
 *     temp directory, outside the frozen tree);
 *   - it touches no database, starts no server, reads no app state.
 *
 * The claims are pinned to the canonical module by
 * `tests/exec-review-session.test.ts`, which verifies a minted token through the
 * real `verifySessionToken` and compares the payload with `createSessionToken`.
 *
 * USAGE
 *   AUTH_SECRET=… node scripts/exec-review-session.mjs [--out <file>] [--host localhost] [--ttl 28800]
 *   curl -b "$OUT" -H 'Origin: http://localhost:3100' \
 *        -H 'Content-Type: application/json' \
 *        -d '{"turnId":"t1","message":"مرحبا"}' \
 *        http://localhost:3100/api/exec/turn
 *
 * Note: use the SAME host spelling in EXEC_TRUSTED_ORIGIN, in the browser URL
 * and in curl. Next normalizes 127.0.0.1 to localhost internally, so mixing the
 * two spellings makes an originless request fail closed (a browser fetch is not
 * affected: it always sends Origin).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SignJWT } from "jose";

/** The unprivileged review identity. Every permission flag is false. */
export const REVIEW_SESSION = Object.freeze({
  userId: "review-exec-user",
  name: "EXEC Review",
  role: "EMPLOYEE",
  businessId: "review",
  canAccessNexup: false,
  canAccessRebound: false,
  canAccessAbomazen: false,
  canAccessOfficeFinanceFull: false,
});

function secretBytes(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mirrors `createSessionToken` in `src/lib/auth.ts` claim-for-claim.
 * `tests/exec-review-session.test.ts` is what keeps the mirror honest.
 *
 * @param {{ secret?: string, session?: typeof REVIEW_SESSION, ttlSeconds?: number }} [options]
 * @returns {Promise<string>}
 */
export async function buildReviewSessionToken({
  secret,
  session = REVIEW_SESSION,
  // Mirrors `sessionDurationSeconds` in src/lib/auth.ts unless overridden.
  ttlSeconds = 28_800,
} = {}) {
  return new SignJWT({
    name: session.name,
    role: session.role,
    businessId: session.businessId,
    canAccessNexup: session.canAccessNexup,
    canAccessRebound: session.canAccessRebound,
    canAccessAbomazen: session.canAccessAbomazen,
    canAccessOfficeFinanceFull: session.canAccessOfficeFinanceFull,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretBytes(secret));
}

/**
 * Netscape cookie jar so `curl -b <file>` works without pasting the token.
 *
 * @param {string} token
 * @param {{ host?: string, expiresAtUnix: number }} options
 * @returns {string}
 */
export function buildCookieJar(token, { host = "localhost", expiresAtUnix }) {
  return [
    "# Netscape HTTP Cookie File",
    "# EXEC review session — unprivileged EMPLOYEE, review environment only.",
    `#HttpOnly_${host}\tFALSE\t/\tFALSE\t${expiresAtUnix}\tnexup_session\t${token}`,
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: null, ttl: 28_800, host: "localhost" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--host") args.host = argv[++i];
    else if (arg === "--ttl") {
      const ttl = Number(argv[++i]);
      if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("--ttl must be a positive number of seconds");
      args.ttl = Math.trunc(ttl);
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: AUTH_SECRET=… node scripts/exec-review-session.mjs [--out <file>] [--host localhost] [--ttl 28800]");
    return;
  }

  const insertAt = new Date();
  const token = await buildReviewSessionToken({
    secret: process.env.AUTH_SECRET,
    ttlSeconds: args.ttl,
  });

  const out = args.out ?? path.join(os.tmpdir(), "nexup-exec-review", "cookies.txt");
  mkdirSync(path.dirname(out), { recursive: true });
  const expiresAt = Math.floor(insertAt.getTime() / 1000) + args.ttl;
  writeFileSync(out, buildCookieJar(token, { host: args.host, expiresAtUnix: expiresAt }), { mode: 0o600 });

  // Never the token, never the secret — only a fingerprint you can compare.
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  console.log(
    JSON.stringify(
      {
        cookieJar: out,
        cookieHost: args.host,
        tokenSha256Prefix: fingerprint,
        role: REVIEW_SESSION.role,
        permissionFlags: "all false",
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        note: "Value intentionally not printed. Use the cookie jar with curl -b, or read it locally.",
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`exec-review-session failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
