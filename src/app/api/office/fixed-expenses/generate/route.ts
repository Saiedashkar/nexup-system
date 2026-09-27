import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { generateDueFixedExpenses } from "@/lib/capital";

export const runtime = "nodejs";

/**
 * Materializes all due recurring Fixed Expense occurrences as OfficeExpense
 * rows (category FIXED). Idempotent — safe to call repeatedly.
 */
export async function POST(_req: NextRequest) {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await generateDueFixedExpenses(new Date());
  return NextResponse.json(result);
}
