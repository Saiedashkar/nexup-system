import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { McpPrincipal } from "./auth";
import { isBusinessAllowed, BUSINESS_SLUGS } from "./auth";
import type { BusinessScopeFilter } from "./scope";
import {
  GetClientInput,
  GetClientsInput,
  GetBusinessSummaryInput,
  GetBrandContextInput,
  GetProjectInput,
  GetProjectsInput,
  SearchClientsInput,
} from "./schemas";

/* ═══════════════════════════════════════════════════════════════
   Read-only data layer for MCP (Phase 1).

   Rules enforced here:
   • ONLY findMany / findFirst / findUnique / count / aggregate /
     groupBy — there is no create/update/delete anywhere in this file.
   • Every query runs through the shared `prisma` client, whose
     extension injects `deletedAt: null` on soft-deletable models —
     MCP numbers always match what the app displays.
   • Every response is an explicit field projection.
   ═══════════════════════════════════════════════════════════════ */

const clientCompactSelect = {
  id: true,
  name: true,
  phone: true,
  tier: true,
  createdAt: true,
  business: { select: { name: true, slug: true } },
  _count: { select: { projectRecords: true, subscriptions: true } },
} satisfies Prisma.ClientSelect;

const projectCompactSelect = {
  id: true,
  projectName: true,
  date: true,
  totalPrice: true,
  deposit: true,
  remaining: true,
  workStatus: true,
  paymentStatus: true,
  clientType: true,
  designerName: true,
  notes: true,
  client: { select: { id: true, name: true, phone: true, tier: true } },
  business: { select: { name: true, slug: true } },
} satisfies Prisma.ProjectRecordSelect;

function serialize<T>(rows: T[]): T[] {
  return rows;
}

/* ─── Clients ─────────────────────────────────────────────── */

export async function searchClients(
  input: z.infer<typeof SearchClientsInput>,
  scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  if (input.business && !isBusinessAllowed(principal, input.business)) {
    return { results: [], total: 0, note: "No matching business scope." };
  }

  const where: Prisma.ClientWhereInput = {
    OR: [
      { name: { contains: input.query } },
      { phone: { contains: input.query } },
    ],
    ...(input.business ? { business: { is: { slug: input.business } } } : {}),
    ...(scope?.businessId ? { businessId: scope.businessId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: clientCompactSelect,
      orderBy: { createdAt: "desc" },
      take: input.limit,
    }),
    prisma.client.count({ where }),
  ]);

  return { results: serialize(rows), total };
}

export async function listClients(
  input: z.infer<typeof GetClientsInput>,
  scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  if (input.business && !isBusinessAllowed(principal, input.business)) {
    return { results: [], total: 0, offset: input.offset, limit: input.limit, note: "No matching business scope." };
  }

  const where: Prisma.ClientWhereInput = {
    ...(input.business ? { business: { is: { slug: input.business } } } : {}),
    ...(scope?.businessId ? { businessId: scope.businessId } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: clientCompactSelect,
      orderBy: { createdAt: "desc" },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.client.count({ where }),
  ]);

  return { results: serialize(rows), total, offset: input.offset, limit: input.limit };
}

export async function getClient(
  input: z.infer<typeof GetClientInput>,
  scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  const row = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...(scope?.businessId ? { businessId: scope.businessId } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      tier: true,
      createdAt: true,
      business: { select: { name: true, slug: true } },
      projectRecords: {
        orderBy: { date: "desc" },
        select: projectCompactSelect,
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          services: true,
          monthlyFee: true,
          status: true,
          startDate: true,
          billingDay: true,
        },
      },
    },
  });

  if (!row) throw new ClientNotFoundError(input.clientId);
  void principal;
  return row;
}

/* ─── Projects ────────────────────────────────────────────── */

export async function listProjects(
  input: z.infer<typeof GetProjectsInput>,
  scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  if (input.business && !isBusinessAllowed(principal, input.business)) {
    return { results: [], total: 0, offset: input.offset, limit: input.limit, note: "No matching business scope." };
  }

  const where: Prisma.ProjectRecordWhereInput = {
    ...(input.business ? { business: { is: { slug: input.business } } } : {}),
    ...(scope?.businessId ? { businessId: scope.businessId } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.workStatus ? { workStatus: input.workStatus } : {}),
    ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.projectRecord.findMany({
      where,
      select: projectCompactSelect,
      orderBy: { date: "desc" },
      take: input.limit,
      skip: input.offset,
    }),
    prisma.projectRecord.count({ where }),
  ]);

  return { results: serialize(rows), total, offset: input.offset, limit: input.limit };
}

export async function getProject(
  input: z.infer<typeof GetProjectInput>,
  scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  const row = await prisma.projectRecord.findFirst({
    where: {
      id: input.projectId,
      ...(scope?.businessId ? { businessId: scope.businessId } : {}),
    },
    select: {
      ...projectCompactSelect,
      customServiceText: true,
      createdAt: true,
      updatedAt: true,
      services: { select: { id: true, name: true, isCustom: true } },
      payments: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          amount: true,
          date: true,
          note: true,
          receipts: { select: { id: true, fileName: true, mimeType: true, uploadedAt: true } },
        },
      },
    },
  });

  if (!row) throw new ProjectNotFoundError(input.projectId);
  void principal;
  return row;
}

/* ─── Businesses ──────────────────────────────────────────── */

export async function listBusinesses(principal: McpPrincipal) {
  const rows = await prisma.business.findMany({
    where: { slug: { in: [...principal.allowedBusinesses] } },
    select: {
      id: true,
      name: true,
      slug: true,
      currencyMode: true,
      createdAt: true,
      _count: { select: { clients: true, projectRecords: true, subscriptions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return { results: rows, total: rows.length };
}

export async function getBusinessSummary(
  input: z.infer<typeof GetBusinessSummaryInput>,
  _scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  if (!isBusinessAllowed(principal, input.business)) {
    throw new Error("Access denied to this business.");
  }

  const business = await prisma.business.findUnique({
    where: { slug: input.business },
    select: { id: true, name: true, slug: true, currencyMode: true },
  });
  if (!business) throw new BusinessNotFoundError(input.business);

  const [totalClients, totalProjects, projectsAgg, workStatusGroup, paymentStatusGroup, monthlyProjects] =
    await Promise.all([
      prisma.client.count({ where: { businessId: business.id } }),
      prisma.projectRecord.count({ where: { businessId: business.id } }),
      prisma.projectRecord.aggregate({
        where: { businessId: business.id },
        _sum: { totalPrice: true, deposit: true, remaining: true },
        _count: { _all: true },
      }),
      prisma.projectRecord.groupBy({
        by: ["workStatus"],
        where: { businessId: business.id },
        _count: { _all: true },
      }),
      prisma.projectRecord.groupBy({
        by: ["paymentStatus"],
        where: { businessId: business.id },
        _sum: { totalPrice: true },
      }),
      prisma.projectRecord.findMany({
        where: { businessId: business.id },
        orderBy: { date: "desc" },
        take: 6,
        select: { id: true, projectName: true, date: true, totalPrice: true, paymentStatus: true },
      }),
    ]);

  return {
    business,
    totals: {
      clients: totalClients,
      projects: totalProjects,
      revenue: projectsAgg._sum.totalPrice ?? 0,
      collected: projectsAgg._sum.deposit ?? 0,
      outstanding: projectsAgg._sum.remaining ?? 0,
    },
    byWorkStatus: workStatusGroup.map((g) => ({
      status: g.workStatus,
      count: g._count._all,
    })),
    revenueByPaymentStatus: paymentStatusGroup.map((g) => ({
      paymentStatus: g.paymentStatus,
      total: g._sum.totalPrice ?? 0,
    })),
    recentProjects: monthlyProjects,
  };
}

export async function getBrandContext(
  input: z.infer<typeof GetBrandContextInput>,
  _scope: BusinessScopeFilter,
  principal: McpPrincipal,
) {
  const slugs = input.business
    ? [input.business]
    : BUSINESS_SLUGS.filter((s) => isBusinessAllowed(principal, s));

  const rows = await prisma.business.findMany({
    where: { slug: { in: slugs } },
    select: {
      id: true,
      name: true,
      slug: true,
      currencyMode: true,
      serviceTypes: { select: { id: true, name: true, isCustom: true } },
      _count: { select: { clients: true, projectRecords: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const results = await Promise.all(
    rows.map(async (b) => ({
      ...b,
      workloadMix: await prisma.projectRecord.groupBy({
        by: ["workStatus"],
        where: { businessId: b.id },
        _count: { _all: true },
      }).then((g) =>
        g.map((x) => ({ status: x.workStatus, count: x._count._all })),
      ),
    })),
  );

  return { results, total: results.length };
}

/* ─── typed not-found errors ──────────────────────────────── */

export class ClientNotFoundError extends Error {
  constructor(id: string) {
    super(`Client not found: ${id}`);
    this.name = "ClientNotFoundError";
  }
}
export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}
export class BusinessNotFoundError extends Error {
  constructor(slug: string) {
    super(`Business not found: ${slug}`);
    this.name = "BusinessNotFoundError";
  }
}
