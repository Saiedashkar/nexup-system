import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Shared bridge signing primitive.
 *
 * This is the ONE place the canonical request string and HMAC are defined. Both
 * sides of the trust boundary import it:
 *
 *   - the Vercel-side client (`bridge-client.ts`) SIGNS with it;
 *   - the VPS bridge (`bridge/src/auth/signature.ts`) VERIFIES with it.
 *
 * Because there is a single implementation, the two can never disagree about
 * the canonical form. It is server-only (it uses `node:crypto`) and must never
 * be imported into a client bundle or an edge runtime.
 *
 * Canonical string (newline-joined, in this exact order):
 *
 *   METHOD \n path \n timestamp \n nonce \n sha256hex(body)
 *
 * The body is hashed, never embedded, so large payloads stay cheap to sign and
 * the signature binds the exact bytes.
 */

export const BRIDGE_SIGNATURE_HEADERS = {
  keyId: "x-nexup-key-id",
  signature: "x-nexup-signature",
  timestamp: "x-nexup-timestamp",
  nonce: "x-nexup-nonce",
} as const;

export type BridgeSignatureHeaders = {
  "x-nexup-key-id": string;
  "x-nexup-signature": string;
  "x-nexup-timestamp": string;
  "x-nexup-nonce": string;
};

export type BridgeSignatureParts = {
  /** HTTP method, compared case-insensitively. */
  method: string;
  /** Request path only (no query), exactly as signed. */
  path: string;
  /** Unix seconds, as a string. */
  timestamp: string;
  /** 128-bit random hex, unique per request. */
  nonce: string;
  /** Raw request body text (`""` for an empty body). */
  body: string;
};

/** Lowercase hex SHA-256 of the body text. */
export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** The exact bytes that are HMAC'd. */
export function canonicalRequestString(parts: BridgeSignatureParts): string {
  return [parts.method.toUpperCase(), parts.path, parts.timestamp, parts.nonce, sha256Hex(parts.body)].join("\n");
}

/** Hex HMAC-SHA256 signature over the canonical string. */
export function computeSignature(secret: string, parts: BridgeSignatureParts): string {
  return createHmac("sha256", secret).update(canonicalRequestString(parts), "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex strings. Length is compared first (a
 * length check leaks nothing useful); equal lengths compare in constant time.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** True when `signature` is the valid signature for `parts` under `secret`. */
export function verifySignature(secret: string, parts: BridgeSignatureParts, signature: string): boolean {
  return timingSafeEqualHex(computeSignature(secret, parts), signature);
}

/* ═══════════════════════════════════════════════════════
   Signer (Vercel side) — produces the 4 signing headers.
   ═══════════════════════════════════════════════════════ */

export type BridgeSignerOptions = {
  keyId: string;
  secret: string;
  now?: () => Date;
  /** Injectable nonce source (tests use a deterministic one). */
  nonceFactory?: () => string;
};

export type BridgeSignInput = {
  method: string;
  path: string;
  body?: string;
};

/** Cryptographically random 128-bit nonce as hex. */
export function defaultNonceFactory(): string {
  return randomBytes(16).toString("hex");
}

export class BridgeSigner {
  private readonly keyId: string;
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly nonceFactory: () => string;

  constructor(options: BridgeSignerOptions) {
    if (!options.keyId) throw new Error("BridgeSigner requires a keyId");
    if (!options.secret) throw new Error("BridgeSigner requires a secret");
    this.keyId = options.keyId;
    this.secret = options.secret;
    this.now = options.now ?? (() => new Date());
    this.nonceFactory = options.nonceFactory ?? defaultNonceFactory;
  }

  /** Returns the header map (lowercased names) for a request. */
  sign(input: BridgeSignInput): BridgeSignatureHeaders {
    const body = input.body ?? "";
    const parts: BridgeSignatureParts = {
      method: input.method,
      path: input.path,
      timestamp: String(Math.floor(this.now().getTime() / 1000)),
      nonce: this.nonceFactory(),
      body,
    };
    return {
      "x-nexup-key-id": this.keyId,
      "x-nexup-signature": computeSignature(this.secret, parts),
      "x-nexup-timestamp": parts.timestamp,
      "x-nexup-nonce": parts.nonce,
    };
  }
}
