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

  const contrib = await prisma.capitalContribution.create({
    data: {
      partnerId: body.partnerId,
      amount: parseFloat(body.amount),
      type: body.type,
      description: body.description || null,
      date: new Date(body.date),
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "CapitalContribution", entityId: contrib.id },
  });

  return NextResponse.json(contrib, { status: 201 });
}
