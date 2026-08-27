import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const dealType = searchParams.get("dealType") || "";

  const where: Record<string, unknown> = { businessId: biz.id };
  if (dealType) where.dealType = dealType;
  if (search) {
    where.OR = [
      { seekerName: { contains: search, mode: "insensitive" } },
      { property: { ownerName: { contains: search, mode: "insensitive" } } },
      { property: { location: { contains: search, mode: "insensitive" } } },
    ];
  }

  const deals = await prisma.deal.findMany({
    where,
    include: { property: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(deals);
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const {
    propertyId, dealType, dealValue, totalCommission,
    externalOfficeAmount, personalAmount, abomazenNetAmount,
    date, seekerName, seekerPhone, notes,
  } = body;

  if (!dealType || totalCommission === undefined || totalCommission === null || abomazenNetAmount === undefined || abomazenNetAmount === null) {
    return NextResponse.json({ error: "يجب إدخال نوع الصفقة وإجمالي العمولة وصافي ABOMAZEN" }, { status: 400 });
  }

  const deal = await prisma.deal.create({
    data: {
      businessId: biz.id,
      propertyId: propertyId || null,
      dealType,
      dealValue: dealValue ? parseFloat(dealValue) : null,
      totalCommission: parseFloat(totalCommission),
      externalOfficeAmount: externalOfficeAmount ? parseFloat(externalOfficeAmount) : null,
      personalAmount: personalAmount ? parseFloat(personalAmount) : null,
      abomazenNetAmount: parseFloat(abomazenNetAmount),
      date: date ? new Date(date) : new Date(),
      seekerName: seekerName || null,
      seekerPhone: seekerPhone || null,
      notes: notes || null,
    },
    include: { property: true },
  });

  // Auto-create PoolTransaction IN for ABOMAZEN net amount
  if (abomazenNetAmount && parseFloat(abomazenNetAmount) > 0) {
    await prisma.poolTransaction.create({
      data: {
        businessId: biz.id,
        dealId: deal.id,
        amountSAR: parseFloat(abomazenNetAmount), // field name is amountSAR but value is EGP for ABOMAZEN
        type: "IN",
        date: deal.date,
        note: `صفقة ${dealType === "RENT" ? "إيجار" : "بيع"} — صافي ABOMAZEN`,
      },
    });
  }

  if (session.userId) {
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "CREATE", entityType: "Deal", entityId: deal.id },
    });
  }

  return NextResponse.json(deal, { status: 201 });
}
