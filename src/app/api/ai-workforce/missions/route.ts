import { NextRequest, NextResponse } from "next/server";

import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import {
  buildAuthorizedMissionCommand,
  getWorkforceApplication,
  MissionAccessService,
  workforceApplicationStatus,
} from "@/modules/workforce/application";
import { resolveRequestedBusiness } from "@/modules/workforce/execution/authority-resolution";
import { authorityFromAuthenticatedActor } from "@/modules/workforce/execution/session-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ai-workforce/missions — the application's front door to the lifecycle.
 *
 * POST issues a Command:
 *
 *   Command (idempotency key) → durable Mission → Task plan → Actor
 *   → Capability authorisation → Runtime → Execution → Result → Review
 *
 * IDENTITY IS SERVER-DERIVED. The route builds an `ExecutionAuthority` from the
 * session AND the resolved HUMAN actor, then builds the command from that
 * authority: `requestedBy` is the signed-in user and `owner` is the resolved
 * actor. A payload can neither set them nor name another owner, and it cannot
 * smuggle an unverified `businessId` past the scope check below.
 *
 * BUSINESS SCOPE. A caller may name a business they already reach (narrowing);
 * naming one outside their scope is refused, and an unverifiable reference is
 * refused rather than ignored.
 *
 * GET is the read-only Active Missions surface the Command Center will draw,
 * filtered to the caller's authorized businesses SERVER-SIDE.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const status = workforceApplicationStatus();
    if (!status.available) {
      return NextResponse.json(
        {
          error: "PERSISTENCE_UNAVAILABLE",
          message: "The mission lifecycle is not available on this deployment.",
          reason: status.reason,
        },
        { status: 503 },
      );
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
    const application = await getWorkforceApplication();
    const authority = await authorityFromAuthenticatedActor({
      actor: guard.actor,
      humanActors: application.humanActors,
    });
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;

    // Resolve the caller's authorized missions ONCE, then filter every surface
    // against that set. `null` means "all" (super-admin).
    const visible = await application.access.authorizedMissionIds(authority, bounded * 4);

    const [allMissions, allExecution, allActivity, allDecisions] = await Promise.all([
      application.queries.activeMissions(bounded),
      application.queries.executionStatus({ limit: bounded }),
      application.queries.recentActivity(bounded),
      application.queries.decisionQueue(bounded),
    ]);

    const activeMissions = allMissions.filter((row) => MissionAccessService.allows(visible, row.missionId));
    const executionStatus = allExecution.filter((row) => MissionAccessService.allows(visible, row.missionId));
    const recentActivity = allActivity.filter((row) => MissionAccessService.allows(visible, row.missionId));
    const decisionQueue = allDecisions.filter((row) => MissionAccessService.allows(visible, row.missionId));

    return NextResponse.json({
      count: activeMissions.length,
      activeMissions,
      executionStatus,
      recentActivity,
      decisionQueue,
      lifecycle: {
        persistence: application.bootstrap.persistence,
        routing: application.routing,
      },
    });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to read the mission lifecycle");
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "A JSON body is required" }, { status: 400 });

    const application = await getWorkforceApplication();
    const authority = await authorityFromAuthenticatedActor({
      actor: guard.actor,
      humanActors: application.humanActors,
    });

    // A business reference must resolve AND be within the caller's scope. Naming
    // one narrows; it can never widen.
    const reference =
      typeof body.businessId === "string" && body.businessId.trim()
        ? body.businessId
        : typeof body.businessSlug === "string" && body.businessSlug.trim()
          ? body.businessSlug
          : undefined;
    const business = await resolveRequestedBusiness(authority, application.businesses, reference);

    // Identity comes from the authority; the payload owns only the work.
    const command = buildAuthorizedMissionCommand({ body, authority, business });

    const outcome = await application.commands.issueCommand(command);

    if (outcome.kind === "in-progress") {
      return NextResponse.json(
        {
          status: "IN_PROGRESS",
          message: "This command is already being built; retry with the same idempotency key.",
          intent: outcome.intent,
        },
        { status: 202 },
      );
    }

    const snapshot = await application.commands.snapshot(outcome.mission.id);
    const status = outcome.kind === "issued" ? 201 : 200;

    return NextResponse.json(
      {
        status: outcome.kind === "issued" ? "ISSUED" : "REPLAYED",
        replayed: outcome.replayed,
        intent: outcome.intent,
        mission: snapshot.mission,
        tasks: snapshot.tasks,
        executions: snapshot.executions,
        reviews: snapshot.reviews,
        changes: outcome.changes,
        routing: application.routing,
      },
      { status },
    );
  } catch (error) {
    return workforceErrorResponse(error, "Failed to issue the command");
  }
}
