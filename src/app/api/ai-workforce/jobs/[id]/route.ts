import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-workforce/jobs/:id
 *
 * One job with its serialised transition history and ordered audit trail —
 * the API form of the end-to-end trace.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const core = getControlCore();

    const job = await core.jobs.getJob(id);
    if (!job) {
      return NextResponse.json({ error: "JOB_NOT_FOUND", message: `Job "${id}" does not exist` }, { status: 404 });
    }

    const [events, approvals, run] = await Promise.all([
      core.recorder.listJobEvents(id, 200),
      core.approvalService.listForJob(id, 10),
      job.runId ? core.recorder.getRun(job.runId) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      job,
      run,
      approvals,
      trace: events,
      persistence: getWorkforceBootstrap().persistence,
    });
  } catch (error) {
    console.error("[ai-workforce] job read failed:", error);
    return NextResponse.json({ error: "Failed to read workforce job" }, { status: 500 });
  }
}
