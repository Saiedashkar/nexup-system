import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { softDeleteRecord } from "@/lib/soft-delete";
import {
  updateCapitalContribution,
  softDeleteCapitalContribution,
  CapitalValidationError,
} from "@/lib/capital";

export const runtime = "nodejs";

/**
 * Edit an existing capital contribution IN PLACE (never creates a new row).
 * Amount/type changes are guarded so Available Capital can never go negative;
 * other fields (funder/date/description/reference/fundFlow) are free edits.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Centralized Office Finance policy — same gate as every other capital
  // mutation endpoint (SUPER_ADMIN or canAccessOfficeFinanceFull flag).
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();

  try {
    const updated = await updateCapitalContribution({
      id,
      userId: session.userId,
      partnerId: body.partnerId,
      amount: body.amount !== undefined && body.amount !== "" ? Number(body.amount) : undefined,
      type: body.type,
      date: body.date ? new Date(body.date) : undefined,
      description: body.description,
      reference: body.reference,
      fundFlow: body.fundFlow,
    });

    // Legacy cleanup: if this record still has a paired OfficeExpense from the old
    // behaviour (capital → auto expense), detach it so it stops double-counting.
    // The old paired row is soft-deleted and can be restored from the recycle bin.
    if (updated.linkedExpenseId) {
      const linked = await prisma.officeExpense.findUnique({ where: { id: updated.linkedExpenseId } }).catch(() => null);
      if (linked && linked.notes?.includes(updated.id)) {
        await softDeleteRecord("OfficeExpense", linked.id, session.userId).catch(() => {});
      }
      await prisma.capitalContribution.update({ where: { id }, data: { linkedExpenseId: null } });
    }

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "CONTRIBUTION_NOT_FOUND" ? 404 : e.code === "INSUFFICIENT_CAPITAL" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}

/**
 * SOFT delete (recycle-bin recoverable). Refused with a clear Arabic error
 * when deleting would make Available Capital negative (money already spent
 * from that pool) — historical balances are never corrupted.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Centralized Office Finance policy — same gate as every other capital
  // mutation endpoint (SUPER_ADMIN or canAccessOfficeFinanceFull flag).
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  try {
    await softDeleteCapitalContribution({ id, userId: session.userId });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "CONTRIBUTION_NOT_FOUND" ? 404 : e.code === "INSUFFICIENT_CAPITAL" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}
