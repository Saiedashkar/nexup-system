import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const businessSlug = searchParams.get("businessSlug");

    const where: Record<string, unknown> = {};

    if (businessSlug) {
      const business = await prisma.business.findUnique({ where: { slug: businessSlug } });
      if (business) where.businessId = business.id;
    } else if (session.role !== "SUPER_ADMIN") {
      where.businessId = session.businessId;
    }

    const services = await prisma.serviceType.findMany({
      where,
      orderBy: { name: "asc" },
    });
    return NextResponse.json(services);
  } catch (error) {
    console.error("Failed to fetch services:", error);
    return NextResponse.json({ error: "Failed to fetch services" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const body = await request.json();
    const { name, isCustom, businessSlug } = body;

    if (!name) return NextResponse.json({ error: "Service name is required" }, { status: 400 });

    // Resolve businessId from slug or session
    let businessId = session.businessId;
    if (businessSlug && session.role === "SUPER_ADMIN") {
      const business = await prisma.business.findUnique({ where: { slug: businessSlug } });
      if (business) businessId = business.id;
    }

    if (!businessId) return NextResponse.json({ error: "Business ID required" }, { status: 400 });

    const service = await prisma.serviceType.create({
      data: {
        businessId,
        name,
        isCustom: isCustom || false,
      },
    });

    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    console.error("Failed to create service:", error);
    return NextResponse.json({ error: "Failed to create service" }, { status: 500 });
  }
}
