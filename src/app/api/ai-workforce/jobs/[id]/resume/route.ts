import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai-workforce/jobs/:id/resume
 *
 * Recovery path, not a decision. It re-drives a job that is stuck between a
 * recorded approval and its execution (for example: the process died right
 * after the decision was committed).
 *
 * Safe by construction: the job carries its own context snapshot and its own
 * approvalId, the policy is re-checked, and every transition is a
 * compare-and-set — so a job that is already RUNNING or finished is refused,
 * and this endpoint can never execute a capability twice.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const core = getControlCore();
    const outcome = await core.jobs.run(id);

    return NextResponse.json({
      job: outcome.job,
      status: outcome.status,
      output: outcome.output ?? null,
      error: outcome.error ?? null,
      persistence: getWorkforceBootstrap().persistence,
      trace: await core.recorder.listJobEvents(id, 200),
    });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to resume workforce job");
  }
}
