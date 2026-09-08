import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const contributions = await prisma.capitalContribution.findMany({
    include: { partner: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(contributions);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.partnerId || !body.amount || !body.type || !body.date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const fundFlow: string = body.fundFlow || "SPENT_ALREADY";
  const amount = parseFloat(body.amount);
  const date = new Date(body.date);
  const description = body.description || null;

  // Create the capital contribution
  const contrib = await prisma.capitalContribution.create({
    data: {
      partnerId: body.partnerId,
      amount,
      type: body.type,
      fundFlow: fundFlow as any,
      description,
      date,
    },
  });

  // If SPENT_ALREADY — auto-create paired OfficeExpense so treasury balance stays net-zero
  let linkedExpenseId: string | null = null;
  if (fundFlow === "SPENT_ALREADY") {
    const partner = await prisma.partner.findUnique({ where: { id: body.partnerId }, select: { name: true } });
    const expense = await prisma.officeExpense.create({
      data: {
        description: description || `مساهمة رأس مال — ${partner?.name || "شريك"}`,
        cost: amount,
        category: "VARIABLE",
        name: partner?.name || "شريك",
        notes: `مساهمة رأس مال رقم ${contrib.id} — مصروف بالفعل (fundFlow: SPENT_ALREADY)`,
        date,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      },
    });
    linkedExpenseId = expense.id;
    // Update the contribution with the linked expense ID
    await prisma.capitalContribution.update({
      where: { id: contrib.id },
      data: { linkedExpenseId: expense.id },
    });
  }

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "CapitalContribution", entityId: contrib.id },
  });

  return NextResponse.json({ ...contrib, linkedExpenseId }, { status: 201 });
}
