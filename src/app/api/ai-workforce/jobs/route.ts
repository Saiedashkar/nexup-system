import { NextRequest, NextResponse } from "next/server";
import { getControlCore, getWorkforceBootstrap, resolveBusinessScope } from "@/modules/ai-workforce";
import { requireWorkforceActor } from "@/modules/ai-workforce/adapters/api-guard";
import { workforceErrorResponse } from "@/modules/ai-workforce/adapters/api-response";
import { createExecutionContext, createServiceIdentity } from "@/modules/ai-workforce/core/execution-context";
import { TRIGGER_TYPES, type JsonObject, type TriggerType } from "@/modules/ai-workforce/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maps a job outcome onto an HTTP status without leaking internals. */
function statusFor(outcome: { status: string; error?: { code: string } }): number {
  if (outcome.status === "COMPLETED") return 200;
  if (outcome.status === "WAITING_APPROVAL") return 202;

  const code = outcome.error?.code ?? "";
  if (code === "PERMISSION_DENIED" || code === "SCOPE_DENIED" || code === "SCOPE_MISSING") return 403;
  if (
    code === "INVALID_INPUT" ||
    code === "TOOL_NOT_FOUND" ||
    code === "TOOL_DISABLED" ||
    code === "CAPABILITY_AMBIGUOUS" ||
    code === "CRITICAL_AUTONOMY_FORBIDDEN"
  ) {
    return 400;
  }
  return 422;
}

/**
 * GET /api/ai-workforce/jobs
 * Recent jobs held by this instance.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const core = getControlCore();
    const jobs = await core.jobs.listJobs(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20);

    return NextResponse.json({ count: jobs.length, jobs, persistence: getWorkforceBootstrap().persistence });
  } catch (error) {
    console.error("[ai-workforce] jobs list failed:", error);
    return NextResponse.json({ error: "Failed to list workforce jobs" }, { status: 500 });
  }
}

/**
 * POST /api/ai-workforce/jobs
 *
 * The only Phase 1A entry point that can execute a capability:
 *
 *   Human (this request) → Job → Runtime → Capability Lookup → Policy Check
 *   → Approval Gate → Tool Execution → Result → Audit / Run Record
 *
 * The actor is taken from the session, the business scope from the request —
 * never from model output.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireWorkforceActor();
    if (guard.kind === "denied") return guard.response;

    const body = (await request.json().catch(() => null)) as
      | { capability?: string; input?: JsonObject; businessId?: string; businessSlug?: string; trigger?: TriggerType }
      | null;

    if (!body || typeof body.capability !== "string" || body.capability.trim() === "") {
      return NextResponse.json({ error: "capability is required" }, { status: 400 });
    }
    if (body.input !== undefined && (typeof body.input !== "object" || body.input === null || Array.isArray(body.input))) {
      return NextResponse.json({ error: "input must be an object" }, { status: 400 });
    }

    const business = await resolveBusinessScope({ businessId: body.businessId, slug: body.businessSlug });
    if ((body.businessId || body.businessSlug) && !business) {
      return NextResponse.json({ error: "Unknown business scope" }, { status: 400 });
    }

    const source: TriggerType = TRIGGER_TYPES.includes(body.trigger as TriggerType) ? (body.trigger as TriggerType) : "MANUAL";

    const core = getControlCore();
    const context = createExecutionContext({
      serviceIdentity: createServiceIdentity(core.runtime.kind),
      actor: guard.actor,
      business,
      // A MANUAL trigger is a signed-in human: their presence IS the approval
      // for HIGH capabilities (the Phase 1A policy). An autonomous trigger
      // (EVENT/AGENT/SCHEDULE/WEBHOOK/SYSTEM) can lean on nothing, so a
      // HIGH-risk capability parks in WAITING_APPROVAL and waits for a decision.
      source,
      autonomy: source === "MANUAL" ? "HUMAN" : "AGENT",
      ids: core.ids,
      now: core.now(),
    });

    const job = await core.jobs.create({ capability: body.capability, input: body.input, context });
    const outcome = await core.jobs.run(job.id);

    // A compact trace is returned so the caller can see exactly what the engine
    // decided — this is the manual-job path of the execution model.
    const events = await core.recorder.listJobEvents(job.id, 200);
    const approvals = job.id ? await core.approvalService.listForJob(job.id, 5) : [];

    return NextResponse.json(
      {
        job: outcome.job,
        status: outcome.status,
        output: outcome.output ?? null,
        error: outcome.error ?? null,
        runtime: { kind: core.runtime.kind, aiProvider: "NONE", persistence: getWorkforceBootstrap().persistence },
        approval: outcome.job.approvalId
          ? (approvals.find((record) => record.id === outcome.job.approvalId) ?? null)
          : null,
        pendingApproval: outcome.status === "WAITING_APPROVAL" ? (outcome.job.approvalId ?? null) : null,
        trace: events,
      },
      { status: statusFor({ status: outcome.status, error: outcome.error }) },
    );
  } catch (error) {
    return workforceErrorResponse(error, "Failed to run workforce job");
  }
}
