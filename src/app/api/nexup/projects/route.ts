import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOrReviveClient } from "@/lib/soft-delete";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const nexup = await prisma.business.findUnique({ where: { slug: "nexup" } });
  if (!nexup) return NextResponse.json({ error: "NEXUP not found" }, { status: 404 });

  if (session.role !== "SUPER_ADMIN" && session.businessId !== nexup.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const workStatus = searchParams.get("workStatus") || "";
  const paymentStatus = searchParams.get("paymentStatus") || "";

  const where: Record<string, unknown> = { businessId: nexup.id };

  if (workStatus) where.workStatus = workStatus;
  if (paymentStatus) where.paymentStatus = paymentStatus;

  if (search) {
    where.OR = [
      { projectName: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
      { client: { phone: { contains: search } } },
    ];
  }

  const projects = await prisma.projectRecord.findMany({
    where,
    include: {
      client: { select: { id: true, name: true, phone: true, tier: true } },
      designer: { select: { id: true, name: true } },
      services: { select: { id: true, name: true } },
      payments: {
        select: {
          id: true, amount: true, date: true, note: true,
          receipts: { select: { id: true, imageUrl: true, fileName: true, mimeType: true, uploadedAt: true } },
        },
        orderBy: { date: "asc" as const },
      },
    },
    orderBy: { date: "desc" },
  });

  // Enrich with client stats (repeat client detection, total paid)
  const enriched = await Promise.all(
    projects.map(async (p) => {
      const clientProjectCount = await prisma.projectRecord.count({
        where: { clientId: p.clientId, businessId: nexup.id },
      });
      const clientTotalPaid = await prisma.projectRecord.aggregate({
        where: { clientId: p.clientId, businessId: nexup.id, paymentStatus: "FULL" },
        _sum: { totalPrice: true },
      });
      const totalPaidAmount = Number(clientTotalPaid._sum.totalPrice ?? 0);
      const isRepeatClient = clientProjectCount > 1;

      return {
        ...p,
        client: {
          ...p.client,
          projectCount: clientProjectCount,
          totalPaid: totalPaidAmount,
          isRepeatClient,
        },
      };
    })
  );

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const nexup = await prisma.business.findUnique({ where: { slug: "nexup" } });
    if (!nexup) return NextResponse.json({ error: "NEXUP not found" }, { status: 404 });

    const body = await request.json();
    const {
      clientId,
      clientPhone,
      clientName,
      projectName,
      date,
      customServiceText,
      totalPrice,
      deposit,
      workStatus,
      designerId,
      designerName,
      serviceIds,
      notes,
    } = body;

    if (!clientPhone || !clientName || !projectName || !date || !totalPrice) {
      return NextResponse.json({ error: "Please fill all required fields" }, { status: 400 });
    }

    // Find or create client. A previously soft-deleted client with the same phone
    // is revived instead of colliding with the unique(businessId, phone) index.
    let client: { id: string; name: string; phone: string } | null = clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : await findOrReviveClient(nexup.id, clientPhone, clientName);

    if (!client) {
      client = await prisma.client.create({
        data: { businessId: nexup.id, phone: clientPhone, name: clientName, tier: "NORMAL" },
      });
    } else if (client.name !== clientName) {
      client = await prisma.client.update({
        where: { id: client.id },
        data: { name: clientName },
      });
    }

    const total = parseFloat(String(totalPrice));
    const dep = parseFloat(String(deposit || 0));
    const remaining = total - dep;

    const project = await prisma.projectRecord.create({
      data: {
        businessId: nexup.id,
        clientId: client.id,
        projectName,
        date: new Date(date),
        customServiceText: customServiceText || null,
        totalPrice: total,
        deposit: dep,
        remaining,
        workStatus: workStatus || "WAITING",
        paymentStatus: dep >= total ? "FULL" : dep > 0 ? "PARTIAL" : "UNPAID",
        designerId: designerId || null,
        designerName: designerName || null,
        notes: notes || null,
        services: serviceIds?.length ? { connect: serviceIds.map((id: string) => ({ id })) } : undefined,
      },
      include: {
        client: { select: { id: true, name: true, phone: true, tier: true } },
        designer: { select: { id: true, name: true } },
        services: { select: { id: true, name: true } },
        payments: { orderBy: { date: "asc" as const } },
      },
    });

    // AUTO: Create IN transaction when deposit > 0
    let depositPaymentId: string | null = null;
    if (dep > 0) {
      await prisma.poolTransaction.create({
        data: {
          businessId: nexup.id,
          projectRecordId: project.id,
          amountSAR: dep,
          type: "IN",
          date: new Date(date),
          note: `Deposit — ${clientName} — ${projectName}`,
        },
      });

      // Record the deposit as a proper ClientPayment row so a transfer receipt
      // can be attached to it like any other payment. Amount fields are kept
      // identical to before (deposit/remaining/paymentStatus set above).
      const depositPayment = await prisma.clientPayment.create({
        data: {
          projectRecordId: project.id,
          amount: dep,
          date: new Date(date),
          note: "عربون",
          createdByUserId: session.userId,
        },
      });
      depositPaymentId = depositPayment.id;
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.userId,
        action: "CREATE",
        entityType: "ProjectRecord",
        entityId: project.id,
      },
    });

    // Surface the auto-created deposit payment so the client can attach a
    // transfer receipt to it right after creating the record.
    const projectWithPayments = depositPaymentId
      ? { ...project, payments: [{ id: depositPaymentId, amount: dep, date: project.date, note: "عربون", receipts: [] }] }
      : project;

    return NextResponse.json(projectWithPayments, { status: 201 });
  } catch (error) {
    console.error("Failed to create NEXUP project:", error);
    return NextResponse.json({ error: "Failed to create record" }, { status: 500 });
  }
}
