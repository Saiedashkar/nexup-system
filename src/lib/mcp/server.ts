import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpPrincipal } from "./auth";
import { isToolAllowed, writeToolsEnabled } from "./auth";
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
  CreateClientInput,
  UpdateClientInput,
  CreateProjectInput,
  UpdateProjectInput,
} from "./schemas";
import {
  createClientAction,
  updateClientAction,
  createProjectAction,
  updateProjectAction,
} from "./actions";
import {
  prepareCreateClientPayment,
  confirmCreateClientPayment,
} from "./redActions";
import { McpActionError, mcpFailure, toolError } from "./errors";
import { ConfirmActionInput, CreateClientPaymentInput } from "./schemas";
import { RED_ACTIONS } from "./classification";
import { redActionsEnabled } from "./auth";

/* ═══════════════════════════════════════════════════════════════
   MCP server (Phase 1 reads + Phase 2A create/update actions)

   One McpServer per request (stateless). Every tool:
   • authorizes through isToolAllowed/isBusinessAllowed centrally,
   • projects an explicit field allow-list (no raw row dumps).

   Read tools (queries.ts) only ever findMany/findFirst/aggregate.
   Action tools (actions.ts) can create and update only — there is no
   delete path anywhere in the MCP surface, and no financial write:
   create_project always stores deposit 0 / remaining = totalPrice /
   paymentStatus UNPAID, and update_project cannot touch money columns.

   Action tools are registered only while MCP_WRITE_TOOLS_ENABLED is
   truthy (fail-closed remote kill switch — see auth.ts), so the same
   build can run read-only or read+write purely from configuration.
   ═══════════════════════════════════════════════════════════════ */

export function buildMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer(
    { name: "nexup-mcp", version: "1.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Access to the NEXUP / REBOUND / ABOMAZEN business data. Clients and " +
        "projects are scoped per business; amounts are stored in the business " +
        "currency (SAR for NEXUP, EGP for the others). The create_* and update_* " +
        "tools are limited to admin fields: they never delete anything, never " +
        "move a record to another business, and never record money — new " +
        "projects are always created unpaid with zero deposit, and payment " +
        "status/amounts can only be changed in the web app.",
    },
  );

  const deny = (tool: string) =>
    toolError(`[forbidden] Access denied: '${tool}' is not allowed for this MCP profile.`);

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
      return run("search_clients", SearchClientsInput, args, (parsed) => searchClients(parsed, scope, principal));
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
      return run("get_client", GetClientInput, args, (parsed) => getClient(parsed, scope, principal));
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
      return run("get_clients", GetClientsInput, args, (parsed) => listClients(parsed, scope, principal));
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
      return run("get_projects", GetProjectsInput, args, (parsed) => listProjects(parsed, scope, principal));
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
      return run("get_project", GetProjectInput, args, (parsed) => getProject(parsed, scope, principal));
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
    async (args) => {
      if (!isToolAllowed(principal, "get_businesses")) return deny("get_businesses");
      return run("get_businesses", z.object({}), args, () => listBusinesses(principal));
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
      return run("get_business_summary", GetBusinessSummaryInput, args, (parsed) => getBusinessSummary(parsed, scope, principal));
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
      return run("get_brand_context", GetBrandContextInput, args, (parsed) => getBrandContext(parsed, scope, principal));
    },
  );

  /* ─── Action tools (Phase 2A — create / update only) ────────

     Registered only while the write kill switch is on
     (MCP_WRITE_TOOLS_ENABLED, fail-closed). With the flag off the four
     tools are absent from tools/list, the principal no longer carries
     them in allowedTools, and the route-level authorization check
     rejects any stale client that still tries to call one — so flipping
     the env var turns writes off at every layer, without a code change. */

  if (writeToolsEnabled()) {
    server.registerTool(
      "create_client",
      {
        description:
          "Create ONE client inside an explicitly named business (nexup | rebound | abomazen). Rejects a phone that already belongs to a live client in that business, and never touches any other business. Creates a client only — no project, payment, subscription or treasury row is written. Optional tier defaults to NORMAL.",
        inputSchema: CreateClientInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        if (!isToolAllowed(principal, "create_client")) return deny("create_client");
        return run("create_client", CreateClientInput, args, (parsed) => createClientAction(parsed, principal));
      },
    );

    server.registerTool(
      "update_client",
      {
        description:
          "Update an existing client's name, phone and/or tier. Requires clientId; the client must belong to a business this MCP profile may act on. Any other field is rejected, nothing is deleted, and the client can never be moved to another business. A phone already used by another live client in the same business is refused.",
        inputSchema: UpdateClientInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        if (!isToolAllowed(principal, "update_client")) return deny("update_client");
        return run("update_client", UpdateClientInput, args, (parsed) => updateClientAction(parsed, principal));
      },
    );

    server.registerTool(
      "create_project",
      {
        description:
          "Create a project record for an EXISTING client that belongs to the explicitly named business. Only projectName, date, totalPrice, customServiceText, workStatus, designerName and notes are accepted. The record is always created unpaid: deposit 0, remaining = totalPrice, paymentStatus UNPAID — no deposit, payment or treasury transaction is ever created by MCP. Payments must be recorded in the web app.",
        inputSchema: CreateProjectInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        if (!isToolAllowed(principal, "create_project")) return deny("create_project");
        return run("create_project", CreateProjectInput, args, (parsed) => createProjectAction(parsed, principal));
      },
    );

    server.registerTool(
      "update_project",
      {
        description:
          "Update the non-financial fields of a project record (projectName, workStatus, designerName, notes). Requires projectId. Amounts, deposit, remaining, paymentStatus, the client and the business are out of scope and are rejected if sent — this tool can never change money or delete a record.",
        inputSchema: UpdateProjectInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args, extra) => {
        if (!isToolAllowed(principal, "update_project")) return deny("update_project");
        return run("update_project", UpdateProjectInput, args, (parsed) => updateProjectAction(parsed, principal));
      },
    );
  }

  /* ─── Red tools (Phase 2B — confirmation-gated actions) ─────

     Registered only while BOTH kill switches are on
     (MCP_WRITE_TOOLS_ENABLED AND MCP_RED_ACTIONS_ENABLED, fail-closed
     and layered — see auth.ts). Each entry in the classification
     registry contributes exactly one prepare_* tool and one confirm_*
     tool; execution always goes through the shared pending-action
     core. With either flag off the tools are absent from tools/list,
     the principal does not carry them, and the route-level check
     rejects any stale call — no code change needed to disable. */

  if (redActionsEnabled()) {
    for (const red of RED_ACTIONS) {
      if (red.prepareTool === "prepare_create_client_payment") {
        server.registerTool(
          red.prepareTool,
          {
            description:
              "STAGE (do not execute) a client payment in SAR against an existing project. Validates the business scope, the project and its client, the amount (finite, positive, max 2 decimals) and the remaining balance — overpayment is rejected. Performs NO business mutation: it stores a server-side snapshot and returns a human-readable preview plus a one-time confirmation token valid for 10 minutes. Execute only via confirm_create_client_payment with that token.",
            inputSchema: CreateClientPaymentInput,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
          },
          async (args, extra) => {
            if (!isToolAllowed(principal, "prepare_create_client_payment")) return deny("prepare_create_client_payment");
            return run("prepare_create_client_payment", CreateClientPaymentInput, args, (parsed) =>
              prepareCreateClientPayment(parsed, principal),
            );
          },
        );
      }

      if (red.confirmTool === "confirm_create_client_payment") {
        server.registerTool(
          red.confirmTool,
          {
            description:
              "EXECUTE a previously staged client payment. Takes ONLY the confirmation id and the one-time token from prepare_create_client_payment — financial values are never re-sent; execution uses the server-side snapshot. One transaction re-checks preconditions (project money fields unchanged), creates the ClientPayment, updates deposit/remaining/paymentStatus, records the SAR PoolTransaction IN, recomputes the client tier, writes the business audit row and marks the action EXECUTED. Fails closed on wrong token, expiry, replay, concurrent confirmation or changed preconditions.",
            inputSchema: ConfirmActionInput,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
          },
          async (args, extra) => {
            if (!isToolAllowed(principal, "confirm_create_client_payment")) return deny("confirm_create_client_payment");
            return run("confirm_create_client_payment", ConfirmActionInput, args, (parsed) =>
              confirmCreateClientPayment(parsed, principal),
            );
          },
        );
      }
    }
  }

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
 * Run one tool call: validate the arguments, execute it, and turn every
 * failure into a clean coded message.
 *
 * Expected failures (not found, scope denial, duplicate phone, bad
 * date…) pass through as `[code] message`. Anything unexpected is
 * logged server-side with secrets redacted and reported to the client
 * as a generic `[internal_error]` plus a reference — raw Prisma or
 * driver text never crosses the MCP boundary.
 */
async function run<T extends z.ZodType, R>(
  toolName: string,
  schema: T,
  args: unknown,
  action: (parsed: z.infer<T>) => Promise<R>,
) {
  try {
    const { parsed } = await serverComplete(schema, args);
    return ok(await action(parsed));
  } catch (err) {
    return mcpFailure(err, `tool ${toolName}`);
  }
}

/**
 * Re-validate args against the zod schema server-side.
 * registerTool already validates inputSchema, but this keeps the
 * handler independent of registration order and future SDK changes.
 */
async function serverComplete<T extends z.ZodType>(
  schema: T,
  args: unknown,
): Promise<{ parsed: z.infer<T> }> {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
      .join("; ");
    throw new McpActionError("invalid_input", `Invalid input — ${issues}`);
  }
  return { parsed: result.data };
}
