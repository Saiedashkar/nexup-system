import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/auth";
import {
  recordClientPaymentWithRetry,
  PaymentValidationError,
  PaymentConflictError,
} from "@/lib/payments/recordClientPayment";

export const runtime = "nodejs";

// GET — List payments for a project record
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectRecordId = searchParams.get("projectRecordId");
    if (!projectRecordId) {
      return NextResponse.json({ error: "projectRecordId is required" }, { status: 400 });
    }

    const payments = await prisma.clientPayment.findMany({
      where: { projectRecordId },
      orderBy: { date: "asc" },
      include: {
        receipts: { select: { id: true, imageUrl: true, fileName: true, mimeType: true, uploadedAt: true } },
      },
    });

    return NextResponse.json(payments);
  } catch (error) {
    console.error("Failed to fetch payments:", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// POST — Create a new payment for a project record
export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "EMPLOYEE") return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const body = await request.json();
    const { projectRecordId, amount, date, note } = body;

    if (!projectRecordId || !amount) {
      return NextResponse.json({ error: "projectRecordId and amount are required" }, { status: 400 });
    }

    const amountNum = parseFloat(String(amount));
    if (amountNum <= 0) {
      return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    }

    // Shared atomic payment primitive: read → validate → CAS balance
    // swap → ClientPayment → PoolTransaction IN → tier → ActivityLog,
    // all in ONE transaction, retried from a fresh read ONLY on the
    // dedicated CAS conflict (max 3 attempts). A concurrent web or MCP
    // payment that commits first makes our attempt abort instead of
    // overwriting it — the proven web↔MCP lost-update race is closed
    // at the database level, in both directions.
    let recorded;
    try {
      recorded = await recordClientPaymentWithRetry({
        projectRecordId: String(projectRecordId),
        amount: amountNum,
        date: date ? new Date(String(date)) : undefined,
        note: note ? String(note) : null,
        createdByUserId: session.userId,
        activityLogUserId: session.userId,
      });
    } catch (err) {
      if (err instanceof PaymentValidationError) {
        if (err.code === "PAYMENT_NOT_FOUND") {
          return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof PaymentConflictError) {
        // Retry exhaustion — answer a safe conflict, never stale writes.
        return NextResponse.json(
          { error: "The project balance changed too many times while recording this payment. Please retry." },
          { status: 409 },
        );
      }
      throw err;
    }

    // Preserve the original API response shape: the created ClientPayment.
    const payment = await prisma.clientPayment.findUniqueOrThrow({
      where: { id: recorded.paymentId },
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment:", error);
    return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
  }
}
