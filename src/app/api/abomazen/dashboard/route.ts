import { NextResponse } from "next/server";
import { getCurrentSession, canAccessBusiness } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!canAccessBusiness(session, "abomazen")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const biz = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const [
    totalDeals,
    dealsThisMonth,
    availableProperties,
    totalProperties,
    dealAgg,
    poolIn,
    poolOut,
    expenseAgg,
    totalTransferred,
    recentDeals,
    monthlyDealsAgg,
  ] = await Promise.all([
    prisma.deal.count({ where: { businessId: biz.id } }),
    prisma.deal.count({
      where: {
        businessId: biz.id,
        date: {
          gte: new Date(currentYear, currentMonth, 1),
          lt: new Date(currentYear, currentMonth + 1, 1),
        },
      },
    }),
    prisma.property.count({ where: { businessId: biz.id, status: "AVAILABLE" } }),
    prisma.property.count({ where: { businessId: biz.id } }),
    prisma.deal.aggregate({ where: { businessId: biz.id }, _sum: { abomazenNetAmount: true, totalCommission: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: biz.id, type: "IN" }, _sum: { amountSAR: true } }),
    prisma.poolTransaction.aggregate({ where: { businessId: biz.id, type: "OUT" }, _sum: { amountSAR: true } }),
    prisma.expense.aggregate({ where: { businessId: biz.id }, _sum: { cost: true } }),
    prisma.profitTransfer.aggregate({ where: { businessId: biz.id }, _sum: { amount: true } }),
    prisma.deal.findMany({
      where: { businessId: biz.id },
      include: { property: { select: { propertyType: true, location: true } } },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM date)::int as month, EXTRACT(YEAR FROM date)::int as year,
             SUM("abomazenNetAmount")::float as revenue, COUNT(*)::int as deals
      FROM "Deal"
      WHERE "businessId" = ${biz.id}
        AND date >= ${new Date(currentYear, currentMonth - 5, 1)}
      GROUP BY EXTRACT(MONTH FROM date), EXTRACT(YEAR FROM date)
      ORDER BY year DESC, month DESC
    `,
  ]);

  const poolBalance = Number(poolIn._sum.amountSAR ?? 0) - Number(poolOut._sum.amountSAR ?? 0);
  const totalExpenses = Number(expenseAgg._sum.cost ?? 0);
  const totalTransferredVal = Number(totalTransferred._sum.amount ?? 0);
  const availableBalance = poolBalance - totalExpenses - totalTransferredVal;
  const totalRevenue = Number(dealAgg._sum.abomazenNetAmount ?? 0);

  const recentDealsFormatted = recentDeals.map(d => ({
    id: d.id,
    dealType: d.dealType,
    date: d.date,
    abomazenNetAmount: d.abomazenNetAmount,
    propertyName: d.property ? `${d.property.propertyType} — ${d.property.location}` : "صفقة سريعة",
  }));

  // Monthly revenue for charts
  const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    const found = (monthlyDealsAgg as any[]).find(r => r.month === month && r.year === year);
    monthlyRevenue.push({
      month: monthNames[d.getMonth()],
      revenue: found ? found.revenue : 0,
      deals: found ? found.deals : 0,
    });
  }

  return NextResponse.json({
    availableBalance,
    totalDealsThisMonth: dealsThisMonth,
    availableProperties,
    totalDeals,
    totalRevenue,
    totalExpenses,
    totalProperties,
    recentDeals: recentDealsFormatted,
    monthlyRevenue,
  });
}
