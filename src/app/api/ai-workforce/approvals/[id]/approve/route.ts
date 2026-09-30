import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-workforce/approvals/:id/approve
 *
 * The human half of the control loop:
 *
 *   validate actor → record decision → resume the SAME job → re-check policy
 *   → execute ONCE → persist result → audit
 *
 * Idempotent by construction: the decision is a compare-and-set and the job
 * transition is a compare-and-set, so calling this twice cannot execute the
 * capability twice — the second call returns `idempotent: true`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { reason?: string } | null;

    const core = getControlCore();
    const result = await core.approvalService.approve({
      approvalId: id,
      actor: guard.actor,
      reason: body?.reason,
    });

    return NextResponse.json({
      decision: "APPROVED",
      idempotent: result.idempotent,
      approval: result.approval,
      job: result.job,
      run: result.outcome?.run ?? null,
      output: result.outcome?.output ?? null,
      jobStatus: result.job?.status ?? null,
      persistence: getWorkforceBootstrap().persistence,
      trace: result.job ? await core.recorder.listJobEvents(result.job.id, 200) : [],
    });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to approve workforce capability");
  }
}
