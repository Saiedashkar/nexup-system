import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";

/**
 * Credential guard.
 *
 * Phase 2A domain records (actors, capabilities, runtimes, execution
 * contexts) describe IDENTITY and POLICY. They must never carry secrets:
 * API keys, bearer tokens, passwords, private keys or provider credentials
 * belong to a secret store, never to a registry row or an execution snapshot.
 *
 * The check is INTENTIONALLY conservative and key-based. It normalises a key
 * (`apiKey` / `api_key` / `API-KEY` → `apikey`) and compares it against a set
 * of exact secret names. Substring matching is avoided on purpose: this code
 * legitimately uses keys such as `permissionTokens` and `tokenIds`, which a
 * substring rule would wrongly reject.
 */

const FORBIDDEN_KEY_NAMES: readonly string[] = [
  "apikey",
  "apikeys",
  "secret",
  "secretkey",
  "clientsecret",
  "password",
  "passwd",
  "token",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "idtoken",
  "bearertoken",
  "credential",
  "credentials",
  "authorization",
  "authheader",
  "bearer",
  "privatekey",
  "publickey",
  "accesskey",
  "accesskeyid",
  "secretaccesskey",
  "connectionstring",
];

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

/** The credential-looking keys found anywhere inside `value` (may be empty). */
export function findCredentialKeys(value: unknown): string[] {
  const found = new Set<string>();

  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const normalised = normaliseKey(key);
      if (FORBIDDEN_KEY_NAMES.includes(normalised)) {
        found.add(path ? `${path}.${key}` : key);
      }
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(value, "");
  return [...found];
}

export function hasCredentials(value: unknown): boolean {
  return findCredentialKeys(value).length > 0;
}

/**
 * @throws AiWorkforceError("INVALID_ACTOR") when a credential-looking key is
 *         present anywhere inside `value`.
 */
export function assertNoCredentials(value: unknown, subject: string): void {
  const keys = findCredentialKeys(value);
  if (keys.length === 0) return;

  throw new AiWorkforceError(
    "INVALID_ACTOR",
    `${subject} must not carry credentials — found secret-looking field(s): ${keys.join(", ")}`,
    { subject, fields: keys },
  );
}
