import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const clients = await prisma.client.findMany({
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
    return NextResponse.json({ error: "فشل جلب العملاء" }, { status: 500 });
  }
}
