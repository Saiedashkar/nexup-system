import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import {
  updateCapitalSpend,
  softDeleteCapitalSpend,
  CapitalValidationError,
} from "@/lib/capital";

export const runtime = "nodejs";

/**
 * Edit an existing capital spend in place. Increasing the amount is guarded
 * against the available balance; attribution/date/category/etc are free edits.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  try {
    const updated = await updateCapitalSpend({
      id,
      userId: session.userId,
      amount: body.amount !== undefined && body.amount !== "" ? Number(body.amount) : undefined,
      date: body.date ? new Date(body.date) : undefined,
      category: body.category,
      description: body.description,
      notes: body.notes,
      reference: body.reference,
      contributionId: body.contributionId,
      spendType: body.spendType,
      recipientPartnerId: body.recipientPartnerId,
      recipientName: body.recipientName,
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "SPEND_NOT_FOUND" || e.code === "CONTRIBUTION_NOT_FOUND" ? 404 : e.code === "INSUFFICIENT_CAPITAL" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}

/**
 * SOFT delete — the amount automatically returns to Available Capital via the
 * derived calculation. If the spend was converted to a recurring FixedExpense,
 * the first call returns 409 RECURRING_LINKED explaining what is linked; the
 * caller may retry with ?force=1, which also deactivates the recurring
 * definition (generated OfficeExpense history is never destroyed).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  try {
    await softDeleteCapitalSpend({ id, userId: session.userId, force });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "SPEND_NOT_FOUND" ? 404 : e.code === "RECURRING_LINKED" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}
