import { NextRequest, NextResponse } from "next/server";

import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { getWorkforceApplication } from "@/modules/workforce/application";
import type { MissionId } from "@/modules/workforce/core/refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET  /api/ai-workforce/missions/:id — the whole mission, in one read:
 *      mission, tasks, executions (attempts) and reviews.
 *
 * POST /api/ai-workforce/missions/:id — continue the mission. It is the
 *      resumption driver: after a restart, a failed attempt, a cancelled
 *      request or a human decision, this picks the mission up from the DATABASE
 *      (never from process memory), settles anything already in flight through
 *      the runtime port, and promotes what is dispatchable — starting at most
 *      ONE task, so a retry cannot stampede a real provider.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const application = await getWorkforceApplication();
    const snapshot = await application.commands.snapshot(id as MissionId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return workforceErrorResponse(error, "Failed to read the mission");
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { startNext?: boolean; waitTimeoutMs?: number } | null;

    const application = await getWorkforceApplication();
    const wait =
      typeof body?.waitTimeoutMs === "number" && body.waitTimeoutMs > 0 ? { waitTimeoutMs: body.waitTimeoutMs } : {};
    // startNext:false reconciles the mission WITHOUT dispatching, for a caller
    // that wants to look before it runs anything.
    const advanced =
      body?.startNext === false
        ? await application.commands.advance(id as MissionId, { startNext: false })
        : await application.commands.drain(id as MissionId, wait);

    const snapshot = await application.commands.snapshot(id as MissionId);
    return NextResponse.json({ ...snapshot, changes: advanced.changes });
  } catch (error) {
    return workforceErrorResponse(error, "Failed to advance the mission");
  }
}
