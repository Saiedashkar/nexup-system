import { prismaRaw } from "./prisma";
import { type SoftDeleteModel } from "./soft-delete-models";

/* ═══════════════════════════════════════════════════════
   Loose-typed access to the raw (unfiltered) client delegates.
   Every delegate below is looked up by the exact Prisma model
   name declared in `SOFT_DELETE_REGISTRY`.
   ═══════════════════════════════════════════════════════ */

type LooseDelegate = {
  findMany: (args?: unknown) => Promise<LooseRecord[]>;
  findUnique: (args: unknown) => Promise<LooseRecord | null>;
  update: (args: unknown) => Promise<LooseRecord>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
  create: (args: unknown) => Promise<LooseRecord>;
  delete: (args: unknown) => Promise<LooseRecord>;
};

type LooseRecord = {
  id: string;
  deletedAt?: Date | string | null;
  deletedByUserId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

function db(): Record<string, LooseDelegate> {
  return prismaRaw as unknown as Record<string, LooseDelegate>;
}

export type SoftDeleteMeta = {
  /** Prisma delegate key on the client, e.g. `projectRecord` */
  delegate: string;
  /** Arabic label shown in the recycle bin */
  labelAr: string;
  /** One-line human description of an individual record */
  describe: (r: LooseRecord) => string;
};

export const SOFT_DELETE_REGISTRY: Record<SoftDeleteModel, SoftDeleteMeta> = {
  Client: { delegate: "client", labelAr: "عميل", describe: r => `${r.name ?? "—"} — ${r.phone ?? ""}`.trim() },
  ProjectRecord: { delegate: "projectRecord", labelAr: "سجل مشروع", describe: r => String(r.projectName ?? "—") },
  PoolTransaction: { delegate: "poolTransaction", labelAr: "حركة خزينة", describe: r => `${r.type ?? ""} ${r.amountSAR ?? ""}${r.note ? ` — ${r.note}` : ""}`.trim() },
  Withdrawal: { delegate: "withdrawal", labelAr: "تحويل أرباح (سحب)", describe: r => `${r.amountSAR ?? ""} SAR` },
  Expense: { delegate: "expense", labelAr: "مصروف", describe: r => `${r.name ?? ""} — ${r.description ?? ""}` },
  ClientPayment: { delegate: "clientPayment", labelAr: "دفعة عميل", describe: r => `${r.amount ?? ""}` },
  PartnerTransaction: { delegate: "partnerTransaction", labelAr: "حركة شريك", describe: r => `${r.type ?? ""} — ${r.amount ?? ""}` },
  OfficeExpense: { delegate: "officeExpense", labelAr: "مصروف مكتب", describe: r => `${r.name ?? ""} — ${r.description ?? ""}` },
  CapitalContribution: { delegate: "capitalContribution", labelAr: "مساهمة رأس مال", describe: r => `${r.amount ?? ""}${r.description ? ` — ${r.description}` : ""}` },
  OfficeAllocationSetting: { delegate: "officeAllocationSetting", labelAr: "إعداد توزيع مصروفات", describe: r => `${r.allocationPct ?? ""}%` },
  ProfitTransfer: { delegate: "profitTransfer", labelAr: "تحويل ربح للمكتب", describe: r => `${r.amount ?? ""} EGP` },
  NexupProfitLedger: { delegate: "nexupProfitLedger", labelAr: "توزيع أرباح NEXUP", describe: r => `${r.amount ?? ""} EGP` },
  Property: { delegate: "property", labelAr: "عقار", describe: r => `${r.propertyType ?? ""} — ${r.location ?? ""}` },
  Deal: { delegate: "deal", labelAr: "صفقة", describe: r => `${r.dealType ?? ""} — ${r.seekerName ?? ""}`.trim() },
  Subscription: { delegate: "subscription", labelAr: "اشتراك شهري", describe: r => `${r.monthlyFee ?? ""} EGP شهريًا` },
  SubscriptionInvoice: { delegate: "subscriptionInvoice", labelAr: "فاتورة اشتراك", describe: r => `${r.month ?? ""}/${r.year ?? ""} — ${r.amount ?? ""}` },
  OfficeTool: { delegate: "officeTool", labelAr: "أداة مكتب", describe: r => `${r.name ?? ""} — ${r.category ?? ""}` },
  OfficeToolPayment: { delegate: "officeToolPayment", labelAr: "دفعة أداة", describe: r => `${r.amount ?? ""}` },
};

/* ═══════════════════════════════════════════════════════
   Activity logging
   ═══════════════════════════════════════════════════════ */

export async function logActivity(
  userId: string | null | undefined,
  action: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!userId) return;
  try {
    await prismaRaw.activityLog.create({ data: { userId, action, entityType, entityId } });
  } catch {
    /* logging must never break the operation */
  }
}

/* ═══════════════════════════════════════════════════════
   Core soft-delete operations
   ═══════════════════════════════════════════════════════ */

export async function getRecord(model: string, id: string): Promise<LooseRecord | null> {
  const meta = SOFT_DELETE_REGISTRY[model as SoftDeleteModel];
  if (!meta) return null;
  try {
    return await db()[meta.delegate].findUnique({ where: { id } });
  } catch {
    return null;
  }
}

/** Marks a record as deleted. The row itself (and its money) stays in the DB. */
export async function softDeleteRecord(model: string, id: string, userId: string | null): Promise<LooseRecord | null> {
  const meta = SOFT_DELETE_REGISTRY[model as SoftDeleteModel];
  if (!meta) throw new Error(`Unknown model: ${model}`);

  const updated = await db()[meta.delegate].update({
    where: { id },
    data: { deletedAt: new Date(), deletedByUserId: userId ?? null },
  });

  await logActivity(userId, "SOFT_DELETE", model, id);
  return updated;
}

/** Soft-deletes every record matching `where` (used for child rows of a parent). */
export async function softDeleteMany(
  model: string,
  where: Record<string, unknown>,
  userId: string | null,
): Promise<number> {
  const meta = SOFT_DELETE_REGISTRY[model as SoftDeleteModel];
  if (!meta) return 0;

  const result = await db()[meta.delegate].updateMany({
    where: { ...where, deletedAt: null },
    data: { deletedAt: new Date(), deletedByUserId: userId ?? null },
  });

  if (result.count > 0) await logActivity(userId, "SOFT_DELETE", model, `bulk:${result.count}`);
  return result.count;
}

/** Clears the soft-delete flags on every matching row of `model`. */
async function reviveMany(model: SoftDeleteModel, where: Record<string, unknown>): Promise<number> {
  const meta = SOFT_DELETE_REGISTRY[model];
  if (!meta) return 0;
  const result = await db()[meta.delegate].updateMany({
    where: { ...where, deletedAt: { not: null } },
    data: { deletedAt: null, deletedByUserId: null },
  });
  return result.count;
}

/**
 * Rows that were removed together with their parent (payments, invoices,
 * linked treasury movements…) are restored alongside it, so an undo brings
 * the whole record — and its money — back in one go.
 */
async function restoreChildren(model: SoftDeleteModel, record: LooseRecord): Promise<void> {
  switch (model) {
    case "ProjectRecord":
      await reviveMany("ClientPayment", { projectRecordId: record.id });
      await reviveMany("PoolTransaction", { projectRecordId: record.id });
      await reviveClientIfDeleted(record.clientId as string);
      break;
    case "Client":
      await reviveMany("ProjectRecord", { clientId: record.id });
      await reviveMany("Subscription", { clientId: record.id });
      break;
    case "Subscription":
      await reviveMany("SubscriptionInvoice", { subscriptionId: record.id });
      break;
    case "Withdrawal":
      await reviveMany("PoolTransaction", { withdrawalId: record.id });
      break;
    case "Deal":
      await reviveMany("PoolTransaction", { dealId: record.id });
      break;
    case "OfficeTool":
      await reviveMany("OfficeToolPayment", { toolId: record.id });
      break;
    default:
      break;
  }
}

async function reviveClientIfDeleted(clientId: string | undefined): Promise<void> {
  if (!clientId) return;
  const client = await db().client.findUnique({ where: { id: clientId } });
  if (client?.deletedAt) await reviveMany("Client", { id: clientId });
}

/** Undo a soft delete — clears the flags so the record is visible again. */
export async function restoreRecord(model: string, id: string, userId: string | null): Promise<LooseRecord> {
  const meta = SOFT_DELETE_REGISTRY[model as SoftDeleteModel];
  if (!meta) throw new Error(`Unknown model: ${model}`);

  const updated = await db()[meta.delegate].update({
    where: { id },
    data: { deletedAt: null, deletedByUserId: null },
  });

  await restoreChildren(model as SoftDeleteModel, updated);

  await logActivity(userId, "RESTORE", model, id);
  return updated;
}

/** Permanent removal — only reachable from the recycle bin (SUPER_ADMIN). */
export async function purgeRecord(model: string, id: string, userId: string | null): Promise<void> {
  const meta = SOFT_DELETE_REGISTRY[model as SoftDeleteModel];
  if (!meta) throw new Error(`Unknown model: ${model}`);

  await db()[meta.delegate].delete({ where: { id } });
  await logActivity(userId, "PURGE", model, id);
}

/* ═══════════════════════════════════════════════════════
   Recycle bin listing
   ═══════════════════════════════════════════════════════ */

export type RecycleBinItem = {
  model: SoftDeleteModel;
  entityType: string;
  labelAr: string;
  id: string;
  description: string;
  deletedAt: string;
  deletedByUserId: string | null;
  deletedByName: string | null;
};

export async function listDeletedRecords(limitPerModel = 200): Promise<RecycleBinItem[]> {
  const client = db();

  const perModel = await Promise.all(
    (Object.keys(SOFT_DELETE_REGISTRY) as SoftDeleteModel[]).map(async model => {
      const meta = SOFT_DELETE_REGISTRY[model];
      try {
        const rows = await client[meta.delegate].findMany({
          where: { deletedAt: { not: null } },
          orderBy: { deletedAt: "desc" },
          take: limitPerModel,
        });
        return rows.map(r => ({ model, meta, r }));
      } catch {
        return [];
      }
    }),
  );

  const flatten = perModel.flat();

  const userIds = Array.from(new Set(flatten.map(x => x.r.deletedByUserId).filter((v): v is string => !!v)));
  const users = userIds.length
    ? await prismaRaw.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map(u => [u.id, u.name]));

  return flatten
    .map(({ model, meta, r }) => ({
      model,
      entityType: model,
      labelAr: meta.labelAr,
      id: r.id as string,
      description: meta.describe(r),
      deletedAt: new Date(r.deletedAt as Date).toISOString(),
      deletedByUserId: (r.deletedByUserId as string | null) ?? null,
      deletedByName: r.deletedByUserId ? nameById.get(r.deletedByUserId as string) ?? null : null,
    }))
    .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

/* ═══════════════════════════════════════════════════════
   Client helper — keeps the unique(businessId, phone) index happy
   when a client was soft-deleted and the same phone shows up again.
   ═══════════════════════════════════════════════════════ */

export type ResolvedClient = { id: string; name: string; phone: string };

export async function findOrReviveClient(
  businessId: string,
  phone: string,
  name: string,
): Promise<ResolvedClient> {
  const client = db().client;

  const existing = await client.findUnique({
    where: { businessId_phone: { businessId, phone } },
  });

  if (!existing) {
    const created = await client.create({ data: { businessId, phone, name: name || "Unknown" } });
    return { id: created.id, name: created.name, phone: created.phone };
  }

  if (existing.deletedAt) {
    const revived = await client.update({
      where: { id: existing.id },
      data: { deletedAt: null, deletedByUserId: null, name: name || existing.name },
    });
    return { id: revived.id, name: revived.name, phone: revived.phone };
  }

  return { id: existing.id, name: existing.name, phone: existing.phone };
}
