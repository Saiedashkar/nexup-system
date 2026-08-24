import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const workStatus = searchParams.get("workStatus") || "";
    const paymentStatus = searchParams.get("paymentStatus") || "";

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { projectName: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: search } } },
        { customServiceText: { contains: search, mode: "insensitive" } },
      ];
    }

    if (workStatus) where.workStatus = workStatus;
    if (paymentStatus) where.paymentStatus = paymentStatus;

    const projects = await prisma.projectRecord.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, tier: true } },
        designer: { select: { id: true, name: true } },
        services: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json({ error: "فشل جلب السجلات" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

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
      serviceIds,
      notes,
    } = body;

    // Validate required fields
    if (!clientPhone || !clientName || !projectName || !date || !totalPrice) {
      return NextResponse.json({ error: "يرجى تعبئة جميع الحقول المطلوبة" }, { status: 400 });
    }

    // Find or create client
    let client = clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : await prisma.client.findUnique({ where: { phone: clientPhone } });

    if (!client) {
      client = await prisma.client.create({
        data: { phone: clientPhone, name: clientName, tier: "NORMAL" },
      });
    } else if (client.name !== clientName) {
      client = await prisma.client.update({
        where: { id: client.id },
        data: { name: clientName },
      });
    }

    // Calculate remaining (auto-calculated, not from client)
    const total = parseFloat(String(totalPrice));
    const dep = parseFloat(String(deposit || 0));
    const remaining = total - dep;

    // Create project record
    const project = await prisma.projectRecord.create({
      data: {
        clientId: client.id,
        projectName,
        date: new Date(date),
        customServiceText: customServiceText || null,
        totalPrice: total,
        deposit: dep,
        remaining,
        workStatus: workStatus || "WAITING",
        paymentStatus: dep >= total ? "FULL" : dep > 0 ? "PARTIAL" : "UNPAID",
        designerId: session.userId,
        notes: notes || null,
        services: serviceIds?.length ? { connect: serviceIds.map((id: string) => ({ id })) } : undefined,
      },
      include: {
        client: { select: { id: true, name: true, phone: true, tier: true } },
        designer: { select: { id: true, name: true } },
        services: { select: { id: true, name: true } },
      },
    });

    // AUTO: Create IN transaction in Available Balance when deposit > 0
    if (dep > 0) {
      await prisma.poolTransaction.create({
        data: {
          projectRecordId: project.id,
          amountSAR: dep,
          type: "IN",
          date: new Date(date),
          note: `عربون — ${clientName} — ${projectName}`,
        },
      });
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

    // AUTO: Update client tier based on payment history
    const projectCount = await prisma.projectRecord.count({ where: { clientId: client.id } });
    const totalPaid = await prisma.projectRecord.aggregate({
      where: { clientId: client.id, paymentStatus: "FULL" },
      _sum: { totalPrice: true },
    });
    const totalRevenue = Number(totalPaid._sum.totalPrice ?? 0);

    let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
    if (totalRevenue > 50000 || projectCount >= 10) tier = "VIP";
    else if (totalRevenue > 20000 || projectCount >= 5) tier = "LOYAL";

    await prisma.client.update({ where: { id: client.id }, data: { tier } });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json({ error: "فشل إنشاء السجل" }, { status: 500 });
  }
}
