import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const where: Record<string, unknown> = {};
    if (session.role !== "SUPER_ADMIN") {
      where.businessId = session.businessId;
    }

    const clients = await prisma.client.findMany({
      where,
      include: {
        projectRecords: {
          select: { id: true, projectName: true, totalPrice: true, workStatus: true, paymentStatus: true, date: true },
          orderBy: { date: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(clients);
  } catch (error) {
    console.error("Failed to fetch clients:", error);
    return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
  }
}
