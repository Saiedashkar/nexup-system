import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// Temporary audit endpoint — shows all existing records with proposed classification
export async function GET() {
  const session = await getCurrentSession();
  if (!session || session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const contributions = await prisma.capitalContribution.findMany({
    include: { partner: true },
    orderBy: { date: "asc" },
  });

  const audit = contributions.map(c => {
    const desc = (c.description || "").toLowerCase();
    // Auto-classify based on description
    let proposedFundFlow: string;
    let reason: string;

    // Keywords that indicate the money was spent immediately
    const spentKeywords = ["صيانة", "شراء", "أدوات", "ستائر", "مصاريف", "شراءة", "تقسيط", "اشتراك", "فاتورة", ".debug", "مبلغ صرف", "تم صرف"];
    const isSpent = spentKeywords.some(kw => desc.includes(kw));

    // If description is empty or generic (just "مساهمة" or partner name), might be treasury
    const isGeneric = desc === "" || desc === "مساهمة رأس مال" || desc.length < 5;

    if (c.fundFlow === "STILL_IN_TREASURY") {
      // Already marked correctly
      proposedFundFlow = "STILL_IN_TREASURY";
      reason = "مُعلَّم مسبقًا كمتاح في الخزينة";
    } else if (isSpent) {
      proposedFundFlow = "SPENT_ALREADY";
      reason = `الوصف يحتوي كلمة تدل على الصرف: "${c.description || ""}"`;
    } else if (isGeneric) {
      proposedFundFlow = "STILL_IN_TREASURY";
      reason = `الوصف عام أو فارغ: "${c.description || "—"}" — قد يكون سيولة متاحة`;
    } else {
      proposedFundFlow = "SPENT_ALREADY";
      reason = `الافتراضي — وصف: "${c.description}"`;
    }

    return {
      id: c.id,
      partner: c.partner.name,
      amount: c.amount,
      type: c.type,
      description: c.description || "—",
      date: c.date,
      currentFundFlow: c.fundFlow || "SPENT_ALREADY (افتراضي)",
      proposedFundFlow,
      reason,
      linkedExpenseId: c.linkedExpenseId,
    };
  });

  return NextResponse.json(audit);
}
