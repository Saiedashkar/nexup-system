import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, canAccessBusiness } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logActivity, softDeleteMany, softDeleteRecord } from "@/lib/soft-delete";

export const runtime = "nodejs";

/* ═══════════════════════════════════════════════════════
   Shared: load the subscription and check business access
   ═══════════════════════════════════════════════════════ */
async function loadSubscription(id: string) {
  return prisma.subscription.findUnique({
    where: { id },
    include: { business: { select: { slug: true } }, client: true },
  });
}

/* ═══════════════════════════════════════════════════════
   PATCH — edit a monthly subscription
   Every derived number (invoices, MRR, balances) is refreshed.
   ═══════════════════════════════════════════════════════ */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await loadSubscription(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canAccessBusiness(session, existing.business.slug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const updateData: Record<string, unknown> = {};
  if (body.services !== undefined) {
    const services = Array.isArray(body.services)
      ? body.services
      : String(body.services).split(",").map((s: string) => s.trim()).filter(Boolean);
    updateData.services = JSON.stringify(services);
  }
  if (body.monthlyFee !== undefined) updateData.monthlyFee = parseFloat(body.monthlyFee);
  if (body.startDate !== undefined) updateData.startDate = new Date(body.startDate);
  if (body.billingDay !== undefined) updateData.billingDay = parseInt(body.billingDay);
  if (body.status !== undefined) updateData.status = body.status;
  if (body.notes !== undefined) updateData.notes = body.notes || null;

  // ── Client details (name / phone) live on the client row ──
  const clientUpdate: Record<string, unknown> = {};
  if (body.clientName !== undefined && body.clientName) clientUpdate.name = body.clientName;
  if (body.clientPhone !== undefined && body.clientPhone && body.clientPhone !== existing.client.phone) {
    const clash = await prisma.client.findUnique({
      where: { businessId_phone: { businessId: existing.businessId, phone: body.clientPhone } },
    });
    if (clash && clash.id !== existing.clientId) {
      return NextResponse.json({ error: "رقم الهاتف مستخدم بالفعل لعميل آخر" }, { status: 409 });
    }
    clientUpdate.phone = body.clientPhone;
  }
  if (Object.keys(clientUpdate).length > 0) {
    await prisma.client.update({ where: { id: existing.clientId }, data: clientUpdate });
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: updateData,
    include: { client: true, invoices: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
  });

  // ── Keep the money consistent ──
  // Unpaid invoices that were never touched follow the new monthly fee.
  let response = updated;
  if (updateData.monthlyFee !== undefined) {
    await prisma.subscriptionInvoice.updateMany({
      where: { subscriptionId: id, status: "UNPAID", paidAmount: 0 },
      data: { amount: updateData.monthlyFee as number },
    });

    // Re-read so the response carries the synced invoice amounts too
    const refreshed = await prisma.subscription.findUnique({
      where: { id },
      include: { client: true, invoices: { orderBy: [{ year: "desc" }, { month: "desc" }] } },
    });
    if (refreshed) response = refreshed;
  }

  await logActivity(session.userId, "UPDATE", "Subscription", id);

  return NextResponse.json(response);
}

/* ═══════════════════════════════════════════════════════
   DELETE — safe delete (recoverable from the recycle bin)
   ═══════════════════════════════════════════════════════ */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await loadSubscription(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canAccessBusiness(session, existing.business.slug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await softDeleteMany("SubscriptionInvoice", { subscriptionId: id }, session.userId);
  await softDeleteRecord("Subscription", id, session.userId);

  return NextResponse.json({ ok: true });
}
