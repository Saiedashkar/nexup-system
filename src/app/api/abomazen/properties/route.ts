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
  const status = searchParams.get("status") || "";

  const where: Record<string, unknown> = { businessId: biz.id };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { ownerName: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
      { propertyType: { contains: search, mode: "insensitive" } },
    ];
  }

  const properties = await prisma.property.findMany({
    where,
    include: { deals: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(properties);
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { ownerName, ownerPhone, propertyType, location, listingType, askingPrice, status, notes } = body;

  if (!ownerName || !propertyType || !location) {
    return NextResponse.json({ error: "يجب إدخال اسم المالك ونوع العقار والموقع" }, { status: 400 });
  }

  const property = await prisma.property.create({
    data: {
      businessId: biz.id,
      ownerName,
      ownerPhone: ownerPhone || null,
      propertyType,
      location,
      listingType: listingType || "RENT",
      askingPrice: askingPrice ? parseFloat(askingPrice) : null,
      status: status || "AVAILABLE",
      notes: notes || null,
    },
  });

  if (session.userId) {
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "CREATE", entityType: "Property", entityId: property.id },
    });
  }

  return NextResponse.json(property, { status: 201 });
}
