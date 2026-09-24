import { createHash, timingSafeEqual } from "crypto";

/* ═══════════════════════════════════════════════════════════════
   MCP authentication (Phase 1 read tools + Phase 2A action tools)

   A single shared bearer token (MCP_ACCESS_TOKEN) authenticates
   remote AI agents. It grants a SUPER_ADMIN-equivalent principal
   scoped by the two allow-lists below: allowedBusinesses and
   allowedTools. Phase 2A adds four narrowly-scoped create/update
   tools — never delete, never financial writes — and the principal
   shape stays the single place where that scope is decided.
   Auth itself is unchanged from Phase 1 (fail-closed bearer check).
   ═══════════════════════════════════════════════════════════════ */

/** Stable business slugs (mirrors the seeded Business table). */
export const BUSINESS_SLUGS = ["nexup", "rebound", "abomazen"] as const;
export type BusinessSlug = (typeof BUSINESS_SLUGS)[number];

/**
 * The acting identity behind an MCP request.
 * Phase 1: one token → one read-only super principal.
 * Phase 2: per-profile principals (Manager, Sales, Accountant…)
 * will simply carry narrower allowedBusinesses/allowedTools.
 */
export type McpPrincipal = {
  id: string;
  displayName: string;
  role: "MCP_READONLY" | "MCP_OPERATOR";
  allowedBusinesses: ReadonlySet<BusinessSlug>;
  allowedTools: ReadonlySet<string>;
};

/** Phase 1 tools — read-only projections, unchanged. */
export const READ_TOOL_NAMES = [
  "search_clients",
  "get_client",
  "get_clients",
  "get_projects",
  "get_project",
  "get_businesses",
  "get_business_summary",
  "get_brand_context",
] as const;

/**
 * Phase 2A tools — strictly add/update, never delete, never financial
 * writes (no deposit / paymentStatus / ClientPayment / PoolTransaction).
 */
export const ACTION_TOOL_NAMES = [
  "create_client",
  "update_client",
  "create_project",
  "update_project",
] as const;

export const ALL_TOOL_NAMES = [...READ_TOOL_NAMES, ...ACTION_TOOL_NAMES] as const;
export type McpToolName = (typeof ALL_TOOL_NAMES)[number];
export type McpActionToolName = (typeof ACTION_TOOL_NAMES)[number];

/** Shared-token principal: every business, every tool in ALL_TOOL_NAMES. */
export function buildSuperPrincipal(): McpPrincipal {
  return {
    id: "mcp-shared-token",
    displayName: "MCP Shared Token",
    role: "MCP_OPERATOR",
    allowedBusinesses: new Set<BusinessSlug>(BUSINESS_SLUGS),
    allowedTools: new Set<string>(ALL_TOOL_NAMES),
  };
}

export type AuthFailure =
  | { ok: false; status: 503; error: string }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 400; error: string };

export type AuthSuccess = { ok: true; principal: McpPrincipal };

/**
 * Authenticate an MCP request via `Authorization: Bearer <token>`.
 * Fails closed: if MCP_ACCESS_TOKEN is not configured the endpoint
 * rejects everything with 503 rather than falling open.
 */
export function authenticateRequest(req: Request): AuthSuccess | AuthFailure {
  const configured = process.env.MCP_ACCESS_TOKEN?.trim();
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "MCP is not configured on this server (MCP_ACCESS_TOKEN missing).",
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, status: 401, error: "Missing bearer token." };
  }

  if (!timingSafeTokenMatch(match[1], configured)) {
    return { ok: false, status: 401, error: "Invalid bearer token." };
  }

  return { ok: true, principal: buildSuperPrincipal() };
}

/** Constant-time comparison via SHA-256 digests (equalizes lengths). */
function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Central authorization point — Phase 2 scopes live here, nowhere else. */
export function isToolAllowed(principal: McpPrincipal, toolName: string): boolean {
  return principal.allowedTools.has(toolName);
}

/** Check a business slug against the principal's scope. */
export function isBusinessAllowed(principal: McpPrincipal, slug: string): boolean {
  return (principal.allowedBusinesses as ReadonlySet<string>).has(slug);
}
