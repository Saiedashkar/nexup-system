import { redactSecrets } from "@/modules/workforce/runtimes/hermes/hermes-spawn";

/**
 * Secret redaction for anything the bridge logs, audits, or returns on the wire.
 *
 * Reuses the app's verified `redactSecrets` (which only strips values of length
 * >= 4 so it can never mangle short strings) and adds a recursive form for
 * objects. Configure once with the bridge's secrets (HMAC secret, Hermes session
 * token) and thread the redactor everywhere.
 */

export type Redactor = {
  text(value: string): string;
  value<T>(value: T): T;
};

export function createRedactor(secrets: readonly string[]): Redactor {
  const usable = secrets.filter((secret) => typeof secret === "string" && secret.length >= 4);

  const text = (value: string): string => (typeof value === "string" ? redactSecrets(value, usable) : value);

  const value = <T>(input: T): T => {
    if (typeof input === "string") return text(input) as unknown as T;
    if (Array.isArray(input)) return input.map((entry) => value(entry)) as unknown as T;
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(input as Record<string, unknown>)) out[key] = value(entry);
      return out as unknown as T;
    }
    return input;
  };

  return { text, value };
}

/** A no-op redactor (tests that do not need redaction). */
export const identityRedactor: Redactor = {
  text: (v) => v,
  value: (v) => v,
};
