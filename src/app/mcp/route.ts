import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateRequest, isToolAllowed } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import type { McpPrincipal } from "@/lib/mcp/auth";

/* ═══════════════════════════════════════════════════════════════
   POST /mcp — remote MCP endpoint (Phase 1 reads + Phase 2A actions).

   • Transport: official SDK WebStandardStreamableHTTPServerTransport
     in stateless JSON mode (`enableJsonResponse: true`,
     `sessionIdGenerator: undefined`) — one server+transport per
     request, no shared mutable state between serverless invocations.
   • Auth: `Authorization: Bearer <MCP_ACCESS_TOKEN>`, checked BEFORE
     any body parsing. Fail-closed when the token env var is absent.
   • Tools: the eight read-only tools plus the four Phase 2A
     create/update tools registered in lib/mcp/server. The action
     tools cannot delete anything and cannot write financial fields.
   ═══════════════════════════════════════════════════════════════ */

const MAX_BODY_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const auth = authenticateRequest(req);
  if (auth.ok === false) {
    return json({ jsonrpc: "2.0", error: { code: -32000, message: auth.error }, id: null }, auth.status);
  }
  const principal: McpPrincipal = auth.principal;

  // Content-Type guard: the streamable transport expects JSON bodies.
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Content-Type must be application/json" }, id: null },
      415,
    );
  }

  // Size guard before touching the body.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Request body too large" }, id: null },
      413,
    );
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Unreadable request body" }, id: null },
      400,
    );
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Request body too large" }, id: null },
      413,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "Parse error: invalid JSON" }, id: null },
      400,
    );
  }

  // Defense-in-depth: reject batch payloads — Phase 1 keeps the
  // surface single-request only (streamable HTTP allows them, but
  // stateless per-request servers have no need for batches).
  if (Array.isArray(body)) {
    return json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Batch requests are not supported" }, id: null },
      400,
    );
  }

  // Authorization is enforced twice: here (cheap, before server
  // construction) and inside each tool handler via isToolAllowed.
  if (isProtocolRequest(body) && !isToolAllowedForBody(principal, body)) {
    return json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Access denied for this MCP profile" }, id: null },
      403,
    );
  }

  try {
    const server = buildMcpServer(principal);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,      // plain JSON responses, no SSE stream
    });
    await server.connect(transport);
    // Body was already consumed for validation — hand the parsed object
    // to the transport via `parsedBody` (its documented pre-parsed-body path).
    const response = await transport.handleRequest(req, { parsedBody: body });

    // Never leak internals; strip any transport-added headers we don't want.
    response.headers.delete("mcp-session-id");
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (err) {
    console.error("[mcp] request failed:", err instanceof Error ? err.message : err);
    return json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null },
      500,
    );
  }
}

/* Other verbs: the spec reserves GET for SSE streams (we are
 * POST-only/stateless) and DELETE for session termination (no
 * sessions exist). Explicit 405 keeps well-behaved clients informed. */

export async function GET(): Promise<Response> {
  return json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST." }, id: null },
    405,
  );
}

export async function DELETE(): Promise<Response> {
  return json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
    405,
  );
}

/* ─── helpers ─────────────────────────────────────────────── */

type ProtocolShape = { method?: string; params?: { name?: string } };

function isProtocolRequest(body: unknown): body is ProtocolShape {
  return typeof body === "object" && body !== null && "method" in body;
}

function isToolAllowedForBody(principal: McpPrincipal, body: ProtocolShape): boolean {
  const method = body.method ?? "";
  if (method === "tools/call") {
    const name = body.params?.name;
    return typeof name === "string" && isToolAllowed(principal, name);
  }
  return true; // initialize / ping / tools/list are harmless metadata
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
