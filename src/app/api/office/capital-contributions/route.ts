import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createCapitalContribution,
  CapitalValidationError,
  parseDateOrThrow,
} from "@/lib/capital";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Active records only — soft-deleted contributions must never reappear
  // in the UI after deletion (the client extension also filters this;
  // explicit here for defense in depth).
  const contributions = await prisma.capitalContribution.findMany({
    where: { deletedAt: null },
    include: { partner: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(contributions);
}

/**
 * Capital contributions are recorded in "رأس المال" ONLY.
 * They never create OfficeExpense rows and never touch office expense totals:
 * partner-paid spending (e.g. صيانة سيارة، ستائر، أدوات) is a capital matter,
 * not an office expense — the two ledgers must stay fully separate.
 *
 * fundFlow meaning (CASH only — an in-kind ASSET contribution is never cash):
 *  - STILL_IN_TREASURY: the money physically sits in the office treasury →
 *    it is the part that can be spent, and stays spendable until it is.
 *  - SPENT_ALREADY (default): the partner spent the money directly on
 *    something specific → it counts in the total funding, never as cash.
 *
 * The write goes through `createCapitalContribution` — the SAME service the
 * ledger, the overspend guards and the tests use. This route used to insert
 * the row itself with its own validation, so the API and the service could
 * disagree about what a valid contribution even is.
 */
export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "طلب غير صالح — لم يُسجّل شيء." }, { status: 400 });
  }

  // Field-by-field, so the UI can always show WHICH field is missing instead
  // of one opaque 400 that made a save look like nothing happened.
  if (!body.partnerId) return NextResponse.json({ error: "MISSING_PARTNER", message: "اختر الممول" }, { status: 400 });
  if (!body.amount) return NextResponse.json({ error: "MISSING_AMOUNT", message: "أدخل المبلغ" }, { status: 400 });
  if (!body.type) return NextResponse.json({ error: "MISSING_TYPE", message: "اختر نوع المساهمة (نقدي / أصل عيني)" }, { status: 400 });
  if (!body.date) return NextResponse.json({ error: "MISSING_DATE", message: "أدخل تاريخ الاستلام" }, { status: 400 });

  try {
    const contrib = await createCapitalContribution({
      partnerId: String(body.partnerId),
      amount: Number(body.amount),
      type: String(body.type),
      fundFlow: body.fundFlow ? String(body.fundFlow) : undefined,
      date: parseDateOrThrow(body.date, "تاريخ الاستلام"),
      description: body.description ? String(body.description) : null,
      reference: body.reference ? String(body.reference) : null,
      userId: session.userId,
    });
    return NextResponse.json(contrib, { status: 201 });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: 400 });
    }
    throw e;
  }
}
