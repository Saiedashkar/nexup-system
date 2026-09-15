import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOrReviveClient } from "@/lib/soft-delete";

export const runtime = "nodejs";

// GET all subscriptions for a business (pass ?slug=nexup or ?slug=rebound)
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug") || "rebound";

  const business = await prisma.business.findUnique({ where: { slug } });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  // Access check
  if (session.role !== "SUPER_ADMIN") {
    if (slug === "nexup" && !session.canAccessNexup) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (slug === "rebound" && !session.canAccessRebound) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (slug === "abomazen" && !session.canAccessAbomazen) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = searchParams.get("status") || "";

  const where: Record<string, unknown> = { businessId: business.id };
  if (status) where.status = status;

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: { client: true, invoices: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(subscriptions);
}

// POST create a new subscription (pass businessSlug in body)
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { clientId, clientPhone, clientName, services, monthlyFee, startDate, billingDay, notes, businessSlug } = body;

  const slug = businessSlug || "rebound";
  const business = await prisma.business.findUnique({ where: { slug } });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  // Find or create client (revives a previously soft-deleted client with the same phone)
  let clientIdFinal = clientId;
  if (!clientIdFinal && clientPhone) {
    const resolved = await findOrReviveClient(business.id, clientPhone, clientName || "Unknown");
    clientIdFinal = resolved.id;
  }

  if (!clientIdFinal || !monthlyFee || !startDate) {
    return NextResponse.json({ error: "Client, monthlyFee, and startDate are required" }, { status: 400 });
  }

  // Create subscription
  const subscription = await prisma.subscription.create({
    data: {
      clientId: clientIdFinal,
      businessId: business.id,
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
