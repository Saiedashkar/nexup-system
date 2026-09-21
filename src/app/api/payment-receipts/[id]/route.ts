import { NextRequest, NextResponse } from "next/server";
import { prismaRaw } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { deleteReceiptFromR2 } from "@/lib/r2";

export const runtime = "nodejs";

// DELETE — remove a single receipt (DB row + best-effort R2 object)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const { id } = await params;
    const receipt = await prismaRaw.paymentReceipt.findUnique({ where: { id } });
    if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await deleteReceiptFromR2(receipt.imageUrl);
    await prismaRaw.paymentReceipt.delete({ where: { id } });

    await prismaRaw.activityLog.create({
      data: { userId: session.userId, action: "DELETE", entityType: "PaymentReceipt", entityId: id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete receipt:", error);
    return NextResponse.json({ error: "Failed to delete receipt" }, { status: 500 });
  }
}
