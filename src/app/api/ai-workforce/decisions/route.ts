import { NextRequest, NextResponse } from "next/server";

import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { getWorkforceApplication, MissionAccessService } from "@/modules/workforce/application";
import { authorityIsHumanDecisionActor } from "@/modules/workforce/execution/execution-authority";
import { authorityFromAuthenticatedActor } from "@/modules/workforce/execution/session-authority";
import { isReviewDecision } from "@/modules/workforce/review/task-review";
import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { ReviewId } from "@/modules/workforce/core/refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ai-workforce/decisions — the HUMAN AUTHORITY boundary, over HTTP.
 *
 * GET  lists every review still waiting for a person, filtered SERVER-SIDE to
 *      the caller's authorized businesses.
 * POST records ONE decision. The decider is the HUMAN actor the authenticated
 *      user RESOLVES to — never the literal `"actor_founder"` the route used to
 *      send, and never a payload value. The decision is authorised against the
 *      review's mission business first, so a cross-business review id yields the
 *      same 404-alike as an unknown one; the review service still refuses a
 *      second decision (APPROVAL_ALREADY_DECIDED) and any non-HUMAN decider.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
    const application = await getWorkforceApplication();
    const authority = await authorityFromAuthenticatedActor({
      actor: guard.actor,
      humanActors: application.humanActors,
    });
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;

    const visible = await application.access.authorizedMissionIds(authority, bounded * 4);
    const decisions = (await application.queries.decisionQueue(bounded)).filter((row) =>
      MissionAccessService.allows(visible, row.missionId),
    );
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
    const authority = await authorityFromAuthenticatedActor({
      actor: guard.actor,
      humanActors: application.humanActors,
    });

    // HUMAN AUTHORITY, checked before the review is read: a non-HUMAN authority
    // can never decide, whatever it can reach.
    if (!authorityIsHumanDecisionActor(authority)) {
      throw new AiWorkforceError("APPROVAL_FORBIDDEN", "Only a HUMAN authority may decide a review", {
        actorType: authority.actorType,
      });
    }

    // review → task → mission → business, authorized server-side. The redacting
    // variant reports a cross-business review with the SAME shape as an unknown
    // one, so the response cannot reveal that the review exists.
    await application.access.authorizeReviewForCaller(authority, body.reviewId as ReviewId);

    const note = [body.note, `decided by ${authority.actorId}`]
      .filter((part): part is string => Boolean(part))
      .join(" — ");

    const result = await application.commands.decide(body.reviewId as ReviewId, {
      decision: body.decision,
      // The RESOLVED human actor for this authenticated user. Not the payload,
      // and not a constant.
      decidedBy: authority.actorId,
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
