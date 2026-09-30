import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-workforce/approvals/:id/reject
 *
 *   validate actor → record decision → block the job
 *   → the capability is NEVER executed → audit
 *
 * There is no "run anyway" path: a rejection is terminal for that approval, and
 * because the job keeps its approvalId, a later resume attempt is refused by
 * the approval policy (APPROVAL_REJECTED → BLOCKED) even if somebody tries.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: string } | null;

    const core = getControlCore();
    const result = await core.approvalService.reject({
      approvalId: id,
      actor: guard.actor,
      reason: body?.reason,
    });

    return NextResponse.json({
      decision: "REJECTED",
      toolExecuted: false,
      approval: result.approval,
      job: result.job,
      jobStatus: result.job?.status ?? null,
      persistence: getWorkforceBootstrap().persistence,
      trace: result.job ? await core.recorder.listJobEvents(result.job.id, 200) : [],
    });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to reject workforce capability");
  }
}
