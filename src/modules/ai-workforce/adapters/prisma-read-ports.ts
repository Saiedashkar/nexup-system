import { getCapitalSummary } from "@/lib/capital";
import { prisma } from "@/lib/prisma";
import type {
  CapitalReadPort,
  ClientReadPort,
  ClientSummary,
  ProjectListInput,
  ProjectReadPort,
  ProjectSummary,
  WorkforcePorts,
} from "../core/ports";
import type { BusinessScope } from "../core/types";

/**
 * Prisma-backed read ports.
 *
 * Rules honoured here:
 *   - WRAP, never rewrite: capital balances come from `getCapitalSummary()`
 *     in `src/lib/capital.ts`; nothing is recomputed.
 *   - The soft-delete aware client (`@/lib/prisma`) is used for business
 *     reads, so deleted rows stay invisible exactly as they do everywhere else.
 *   - READ ONLY. This file must never gain a mutation.
 *
 * Loaded only by the Next.js server runtime (never by tests), so the control
 * core stays unit-testable without a database.
 */

/** Prisma `Decimal` → number, tolerating the adapter's runtime shapes. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  const decimal = value as { toNumber?: () => number };
  if (typeof decimal.toNumber === "function") return decimal.toNumber();
  return Number(value) || 0;
}

export const prismaClientReadPort: ClientReadPort = {
  async search(input): Promise<ClientSummary[]> {
    const rows = await prisma.client.findMany({
      where: {
        businessId: input.businessId,
        OR: [
          { name: { contains: input.query, mode: "insensitive" } },
          { phone: { contains: input.query } },
        ],
      },
      orderBy: { name: "asc" },
      take: input.limit,
      select: { id: true, businessId: true, name: true, phone: true, tier: true },
    });

    return rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      name: row.name,
      phone: row.phone,
      tier: String(row.tier),
    }));
  },
};

export const prismaProjectReadPort: ProjectReadPort = {
  async list(input: ProjectListInput): Promise<ProjectSummary[]> {
    const rows = await prisma.projectRecord.findMany({
      where: {
        businessId: input.businessId,
        ...(input.workStatus ? { workStatus: input.workStatus as never } : {}),
        ...(input.paymentStatus ? { paymentStatus: input.paymentStatus as never } : {}),
      },
      orderBy: { date: "desc" },
      take: input.limit,
      select: {
        id: true,
        businessId: true,
        projectName: true,
        clientId: true,
        workStatus: true,
        paymentStatus: true,
        totalPrice: true,
        deposit: true,
        remaining: true,
        date: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      businessId: row.businessId,
      projectName: row.projectName,
      clientId: row.clientId,
      workStatus: String(row.workStatus),
      paymentStatus: String(row.paymentStatus),
      totalPrice: toNumber(row.totalPrice),
      deposit: toNumber(row.deposit),
      remaining: toNumber(row.remaining),
      date: row.date.toISOString(),
    }));
  },
};

export const prismaCapitalReadPort: CapitalReadPort = {
  async summary() {
    // Delegation to the legacy service — the balance rules live there.
    return getCapitalSummary();
  },
};

export const prismaWorkforcePorts: WorkforcePorts = {
  clients: prismaClientReadPort,
  projects: prismaProjectReadPort,
  capital: prismaCapitalReadPort,
};

/**
 * Resolves the business scope for an execution.
 * The API layer resolves it from the request and the session — never from
 * model output and never from tool input alone.
 */
export async function resolveBusinessScope(ref: { businessId?: string; slug?: string }): Promise<BusinessScope | null> {
  if (!ref.businessId && !ref.slug) return null;

  const business = await prisma.business.findFirst({
    where: ref.businessId ? { id: ref.businessId } : { slug: ref.slug as string },
    select: { id: true, slug: true },
  });

  return business ? { id: business.id, slug: business.slug } : null;
}
