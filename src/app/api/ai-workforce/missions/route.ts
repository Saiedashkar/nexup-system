import { NextRequest, NextResponse } from "next/server";

import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { getWorkforceApplication, workforceApplicationStatus } from "@/modules/workforce/application";

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
 * The actor comes from the session, never from the payload: `requestedBy` is the
 * signed-in user and `idempotencyKey` is the caller's retry token. A duplicate
 * submit with the same key returns the SAME mission (200, `replayed: true`) and
 * advances nothing, so a client's retry cannot cause a second real execution.
 *
 * GET is the read-only Active Missions surface the Command Center will draw.
 * Neither verb replaces any UI mock — Step 6 is what wires the screens.
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
    const bounded = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;

    const [activeMissions, executionStatus, recentActivity, decisionQueue] = await Promise.all([
      application.queries.activeMissions(bounded),
      application.queries.executionStatus({ limit: bounded }),
      application.queries.recentActivity(bounded),
      application.queries.decisionQueue(bounded),
    ]);

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

    // The session owns identity; the payload owns the work. A payload can never
    // set `requestedBy`, and a payload without a key is refused by the parser.
    const command = {
      ...body,
      requestedBy: guard.actor.userId,
      scope: typeof body.scope === "string" && body.scope.trim() ? body.scope : `user:${guard.actor.userId}`,
      owner: typeof body.owner === "string" && body.owner.trim() ? body.owner : "actor_founder",
    };

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
