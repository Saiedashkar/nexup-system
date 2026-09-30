import { NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai-workforce/health
 *
 * Reports the state of the control core and where its state actually lives.
 * Read-only: it never executes a tool.
 */
export async function GET() {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const core = getControlCore();
    const bootstrap = getWorkforceBootstrap();
    const description = core.runtime.describe();

    const [jobs, runs, pending] = await Promise.all([
      core.jobs.listJobs(5),
      core.recorder.listRuns(5),
      core.approvalService.listPending(20),
    ]);

    return NextResponse.json({
      commandPlane: "NEXUP COMMAND",
      module: "AI WORKFORCE",
      phase: "1B",
      status: "OPERATIONAL",
      runtime: description,
      persistence: {
        kind: bootstrap.persistence,
        reason: bootstrap.reason,
        database: bootstrap.database ?? null,
      },
      registry: {
        total: core.registry.size(),
        enabled: core.registry.listEnabled().length,
      },
      isolation: {
        productionImpact: "ISOLATED",
        legacyDatabaseWrites: "NONE",
        legacySchemaChanges: "NONE",
        migrationsAppliedToProduction: "NONE",
        externalCalls: "NONE",
        aiProvider: "NONE",
      },
      recent: { jobs: jobs.length, runs: runs.length, pendingApprovals: pending.length },
      actor: {
        userId: guard.actor.userId,
        name: guard.actor.name,
        role: guard.actor.role,
        permissions: guard.actor.permissionTokens,
        businesses: guard.actor.accessibleBusinessSlugs,
      },
    });
  } catch (error) {
    console.error("[ai-workforce] health failed:", error);
    return NextResponse.json({ error: "AI Workforce health check failed" }, { status: 500 });
  }
}
