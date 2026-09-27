import { NextResponse } from "next/server";
import { getCurrentSession, canAccessOfficeFinance } from "@/lib/auth";
import { getCapitalLedger, getCapitalWithdrawalsByPerson } from "@/lib/capital";

export const runtime = "nodejs";

export async function GET() {
  const session = await getCurrentSession();
  if (!session || !canAccessOfficeFinance(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [ledger, withdrawalsByPerson] = await Promise.all([
    getCapitalLedger(),
    getCapitalWithdrawalsByPerson(),
  ]);
  return NextResponse.json({ ...ledger, withdrawalsByPerson });
}
