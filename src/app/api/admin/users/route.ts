import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      canAccessNexup: true,
      canAccessRebound: true,
      canAccessAbomazen: true,
      canAccessOfficeFinanceFull: true,
      mustChangePassword: true,
      createdAt: true,
      business: { select: { name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, password, role, canAccessNexup, canAccessRebound, canAccessAbomazen, canAccessOfficeFinanceFull } = body;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "الاسم والإيميل وكلمة المرور مطلوبين" }, { status: 400 });
  }

  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "الإيميل مستخدم بالفعل" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: role || "SUPER_ADMIN",
      businessId: null,
      canAccessNexup: canAccessNexup ?? true,
      canAccessRebound: canAccessRebound ?? true,
      canAccessAbomazen: canAccessAbomazen ?? true,
      canAccessOfficeFinanceFull: canAccessOfficeFinanceFull ?? true,
      mustChangePassword: true, // Force password change on first login
    },
  });

  await prisma.activityLog.create({
    data: { userId: session.userId, action: "CREATE", entityType: "User", entityId: user.id },
  });

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, message: "تم إنشاء المستخدم بنجاح — كلمة المرور: " + password }, { status: 201 });
}
