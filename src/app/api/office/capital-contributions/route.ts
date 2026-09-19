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

/**
 * Capital contributions are recorded in "رأس المال" ONLY.
 * They never create OfficeExpense rows and never touch office expense totals:
 * partner-paid spending (e.g. صيانة سيارة، ستائر، أدوات) is a capital matter,
 * not an office expense — the two ledgers must stay fully separate.
 *
 * fundFlow meaning:
 *  - STILL_IN_TREASURY: the money physically sits in the office treasury →
 *    counts toward the treasury balance (cashCapital).
 *  - SPENT_ALREADY (default): the partner spent the money directly on
 *    something specific → tracked historically, NOT counted in the treasury.
 */
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

  const contrib = await prisma.capitalContribution.create({
    data: {
      partnerId: body.partnerId,
      amount,
      type: body.type,
      fundFlow: fundFlow as any,
      description: body.description || null,
      date,
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "CapitalContribution", entityId: contrib.id },
  });

  return NextResponse.json(contrib, { status: 201 });
}
