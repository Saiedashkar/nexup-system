import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const workStatus = searchParams.get("workStatus") || "";
    const paymentStatus = searchParams.get("paymentStatus") || "";
    const sortBy = searchParams.get("sortBy") || "date";
    const sortDir = searchParams.get("sortDir") || "desc";

    // Filter by businessId (SUPER_ADMIN sees all, others see their business)
    const where: Record<string, unknown> = {};
    if (session.role !== "SUPER_ADMIN") {
      where.businessId = session.businessId;
    }

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderBy: any = {};
    if (sortBy === "client") orderBy.client = { name: sortDir };
    else orderBy[sortBy] = sortDir;

    const projects = await prisma.projectRecord.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, phone: true, tier: true } },
        designer: { select: { id: true, name: true } },
        services: { select: { id: true, name: true } },
      },
      orderBy,
    });

    // Enrich with client stats
    const enriched = await Promise.all(
      projects.map(async (p) => {
        const clientProjectCount = await prisma.projectRecord.count({
          where: { clientId: p.clientId },
        });
        const clientTotalPaid = await prisma.projectRecord.aggregate({
          where: { clientId: p.clientId, paymentStatus: "FULL" },
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
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

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

    const businessId = session.businessId;

    // Find or create client (using compound unique for multi-business)
    let client = clientId
      ? await prisma.client.findUnique({ where: { id: clientId } })
      : await prisma.client.findUnique({ where: { businessId_phone: { businessId, phone: clientPhone } } });

    if (!client) {
      client = await prisma.client.create({
        data: { businessId, phone: clientPhone, name: clientName, tier: "NORMAL" },
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
        businessId,
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
      },
    });

    // AUTO: Create IN transaction when deposit > 0
    if (dep > 0) {
      await prisma.poolTransaction.create({
        data: {
          businessId,
          projectRecordId: project.id,
          amountSAR: dep,
          type: "IN",
          date: new Date(date),
          note: `Deposit — ${clientName} — ${projectName}`,
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

    // AUTO: Update client tier
    const projectCount = await prisma.projectRecord.count({ where: { clientId: client.id } });
    const totalPaid = await prisma.projectRecord.aggregate({
      where: { clientId: client.id, paymentStatus: "FULL" },
      _sum: { totalPrice: true },
    });
    const totalRevenue = Number(totalPaid._sum.totalPrice ?? 0);

    let tier: "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT" = "NORMAL";
    if (totalRevenue > 1000 || projectCount >= 3) tier = "VIP";
    else if (totalRevenue > 500 || projectCount >= 2) tier = "LOYAL";

    await prisma.client.update({ where: { id: client.id }, data: { tier } });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json({ error: "Failed to create record" }, { status: 500 });
  }
}
