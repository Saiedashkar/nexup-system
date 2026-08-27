import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

// PATCH — update user details and permissions
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email.trim().toLowerCase();
  if (body.role !== undefined) updateData.role = body.role;
  if (body.canAccessNexup !== undefined) updateData.canAccessNexup = body.canAccessNexup;
  if (body.canAccessRebound !== undefined) updateData.canAccessRebound = body.canAccessRebound;
  if (body.canAccessAbomazen !== undefined) updateData.canAccessAbomazen = body.canAccessAbomazen;
  if (body.canAccessOfficeFinanceFull !== undefined) updateData.canAccessOfficeFinanceFull = body.canAccessOfficeFinanceFull;
  if (body.mustChangePassword !== undefined) updateData.mustChangePassword = body.mustChangePassword;

  try {
    const user = await prisma.user.update({ where: { id }, data: updateData });
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "UPDATE", entityType: "User", entityId: id },
    });
    return NextResponse.json({ message: "تم التحديث بنجاح", user: { id: user.id, name: user.name, email: user.email } });
  } catch {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }
}

// DELETE — remove user
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  // Prevent self-deletion
  if (id === session.userId) return NextResponse.json({ error: "لا يمكنك حذف نفسك" }, { status: 400 });

  try {
    await prisma.user.delete({ where: { id } });
    await prisma.activityLog.create({
      data: { userId: session.userId, action: "DELETE", entityType: "User", entityId: id },
    });
    return NextResponse.json({ message: "تم الحذف بنجاح" });
  } catch {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }
}

// POST — reset password
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const { newPassword, mustChangePassword } = body;

  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  try {
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: mustChangePassword ?? true,
      },
    });

    await prisma.activityLog.create({
      data: { userId: session.userId, action: "UPDATE", entityType: "Password", entityId: id },
    });

    return NextResponse.json({ message: "تم تغيير كلمة المرور بنجاح" });
  } catch {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }
}
