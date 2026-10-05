import { BRIDGE_SIGNATURE_HEADERS, verifySignature } from "@/modules/workforce/bridge/signing";

import { BridgeError } from "../api/errors";
import type { NonceStore } from "./nonce-store";

/**
 * Request-level signature verification.
 *
 * Order matters: the key id is resolved, the timestamp window is checked, the
 * HMAC is verified, and ONLY THEN is the nonce consumed. Rejecting before the
 * nonce write means an unauthenticated flood cannot fill the nonce store.
 */

export type SignedRequestInput = {
  method: string;
  /** Path only (no query string). */
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
  nowMs: number;
  hmacSecret: string;
  allowedKeyIds: readonly string[];
  clockSkewSeconds: number;
  nonceStore: NonceStore;
};

export type VerifiedIdentity = { keyId: string };

/** Case-insensitive header lookup. */
export function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") return value;
  }
  return undefined;
}

export function verifySignedRequest(input: SignedRequestInput): VerifiedIdentity {
  const keyId = headerValue(input.headers, BRIDGE_SIGNATURE_HEADERS.keyId);
  const signature = headerValue(input.headers, BRIDGE_SIGNATURE_HEADERS.signature);
  const timestamp = headerValue(input.headers, BRIDGE_SIGNATURE_HEADERS.timestamp);
  const nonce = headerValue(input.headers, BRIDGE_SIGNATURE_HEADERS.nonce);

  if (!keyId || !signature || !timestamp || !nonce) {
    throw new BridgeError("UNAUTHORIZED", "Missing bridge signature headers");
  }
  if (!input.allowedKeyIds.includes(keyId)) {
    throw new BridgeError("UNAUTHORIZED", `Unknown bridge key id "${keyId}"`);
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    throw new BridgeError("SIGNATURE_INVALID", "Bridge timestamp is not a number");
  }
  const skewSeconds = Math.abs(input.nowMs / 1000 - parsedTimestamp);
  if (skewSeconds > input.clockSkewSeconds) {
    throw new BridgeError("REPLAY", "Signed request timestamp is outside the acceptance window");
  }

  const parts = { method: input.method, path: input.path, timestamp, nonce, body: input.body };
  if (!verifySignature(input.hmacSecret, parts, signature)) {
    throw new BridgeError("SIGNATURE_INVALID", "Bridge signature did not match");
  }

  if (!input.nonceStore.consume(keyId, nonce, input.nowMs)) {
    throw new BridgeError("REPLAY", "Bridge nonce was already used");
  }

  return { keyId };
}
