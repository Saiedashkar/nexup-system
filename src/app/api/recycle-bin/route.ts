import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  getRecord,
  listDeletedRecords,
  purgeRecord,
  restoreRecord,
} from "@/lib/soft-delete";
import { isSoftDeleteModel } from "@/lib/soft-delete-models";

export const runtime = "nodejs";

/* ═══════════════════════════════════════════════════════
   GET — every soft-deleted record in the system (recycle bin)
   SUPER_ADMIN only.
   ═══════════════════════════════════════════════════════ */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const items = await listDeletedRecords();
  return NextResponse.json({ items });
}

/* ═══════════════════════════════════════════════════════
   PATCH — restore a record (used by the recycle bin and by the
   "تراجع" button on the undo toast).
   Allowed for SUPER_ADMIN, or for the user who deleted it.
   ═══════════════════════════════════════════════════════ */
export async function PATCH(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { model, id } = body as { model?: string; id?: string };

  if (!model || !id || !isSoftDeleteModel(model)) {
    return NextResponse.json({ error: "model and id are required" }, { status: 400 });
  }

  const record = await getRecord(model, id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = record.deletedByUserId && record.deletedByUserId === session.userId;
  if (session.role !== "SUPER_ADMIN" && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await restoreRecord(model, id, session.userId);
  return NextResponse.json({ ok: true });
}

/* ═══════════════════════════════════════════════════════
   DELETE — permanent removal. SUPER_ADMIN only, and requires
   an explicit `confirm: true` (double confirmation in the UI).
   ═══════════════════════════════════════════════════════ */
export async function DELETE(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { model, id, confirm } = body as { model?: string; id?: string; confirm?: boolean };

  if (!model || !id || !isSoftDeleteModel(model)) {
    return NextResponse.json({ error: "model and id are required" }, { status: 400 });
  }
  if (confirm !== true) {
    return NextResponse.json({ error: "Permanent delete requires explicit confirmation" }, { status: 400 });
  }

  const record = await getRecord(model, id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!record.deletedAt) {
    return NextResponse.json(
      { error: "Record is not in the recycle bin — delete it first" },
      { status: 400 },
    );
  }

  try {
    await purgeRecord(model, id, session.userId);
  } catch {
    return NextResponse.json(
      { error: "Cannot permanently delete: other records still reference it" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
