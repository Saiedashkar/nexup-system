import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

/**
 * GET /api/ai-workforce/runs
 *
 * Recent runs + audit events (in-memory in Phase 1A). Read-only.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const core = getControlCore();
    const runLimit = clamp(request.nextUrl.searchParams.get("runs"), 20, 100);
    const eventLimit = clamp(request.nextUrl.searchParams.get("events"), 50, 200);

    const [runs, events, approvals] = await Promise.all([
      core.recorder.listRuns(runLimit),
      core.recorder.listEvents(eventLimit),
      core.approvalService.list(20),
    ]);

    const bootstrap = getWorkforceBootstrap();

    return NextResponse.json({
      persistence: {
        kind: bootstrap.persistence,
        reason: bootstrap.reason,
        legacyDatabaseWrites: "NONE",
      },
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        toolId: run.toolId,
        jobId: run.jobId,
        runtimeKind: run.runtimeKind,
        actorUserId: run.actorUserId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        errorCode: run.errorCode,
      })),
      events,
      approvals,
    });
  } catch (error) {
    console.error("[ai-workforce] runs failed:", error);
    return NextResponse.json({ error: "Failed to list workforce runs" }, { status: 500 });
  }
}
