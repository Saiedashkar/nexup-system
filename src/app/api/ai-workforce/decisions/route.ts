import { NextRequest, NextResponse } from "next/server";

import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { isReviewDecision } from "@/modules/workforce/review/task-review";
import { getWorkforceApplication } from "@/modules/workforce/application";
import type { ReviewId } from "@/modules/workforce/core/refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ai-workforce/decisions — the HUMAN AUTHORITY boundary, over HTTP.
 *
 * GET  lists every review still waiting for a person. That is the Decision
 *      Queue the Command Center will draw.
 * POST records ONE decision. The review service refuses a second decision
 *      (APPROVAL_ALREADY_DECIDED) and refuses any decider that is not a HUMAN
 *      actor, so an agent cannot approve its own work and a double-click cannot
 *      decide twice. The decision is attributed to the Founder actor — the
 *      registered human authority this deployment escalates to — and the
 *      signed-in user is recorded in the note.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
    const application = await getWorkforceApplication();
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;

    const decisions = await application.queries.decisionQueue(bounded);
    return NextResponse.json({ count: decisions.length, decisions });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to read the decision queue");
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const body = (await request.json().catch(() => null)) as
      | { reviewId?: string; decision?: string; note?: string }
      | null;

    if (!body?.reviewId || typeof body.reviewId !== "string") {
      return NextResponse.json({ error: "reviewId is required" }, { status: 400 });
    }
    if (typeof body.decision !== "string" || !isReviewDecision(body.decision)) {
      return NextResponse.json({ error: "decision must be APPROVED, REJECTED or NEEDS_REVISION" }, { status: 400 });
    }

    const application = await getWorkforceApplication();
    const note = [body.note, `decided by ${guard.actor.userId}`].filter((part): part is string => Boolean(part)).join(" — ");

    const result = await application.commands.decide(body.reviewId as ReviewId, {
      decision: body.decision,
      decidedBy: "actor_founder",
      note,
    });

    const snapshot = await application.commands.snapshot(result.mission.id);
    return NextResponse.json({
      decision: body.decision,
      mission: snapshot.mission,
      tasks: snapshot.tasks,
      reviews: snapshot.reviews,
      changes: result.changes,
    });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to record the decision");
  }
}
