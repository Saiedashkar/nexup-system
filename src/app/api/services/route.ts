import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const services = await prisma.serviceType.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(services);
  } catch (error) {
    console.error("Failed to fetch services:", error);
    return NextResponse.json({ error: "فشل جلب الخدمات" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, isCustom } = body;

    if (!name) return NextResponse.json({ error: "اسم الخدمة مطلوب" }, { status: 400 });

    const service = await prisma.serviceType.create({
      data: { name, isCustom: isCustom || false },
    });

    return NextResponse.json(service, { status: 201 });
  } catch (error) {
    console.error("Failed to create service:", error);
    return NextResponse.json({ error: "فشل إنشاء الخدمة" }, { status: 500 });
  }
}
