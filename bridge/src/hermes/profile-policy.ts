import { assertAddressableProfile } from "@/modules/workforce/runtimes/hermes/hermes-config";

import { BridgeError } from "../api/errors";

/**
 * Profile policy.
 *
 * The bridge addresses exactly ONE profile, pinned at configuration time. A
 * caller can NEVER choose, override or hint a profile: the field is ignored and
 * actively rejected so a bug or an attacker cannot widen the scope. The pinned
 * profile is validated with the app's own guard, which refuses `default` and
 * anything that is not a safe slug.
 */

export const PINNED_PROFILE_FALLBACK = "saieed";

/** Validates and returns the pinned profile. Throws on unsafe/forbidden. */
export function assertPinnableProfile(profile: string): string {
  return assertAddressableProfile(profile);
}

/**
 * @throws BridgeError FORBIDDEN_PROFILE when the caller tries to specify a
 * profile. The bridge is not a proxy — it does not accept a scope argument.
 */
export function assertNoCallerProfile(body: unknown): void {
  if (body && typeof body === "object" && "profile" in body) {
    throw new BridgeError(
      "FORBIDDEN_PROFILE",
      "The bridge pins the Hermes profile server-side; a caller-supplied profile is not accepted",
    );
  }
}
