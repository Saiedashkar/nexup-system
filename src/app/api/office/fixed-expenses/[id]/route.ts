import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { deactivateFixedExpense, CapitalValidationError } from "@/lib/capital";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** List generated occurrences for one recurring definition. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const def = await prisma.fixedExpense.findUnique({
    where: { id },
    include: { officeExpenses: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
  });
  if (!def) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(def);
}

/** Soft-deletes the recurring definition; generated OfficeExpense rows remain. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  try {
    await deactivateFixedExpense(id, session.userId);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "FIXED_EXPENSE_NOT_FOUND" ? 404 : 400 });
    }
    throw e;
  }
}
