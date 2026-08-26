import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET invoices with optional filters
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rebound = await prisma.business.findUnique({ where: { slug: "rebound" } });
  if (!rebound) return NextResponse.json({ error: "REBOUND not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const month = searchParams.get("month");
  const year = searchParams.get("year");

  const where: Record<string, unknown> = {
    subscription: { businessId: rebound.id },
  };
  if (status) where.status = status;
  if (month) where.month = parseInt(month);
  if (year) where.year = parseInt(year);

  const invoices = await prisma.subscriptionInvoice.findMany({
    where,
    include: { subscription: { include: { client: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  return NextResponse.json(invoices);
}

// POST pay an invoice (full or partial)
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { invoiceId, amount, note } = body;

  if (!invoiceId || !amount) {
    return NextResponse.json({ error: "invoiceId and amount required" }, { status: 400 });
  }

  const invoice = await prisma.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: { subscription: true },
  });

  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const remaining = invoice.amount - invoice.paidAmount;
  const payAmount = Math.min(parseFloat(amount), remaining);
  const newPaid = invoice.paidAmount + payAmount;
  const newStatus = newPaid >= invoice.amount ? "PAID" : "PARTIAL";

  // Update invoice
  const updatedInvoice = await prisma.subscriptionInvoice.update({
    where: { id: invoiceId },
    data: {
      paidAmount: newPaid,
      status: newStatus as "PAID" | "PARTIAL",
      paidDate: new Date(),
    },
    include: { subscription: { include: { client: true } } },
  });

  // Auto-create PoolTransaction IN for payment
  await prisma.poolTransaction.create({
    data: {
      businessId: invoice.subscription.businessId,
      amountSAR: payAmount,
      type: "IN",
      date: new Date(),
      note: note || `Subscription payment — Invoice ${invoice.month}/${invoice.year}`,
    },
  });

  // Log activity
  const userId = session.userId;
  if (userId) {
    await prisma.activityLog.create({
      data: {
        userId,
        action: "UPDATE",
        entityType: "SubscriptionInvoice",
        entityId: invoiceId,
      },
    });
  }

  return NextResponse.json(updatedInvoice);
}
