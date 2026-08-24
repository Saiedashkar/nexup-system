import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session || session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get all businesses with counts
    const businesses = await prisma.business.findMany({
      include: {
        _count: {
          select: {
            clients: true,
            projectRecords: true,
            poolTransactions: true,
            expenses: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    // Aggregate stats across all businesses
    const [totalClients, totalProjects, revenueResult, expenseResult] = await Promise.all([
      prisma.client.count(),
      prisma.projectRecord.count(),
      prisma.poolTransaction.aggregate({
        where: { type: "IN" },
        _sum: { amountSAR: true },
      }),
      prisma.expense.aggregate({
        _sum: { cost: true },
      }),
    ]);

    // Convert SAR to EGP for NEXUP business (use approximate rate if needed)
    // For now, we'll show raw amounts
    const totalRevenue = Number(revenueResult._sum.amountSAR ?? 0);
    const totalExpenses = Number(expenseResult._sum.cost ?? 0);

    return NextResponse.json({
      businesses,
      stats: {
        totalRevenue,
        totalExpenses,
        totalClients,
        totalProjects,
      },
    });
  } catch (error) {
    console.error("Failed to fetch office stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
