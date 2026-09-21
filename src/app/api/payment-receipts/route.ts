import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import { uploadReceiptToR2, R2_NOT_CONFIGURED_MESSAGE } from "@/lib/r2";

export const runtime = "nodejs";

// GET — list receipts for one payment (or all receipts of a project via ?projectRecordId=)
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const clientPaymentId = searchParams.get("clientPaymentId");
    const projectRecordId = searchParams.get("projectRecordId");

    if (!clientPaymentId && !projectRecordId) {
      return NextResponse.json({ error: "clientPaymentId or projectRecordId is required" }, { status: 400 });
    }

    const receipts = await prisma.paymentReceipt.findMany({
      where: clientPaymentId
        ? { clientPaymentId }
        : { clientPayment: { projectRecordId: projectRecordId as string } },
      orderBy: { uploadedAt: "asc" },
      select: {
        id: true,
        clientPaymentId: true,
        imageUrl: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        uploadedAt: true,
        uploadedByUserId: true,
      },
    });

    return NextResponse.json(receipts);
  } catch (error) {
    console.error("Failed to fetch receipts:", error);
    return NextResponse.json({ error: "Failed to fetch receipts" }, { status: 500 });
  }
}

// POST — upload a receipt image/PDF for a payment (multipart/form-data)
export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get("file");
    const clientPaymentId = formData.get("clientPaymentId");

    if (!(file instanceof File) || typeof clientPaymentId !== "string" || !clientPaymentId) {
      return NextResponse.json({ error: "file and clientPaymentId are required" }, { status: 400 });
    }

    const payment = await prisma.clientPayment.findUnique({ where: { id: clientPaymentId } });
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    let imageUrl: string;
    try {
      imageUrl = await uploadReceiptToR2(buffer, file.name, file.type, file.size);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      // Distinguish "storage not configured" (503, actionable) from validation errors (400)
      const status = message === R2_NOT_CONFIGURED_MESSAGE ? 503 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    const receipt = await prisma.paymentReceipt.create({
      data: {
        clientPaymentId,
        imageUrl,
        fileName: file.name || null,
        fileSize: file.size || null,
        mimeType: file.type || null,
        uploadedByUserId: session.userId,
      },
    });

    await prisma.activityLog.create({
      data: { userId: session.userId, action: "CREATE", entityType: "PaymentReceipt", entityId: receipt.id },
    });

    return NextResponse.json(receipt, { status: 201 });
  } catch (error) {
    console.error("Failed to upload receipt:", error);
    return NextResponse.json({ error: "Failed to upload receipt" }, { status: 500 });
  }
}
