import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import {
  createCapitalSpend,
  CapitalValidationError,
  parseDateOrThrow,
} from "@/lib/capital";

export const runtime = "nodejs";

/**
 * Spending FROM the capital fund. Creates a CapitalSpend row only —
 * it never touches OfficeExpense totals or the operating treasury.
 * Cannot exceed the available capital balance (overspend → 409).
 */
export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  for (const field of ["amount", "date", "description"]) {
    if (!body[field]) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // Category is required only for EXPENSE. The service defaults it for
  // PERSON_WITHDRAWAL ("سحب رأس مال") and CUSTODY ("عهدة") — the UI hides
  // the field for those types, so demanding it here made every non-EXPENSE
  // save fail with an opaque 400 before validation ever ran.
  if (body.spendType === "EXPENSE" && !body.category) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const spend = await createCapitalSpend({
      amount: Number(body.amount),
      date: parseDateOrThrow(body.date, "تاريخ الصرف"),
      category: String(body.category),
      description: String(body.description),
      notes: body.notes || null,
      reference: body.reference || null,
      contributionId: body.contributionId || null,
      spendType: body.spendType,
      recipientPartnerId: body.recipientPartnerId || null,
      recipientName: body.recipientName || null,
      userId: session.userId,
    });
    return NextResponse.json(spend, { status: 201 });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "INSUFFICIENT_CAPITAL" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}
