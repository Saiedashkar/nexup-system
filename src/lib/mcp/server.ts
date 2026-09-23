import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpPrincipal } from "./auth";
import { isToolAllowed } from "./auth";
import { getBusinessScopeFilter } from "./scope";
import {
  listClients,
  searchClients,
  getClient,
  listProjects,
  getProject,
  listBusinesses,
  getBusinessSummary,
  getBrandContext,
} from "./queries";
import {
  SearchClientsInput,
  GetClientInput,
  GetClientsInput,
  GetProjectsInput,
  GetProjectInput,
  GetBusinessSummaryInput,
  GetBrandContextInput,
} from "./schemas";

/* ═══════════════════════════════════════════════════════════════
   MCP server (Phase 1 — READ-ONLY)

   One McpServer per request (stateless). Every tool:
   • is read-only (findMany/findFirst/aggregate only — enforced
     by the fact queries.ts contains no other Prisma calls),
   • authorizes through isToolAllowed/isBusinessAllowed centrally,
   • projects an explicit field allow-list (no raw row dumps).
   ═══════════════════════════════════════════════════════════════ */

export function buildMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer(
    { name: "nexup-mcp", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only access to the NEXUP / REBOUND / ABOMAZEN business data. " +
        "Clients and projects are scoped per business; amounts are stored " +
        "in the business currency (SAR for NEXUP, EGP for the others).",
    },
  );

  const deny = (tool: string) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: `Access denied: '${tool}' is not allowed for this MCP profile.` }],
  });

  const scope = getBusinessScopeFilter(principal);

  /* ─── Clients ─────────────────────────────────────────────── */

  server.registerTool(
    "search_clients",
    {
      description:
        "Search clients by name or phone fragment. Optionally restrict to one business (nexup | rebound | abomazen). Returns id, name, phone, tier, business, project count and created date.",
      inputSchema: SearchClientsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "search_clients")) return deny("search_clients");
      const { parsed } = await serverComplete(extra, SearchClientsInput, args);
      return ok(await searchClients(parsed, scope, principal));
    },
  );

  server.registerTool(
    "get_client",
    {
      description:
        "Fetch one client with full detail: identity, business, all project records (with amounts and statuses) and payment history. Use search_clients first to find the client id.",
      inputSchema: GetClientInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_client")) return deny("get_client");
      const { parsed } = await serverComplete(extra, GetClientInput, args);
      return ok(await getClient(parsed, scope, principal));
    },
  );

  server.registerTool(
    "get_clients",
    {
      description:
        "List clients (newest first) with pagination. Optionally restrict to one business. Same compact fields as search_clients.",
      inputSchema: GetClientsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_clients")) return deny("get_clients");
      const { parsed } = await serverComplete(extra, GetClientsInput, args);
      return ok(await listClients(parsed, scope, principal));
    },
  );

  /* ─── Projects ────────────────────────────────────────────── */

  server.registerTool(
    "get_projects",
    {
      description:
        "List project/service records with filters (business, clientId, workStatus, paymentStatus) and pagination, newest first. Returns amounts, statuses, designer and client references.",
      inputSchema: GetProjectsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_projects")) return deny("get_projects");
      const { parsed } = await serverComplete(extra, GetProjectsInput, args);
      return ok(await listProjects(parsed, scope, principal));
    },
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Fetch one project/service record with full detail: client info, services, all payment installments with amounts and dates.",
      inputSchema: GetProjectInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_project")) return deny("get_project");
      const { parsed } = await serverComplete(extra, GetProjectInput, args);
      return ok(await getProject(parsed, scope, principal));
    },
  );

  /* ─── Businesses ──────────────────────────────────────────── */

  server.registerTool(
    "get_businesses",
    {
      description:
        "List all businesses/brands (NEXUP, REBOUND, ABOMAZEN) with slug, currency mode and record counts (clients, projects, subscriptions).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (_args, extra) => {
      if (!isToolAllowed(principal, "get_businesses")) return deny("get_businesses");
      return ok(await listBusinesses(principal));
    },
  );

  server.registerTool(
    "get_business_summary",
    {
      description:
        "Aggregate summary for one business: total clients, projects, monthly counts, revenue by payment status and recent activity. Amounts are in the business currency.",
      inputSchema: GetBusinessSummaryInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_business_summary")) return deny("get_business_summary");
      const { parsed } = await serverComplete(extra, GetBusinessSummaryInput, args);
      return ok(await getBusinessSummary(parsed, scope, principal));
    },
  );

  server.registerTool(
    "get_brand_context",
    {
      description:
        "Compact brand context for AI personas: business identity, currency mode, service types and workload mix. Pass no arguments for all three brands at once.",
      inputSchema: GetBrandContextInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, extra) => {
      if (!isToolAllowed(principal, "get_brand_context")) return deny("get_brand_context");
      const { parsed } = await serverComplete(extra, GetBrandContextInput, args);
      return ok(await getBrandContext(parsed, scope, principal));
    },
  );

  return server;
}

/* ─── helpers ─────────────────────────────────────────────── */

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * Re-validate args against the zod schema server-side.
 * registerTool already validates inputSchema, but this keeps the
 * handler independent of registration order and future SDK changes.
 */
async function serverComplete<T extends z.ZodType>(
  _extra: unknown,
  schema: T,
  args: unknown,
): Promise<{ parsed: z.infer<T> }> {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid input — ${issues}`);
  }
  return { parsed: result.data };
}
