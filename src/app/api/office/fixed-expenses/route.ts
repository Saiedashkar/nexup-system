import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import {
  convertSpendToFixedExpense,
  createFixedExpense,
  CapitalValidationError,
} from "@/lib/capital";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const defs = await prisma.fixedExpense.findMany({
    include: { officeExpenses: { orderBy: { date: "desc" }, take: 3 } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(defs);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  try {
    // Conversion path: turn an existing capital spend into a recurring expense.
    // The definition always starts the month AFTER the spend → no double count.
    if (body.action === "convert" && body.spendId) {
      const { def } = await convertSpendToFixedExpense({
        spendId: body.spendId,
        recurringAmount: Number(body.recurringAmount),
        frequency: body.frequency || "MONTHLY",
        name: body.name,
        userId: session.userId,
      });
      return NextResponse.json(def, { status: 201 });
    }

    // Independent recurring expense (not born from a capital spend).
    const def = await createFixedExpense({
      name: body.name,
      description: body.description,
      amount: Number(body.amount),
      frequency: body.frequency || "MONTHLY",
      startDate: body.startDate,
      userId: session.userId,
    });
    return NextResponse.json(def, { status: 201 });
  } catch (e) {
    if (e instanceof CapitalValidationError) {
      const status = e.code === "ALREADY_CONVERTED" ? 409 : 400;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    throw e;
  }
}
