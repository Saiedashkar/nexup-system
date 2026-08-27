import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const biz = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (session.role !== "SUPER_ADMIN" && !session.canAccessAbomazen) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [deals, properties, expenses, profitTransfers, poolTransactions] = await Promise.all([
    prisma.deal.findMany({ where: { businessId: biz.id }, include: { property: true }, orderBy: { date: "desc" } }),
    prisma.property.findMany({ where: { businessId: biz.id } }),
    prisma.expense.findMany({ where: { businessId: biz.id }, select: { cost: true } }),
    prisma.profitTransfer.findMany({ where: { businessId: biz.id }, select: { amount: true } }),
    prisma.poolTransaction.findMany({ where: { businessId: biz.id }, select: { type: true, amountSAR: true } }),
  ]);

  // Pool balance
  let poolBalance = 0;
  for (const t of poolTransactions) {
    if (t.type === "IN") poolBalance += Number(t.amountSAR);
    else poolBalance -= Number(t.amountSAR);
  }

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.cost), 0);
  const totalTransferred = profitTransfers.reduce((s, t) => s + Number(t.amount), 0);
  const availableBalance = poolBalance - totalExpenses - totalTransferred;

  // Stats
  const now = new Date();
  const thisMonth = deals.filter(d => {
    const dd = new Date(d.date);
    return dd.getMonth() === now.getMonth() && dd.getFullYear() === now.getFullYear();
  });

  const availableProperties = properties.filter(p => p.status === "AVAILABLE").length;

  // Recent 5 deals
  const recentDeals = deals.slice(0, 5).map(d => ({
    id: d.id,
    dealType: d.dealType,
    date: d.date,
    abomazenNetAmount: d.abomazenNetAmount,
    propertyName: d.property ? `${d.property.propertyType} — ${d.property.location}` : "صفقة سريعة",
  }));

  return NextResponse.json({
    availableBalance,
    totalDealsThisMonth: thisMonth.length,
    availableProperties,
    totalDeals: deals.length,
    recentDeals,
  });
}
