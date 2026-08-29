import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = await prisma.officeAllocationSetting.findMany({
    include: { business: true },
    orderBy: { effectiveDate: "desc" },
  });
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.businessId || body.allocationPct === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const setting = await prisma.officeAllocationSetting.create({
    data: {
      businessId: body.businessId,
      allocationPct: parseFloat(body.allocationPct),
      effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : new Date(),
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "OfficeAllocationSetting", entityId: setting.id },
  });

  return NextResponse.json(setting, { status: 201 });
}
