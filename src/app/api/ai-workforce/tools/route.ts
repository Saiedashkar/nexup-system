import { NextResponse } from "next/server";
import { getControlCore } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-workforce/tools
 *
 * Returns registered tool DEFINITIONS (serialisable metadata, no handlers),
 * grouped by domain, plus the policy summary the UI needs to render them.
 */
export async function GET() {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const core = getControlCore();
    const tools = core.registry.list();

    return NextResponse.json({
      count: tools.length,
      byDomain: core.registry.byDomain(),
      tools: tools.map((tool) => ({
        id: tool.id,
        version: tool.version,
        name: tool.name,
        description: tool.description,
        domain: tool.domain,
        action: tool.action,
        riskLevel: tool.riskLevel,
        readWriteMode: tool.readWriteMode,
        requiredPermissions: tool.requiredPermissions,
        requiresApproval: tool.requiresApproval,
        businessScoped: tool.businessScoped,
        enabled: tool.enabled,
        estimatedCostPolicy: tool.estimatedCostPolicy,
        timeoutPolicy: tool.timeoutPolicy,
        retryPolicy: tool.retryPolicy,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      })),
      runtime: core.runtime.describe(),
    });
  } catch (error) {
    console.error("[ai-workforce] tools failed:", error);
    return NextResponse.json({ error: "Failed to list workforce tools" }, { status: 500 });
  }
}
