import { randomUUID } from "crypto";

/* ═══════════════════════════════════════════════════════════════
   NEXUP MCP — tool error surface

   Everything an MCP client sees must be a clean, coded message.
   Raw database/driver text never crosses this boundary: it can leak
   connection strings, column and table names, SQL fragments and the
   shape of the schema to an external agent.

   Two layers:
   • `McpActionError` — expected, actionable failures raised by the
     action handlers (not found, scope denial, duplicate phone, bad
     date…). Mapped straight through as `[code] message`.
   • `mcpFailure()` — the catch-all. Known Prisma request codes are
     translated to a generic, safe message; anything else becomes an
     `[internal_error]` carrying only a short reference id, while the
     real error is logged server-side with secrets redacted.
   ═══════════════════════════════════════════════════════════════ */

export type ActionErrorCode = "invalid_input" | "not_found" | "forbidden" | "conflict";

/** Any expected action failure — surfaced to the agent as an MCP tool error. */
export class McpActionError extends Error {
  readonly code: ActionErrorCode;
  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = "McpActionError";
    this.code = code;
  }
}

export type McpToolFailure = {
  isError: true;
  content: { type: "text"; text: string }[];
};

/**
 * Prisma request-error codes we can describe without leaking internals.
 * The message says what the caller can do, never what the database said.
 */
const SAFE_PRISMA_ERRORS: Record<string, { code: ActionErrorCode; message: string }> = {
  P2025: {
    code: "not_found",
    message: "The requested record does not exist, or it changed before this call completed.",
  },
  P2002: {
    code: "conflict",
    message: "The change collides with existing data and was not applied.",
  },
  P2003: {
    code: "conflict",
    message: "The change references a record that no longer exists and was not applied.",
  },
  P2000: {
    code: "invalid_input",
    message: "One of the supplied values is too long for its field.",
  },
};

/**
 * Last line of defence for tool handlers: never let a raw error reach
 * the client. Expected failures pass through with their code; everything
 * else is logged server-side and reported as an opaque internal error.
 */
export function mcpFailure(err: unknown, context: string): McpToolFailure {
  if (err instanceof McpActionError) {
    return toolError(`[${err.code}] ${err.message}`);
  }

  const prismaCode = prismaErrorCode(err);

  if (prismaCode && SAFE_PRISMA_ERRORS[prismaCode]) {
    const mapped = SAFE_PRISMA_ERRORS[prismaCode];
    console.error(`[mcp] ${context} rejected (${prismaCode}): ${describeError(err)}`);
    return toolError(`[${mapped.code}] ${mapped.message}`);
  }

  const reference = randomUUID().replace(/-/g, "").slice(0, 12);
  console.error(`[mcp] ${context} failed (ref ${reference}): ${describeError(err)}`);
  return toolError(
    `[internal_error] The MCP server hit an internal error and this call was not completed. ` +
      `Nothing was changed. Reference: ${reference}. Retry once; if it keeps failing, share this reference with the NEXUP team.`,
  );
}

export function toolError(text: string): McpToolFailure {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Reads a Prisma request-error code by shape — no Prisma import needed. */
function prismaErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

/* ─── server-side logging (never client-facing) ────────────── */

/**
 * Patterns for values that must never be written to the log: database
 * URLs (which embed credentials), bearer/basic credentials and
 * key=value secrets. Applied to every server-side error description.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s"'`)]+/gi, "[redacted-connection-string]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted-credential]"],
  // `[A-Za-z0-9_]*` on both sides so snake_case/SCREAMING_CASE names match
  // (MCP_ACCESS_TOKEN=…, DATABASE_PASSWORD=…): `\btoken\b` would miss them
  // because `_` is a word character and therefore has no boundary before it.
  [
    /[A-Za-z0-9_]*(?:password|passwd|pwd|secret|token|api[_-]?key|authorization)[A-Za-z0-9_]*\s*[=:]\s*[^\s,;"'`]+/gi,
    "[redacted-value]",
  ],
];

/**
 * Strip anything credential-shaped out of text bound for the logs, then
 * remove the live MCP token itself. The pattern list can only recognise
 * secrets by shape; this last step catches the one secret we actually
 * hold, wherever it happens to be echoed.
 */
export function redactSecrets(text: string): string {
  let safe = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    safe = safe.replace(pattern, replacement);
  }

  const token = process.env.MCP_ACCESS_TOKEN?.trim();
  if (token && token.length >= 8) {
    safe = safe.split(token).join("[redacted-credential]");
  }

  return safe;
}

/** One redacted, length-capped line describing an unexpected error. */
function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : String(err);
  const code = prismaErrorCode(err);
  const summary = `${name}${code ? ` (${code})` : ""}: ${message}`;
  const capped = summary.length > 500 ? `${summary.slice(0, 500)}…` : summary;
  return redactSecrets(capped);
}
