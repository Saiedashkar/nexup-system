import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-workforce/approvals
 *
 * Pending and recent human decisions. Each record carries the eligibility of
 * the CALLER, so the UI can disable a button the policy would refuse anyway —
 * the decision itself is re-checked server-side on approve/reject.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const core = getControlCore();
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
    const pendingOnly = request.nextUrl.searchParams.get("pending") === "1";

    const approvals = pendingOnly ? await core.approvalService.listPending(bounded) : await core.approvalService.list(bounded);

    return NextResponse.json({
      count: approvals.length,
      persistence: getWorkforceBootstrap().persistence,
      approvals: approvals.map((approval) => {
        const eligibility = core.approvalService.evaluateEligibility(approval, guard.actor);
        return {
          ...approval,
          canDecide: eligibility.allowed && approval.status === "PENDING",
          eligibility,
        };
      }),
    });
  } catch (error) {
    console.error("[ai-workforce] approvals list failed:", error);
    return NextResponse.json({ error: "Failed to list workforce approvals" }, { status: 500 });
  }
}
