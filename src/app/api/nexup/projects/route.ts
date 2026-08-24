import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
      client: true,
      designer: { select: { id: true, name: true } },
      services: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(projects);
}
