import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const abomazen = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!abomazen) return NextResponse.json({ error: "ABOMAZEN not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const workStatus = searchParams.get("workStatus") || "";
  const paymentStatus = searchParams.get("paymentStatus") || "";
  const clientType = searchParams.get("clientType") || "";

  const where: Record<string, unknown> = { businessId: abomazen.id };
  if (clientType) where.clientType = clientType;
  if (workStatus) where.workStatus = workStatus;
  if (paymentStatus) where.paymentStatus = paymentStatus;
  if (search) {
    where.OR = [
      { projectName: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
      { client: { phone: { contains: search } } },
      { designerName: { contains: search, mode: "insensitive" } },
    ];
  }

  const projects = await prisma.projectRecord.findMany({
    where,
    include: {
      client: true,
      designer: true,
      services: true,
      payments: true,
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const abomazen = await prisma.business.findUnique({ where: { slug: "abomazen" } });
  if (!abomazen) return NextResponse.json({ error: "ABOMAZEN not found" }, { status: 404 });

  const body = await request.json();
  const {
    clientId, clientPhone, clientName, projectName, date,
    customServiceText, totalPrice, deposit, workStatus,
    designerId, designerName, serviceIds, notes, clientType,
  } = body;

  // Find or create client
  let clientIdFinal = clientId;
  if (!clientIdFinal && clientPhone) {
    const existing = await prisma.client.findUnique({
      where: { businessId_phone: { businessId: abomazen.id, phone: clientPhone } },
    });
    if (existing) {
      clientIdFinal = existing.id;
    } else {
      const newClient = await prisma.client.create({
        data: { businessId: abomazen.id, phone: clientPhone, name: clientName || "Unknown" },
      });
      clientIdFinal = newClient.id;
    }
  }

  if (!clientIdFinal) {
    return NextResponse.json({ error: "Client phone or ID required" }, { status: 400 });
  }

  const remaining = Math.max(0, (totalPrice || 0) - (deposit || 0));
  const paymentStatus = remaining <= 0 ? "FULL" : (deposit || 0) > 0 ? "PARTIAL" : "UNPAID";

  const project = await prisma.projectRecord.create({
    data: {
      businessId: abomazen.id,
      clientId: clientIdFinal,
      projectName: projectName || "Untitled",
      date: new Date(date),
      customServiceText: customServiceText || null,
      totalPrice: totalPrice || 0,
      deposit: deposit || 0,
      remaining,
      workStatus: workStatus || "WAITING",
      paymentStatus,
      designerId: designerId || null,
      designerName: designerName || null,
      notes: notes || null,
      clientType: clientType || "ONE_TIME",
      services: serviceIds ? { connect: serviceIds.map((id: string) => ({ id })) } : undefined,
    },
    include: { client: true, designer: true, services: true, payments: true },
  });

  // Auto-create PoolTransaction IN for deposit
  if (deposit && deposit > 0) {
    await prisma.poolTransaction.create({
      data: {
        businessId: abomazen.id,
        projectRecordId: project.id,
        amountSAR: deposit,
        type: "IN",
        date: new Date(date),
        note: `Deposit — ${projectName}`,
      },
    });
  }

  // Log activity
  const userId = session.userId;
  if (userId) {
    await prisma.activityLog.create({
      data: {
        userId,
        action: "CREATE",
        entityType: "ProjectRecord",
        entityId: project.id,
      },
    });
  }

  return NextResponse.json(project, { status: 201 });
}
