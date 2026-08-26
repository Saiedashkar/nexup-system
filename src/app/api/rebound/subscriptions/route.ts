import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET all subscriptions for REBOUND
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rebound = await prisma.business.findUnique({ where: { slug: "rebound" } });
  if (!rebound) return NextResponse.json({ error: "REBOUND not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";

  const where: Record<string, unknown> = { businessId: rebound.id };
  if (status) where.status = status;

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: { client: true, invoices: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(subscriptions);
}

// POST create a new subscription
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rebound = await prisma.business.findUnique({ where: { slug: "rebound" } });
  if (!rebound) return NextResponse.json({ error: "REBOUND not found" }, { status: 404 });

  const body = await request.json();
  const { clientId, clientPhone, clientName, services, monthlyFee, startDate, billingDay, notes } = body;

  // Find or create client
  let clientIdFinal = clientId;
  if (!clientIdFinal && clientPhone) {
    const existing = await prisma.client.findUnique({
      where: { businessId_phone: { businessId: rebound.id, phone: clientPhone } },
    });
    if (existing) {
      clientIdFinal = existing.id;
    } else {
      const newClient = await prisma.client.create({
        data: { businessId: rebound.id, phone: clientPhone, name: clientName || "Unknown" },
      });
      clientIdFinal = newClient.id;
    }
  }

  if (!clientIdFinal || !monthlyFee || !startDate) {
    return NextResponse.json({ error: "Client, monthlyFee, and startDate are required" }, { status: 400 });
  }

  // Create subscription
  const subscription = await prisma.subscription.create({
    data: {
      clientId: clientIdFinal,
      businessId: rebound.id,
      services: JSON.stringify(services || []),
      monthlyFee: parseFloat(monthlyFee),
      startDate: new Date(startDate),
      billingDay: billingDay || new Date(startDate).getDate(),
      notes: notes || null,
    },
    include: { client: true, invoices: true },
  });

  // Generate first invoice immediately
  const start = new Date(startDate);
  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      subscriptionId: subscription.id,
      month: start.getMonth() + 1,
      year: start.getFullYear(),
      amount: parseFloat(monthlyFee),
      status: "UNPAID",
      paidAmount: 0,
    },
  });

  subscription.invoices = [invoice];

  // Log activity
  const userId = session.userId;
  if (userId) {
    await prisma.activityLog.create({
      data: {
        userId,
        action: "CREATE",
        entityType: "Subscription",
        entityId: subscription.id,
      },
    });
  }

  return NextResponse.json(subscription, { status: 201 });
}
