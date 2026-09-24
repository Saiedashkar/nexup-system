import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma, prismaRaw } from "@/lib/prisma";
import type { McpPrincipal } from "./auth";
import { isBusinessAllowed } from "./auth";
import { getBusinessScopeFilter } from "./scope";
import { mcpAuditData } from "./audit";
import { McpActionError } from "./errors";
import {
  CreateClientInput,
  UpdateClientInput,
  CreateProjectInput,
  UpdateProjectInput,
} from "./schemas";

/* ═══════════════════════════════════════════════════════════════
   NEXUP MCP — Phase 2A action layer (create / update only)

   Invariants enforced here, not in the prompt layer:

   • Business isolation — every write first resolves one *explicit*
     business slug through the principal's allow-list, and every
     affected row is loaded through the shared soft-delete-aware
     `prisma` client, so deleted rows are never read or resurrected
     implicitly.
   • No deletes. There is no delete/softDelete/purge call in this
     file and none is exposed in the tool schemas.
   • No financial writes from MCP:
       – create_project hard-codes deposit = 0,
         remaining = totalPrice, paymentStatus = "UNPAID";
       – update_project cannot touch deposit, remaining, totalPrice,
         paymentStatus or clientId/businessId;
       – no ClientPayment or PoolTransaction is ever created here.
     Money movement stays in the web UI, where the user confirms it.
   • Duplicate phone protection — phone is unique per business
     (`@@unique([businessId, phone])`). We pre-check live rows and
     translate the P2002 violation (which would otherwise surface as
     a raw 500) into an actionable message.
   • Auditable writes — each successful create/update commits exactly
     one `McpAuditLog` row (source = MCP/Hermes, actor, tool, entity,
     business, non-secret metadata) inside the *same* transaction as
     the write. A rejected call therefore never leaves a success
     record, and a write can never exist without its audit row.
   ═══════════════════════════════════════════════════════════════ */

/* `McpActionError` (the expected, coded failure type) now lives in
   `./errors.ts` alongside the catch-all that keeps raw database text
   away from MCP clients. */

/* ─── shared projections (explicit allow-lists, no raw row dumps) ── */

const clientView = {
  id: true,
  name: true,
  phone: true,
  tier: true,
  createdAt: true,
  business: { select: { name: true, slug: true } },
} satisfies Prisma.ClientSelect;

const projectView = {
  id: true,
  projectName: true,
  date: true,
  totalPrice: true,
  deposit: true,
  remaining: true,
  workStatus: true,
  paymentStatus: true,
  customServiceText: true,
  designerName: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true, phone: true } },
  business: { select: { name: true, slug: true } },
} satisfies Prisma.ProjectRecordSelect;

/* ─── helpers ─────────────────────────────────────────────── */

type BusinessRef = { id: string; name: string; slug: string };

/**
 * Resolve an explicit business slug for this principal.
 * A slug outside allowedBusinesses is refused — MCP never acts on a
 * business the caller did not name and is not scoped to.
 */
async function resolveBusiness(slug: string, principal: McpPrincipal): Promise<BusinessRef> {
  if (!isBusinessAllowed(principal, slug)) {
    throw new McpActionError(
      "forbidden",
      `Business '${slug}' is not allowed for this MCP profile.`,
    );
  }

  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });

  if (!business) {
    throw new McpActionError("not_found", `Business '${slug}' does not exist.`);
  }

  return business;
}

/**
 * Reject a phone already used by a *live* client in this business.
 * Soft-deleted rows are invisible to `prisma.client`, matching exactly
 * what the app shows in its lists.
 */
async function assertPhoneAvailable(
  businessId: string,
  phone: string,
  excludeClientId?: string,
): Promise<void> {
  const existing = await prisma.client.findFirst({
    where: {
      businessId,
      phone,
      ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
    },
    select: { id: true, name: true },
  });

  if (existing) {
    throw new McpActionError(
      "conflict",
      `Phone ${phone} already belongs to live client '${existing.name}' (${existing.id}) in this business. Use update_client to change that client instead of creating a duplicate.`,
    );
  }
}

/**
 * `@@unique([businessId, phone])` covers soft-deleted rows too, so a
 * recreate with an old phone hits P2002 while no live row exists, and a
 * concurrent insert can beat the pre-check on either path. The database
 * is the final arbiter; translate its violation into a clear,
 * non-destructive instruction instead of leaking a Prisma error.
 */
function translateUniqueViolation(err: unknown, message: string): never {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
    throw new McpActionError("conflict", message);
  }
  throw err;
}

/** Empty / whitespace-only text clears the column; null clears it explicitly. */
function toNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse an ISO 8601 date, strictly.
 * `new Date("2026-02-31")` silently rolls over to 2026-03-03, so the
 * calendar components are round-tripped and compared instead of
 * trusting the constructor.
 */
function toDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    throw new McpActionError("invalid_input", `Invalid date: '${value}'. Use ISO 8601, e.g. 2026-09-24.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 2000 || year > 2100) {
    throw new McpActionError("invalid_input", "Date year must be between 2000 and 2100.");
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;

  if (!isRealCalendarDate) {
    throw new McpActionError(
      "invalid_input",
      `Invalid date: '${value}' is not a real calendar date (e.g. 2026-02-31 does not exist).`,
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new McpActionError("invalid_input", `Invalid date: '${value}'. Use ISO 8601, e.g. 2026-09-24.`);
  }
  return parsed;
}

/* ─── create_client ───────────────────────────────────────── */

export async function createClientAction(
  input: z.infer<typeof CreateClientInput>,
  principal: McpPrincipal,
) {
  const business = await resolveBusiness(input.business, principal);
  await assertPhoneAvailable(business.id, input.phone);

  try {
    const client = await prismaRaw.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          businessId: business.id,
          name: input.name,
          phone: input.phone,
          tier: input.tier ?? "NORMAL",
        },
        select: clientView,
      });

      await tx.mcpAuditLog.create({
        data: mcpAuditData({
          principal,
          tool: "create_client",
          action: "CREATE",
          entityType: "Client",
          entityId: created.id,
          business,
          metadata: { name: created.name, phone: created.phone, tier: created.tier },
        }),
      });

      return created;
    });

    return {
      created: true,
      resource: "client",
      business: business.slug,
      note: "Client created in the requested business only. No projects, payments or subscriptions were touched.",
      client,
    };
  } catch (err) {
    return translateUniqueViolation(
      err,
      `Phone ${input.phone} collides with a previously deleted client record in this business. MCP will not revive financial history automatically — restore that client from the recycle bin in the app, then update it.`,
    );
  }
}

/* ─── update_client ───────────────────────────────────────── */

export async function updateClientAction(
  input: z.infer<typeof UpdateClientInput>,
  principal: McpPrincipal,
) {
  const changedFields = (["name", "phone", "tier"] as const).filter(
    (field) => input[field] !== undefined,
  );
  if (changedFields.length === 0) {
    throw new McpActionError(
      "invalid_input",
      "Nothing to update — provide at least one of: name, phone, tier.",
    );
  }

  const scope = getBusinessScopeFilter(principal);
  const existing = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...(scope?.businessId ? { businessId: scope.businessId } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      tier: true,
      businessId: true,
      business: { select: { slug: true, name: true } },
    },
  });

  if (!existing) {
    throw new McpActionError("not_found", `Client not found: ${input.clientId}`);
  }
  if (!isBusinessAllowed(principal, existing.business.slug)) {
    throw new McpActionError(
      "forbidden",
      `Client ${existing.id} belongs to business '${existing.business.slug}', which is not allowed for this MCP profile.`,
    );
  }

  if (input.phone !== undefined && input.phone !== existing.phone) {
    await assertPhoneAvailable(existing.businessId, input.phone, existing.id);
  }

  // Only these three scalar columns are ever written. The update is
  // wrapped because a concurrent insert of the same phone would pass the
  // pre-check above and then hit the unique index.
  let updated;
  try {
    updated = await prismaRaw.$transaction(async (tx) => {
      const row = await tx.client.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
        },
        select: clientView,
      });

      await tx.mcpAuditLog.create({
        data: mcpAuditData({
          principal,
          tool: "update_client",
          action: "UPDATE",
          entityType: "Client",
          entityId: row.id,
          business: { id: existing.businessId, slug: existing.business.slug },
          metadata: {
            changedFields,
            previous: { name: existing.name, phone: existing.phone, tier: existing.tier },
            current: { name: row.name, phone: row.phone, tier: row.tier },
          },
        }),
      });

      return row;
    });
  } catch (err) {
    throw translateUniqueViolation(
      err,
      `Phone ${input.phone ?? existing.phone} is already taken by another client in this business. No changes were applied.`,
    );
  }

  return {
    updated: true,
    resource: "client",
    business: existing.business.slug,
    changedFields,
    previous: {
      name: existing.name,
      phone: existing.phone,
      tier: existing.tier,
    },
    client: updated,
  };
}

/* ─── create_project ──────────────────────────────────────── */

export async function createProjectAction(
  input: z.infer<typeof CreateProjectInput>,
  principal: McpPrincipal,
) {
  // Validate the date before any I/O so a malformed payload never
  // reaches the database layer.
  const date = toDate(input.date);
  const business = await resolveBusiness(input.business, principal);

  // The client must already exist in *this* business. A client that
  // lives elsewhere is reported as not found for the requested
  // business — MCP never moves or re-parents records.
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, businessId: business.id },
    select: { id: true, name: true, phone: true, tier: true },
  });

  if (!client) {
    throw new McpActionError(
      "not_found",
      `Client ${input.clientId} was not found in business '${business.slug}'. Use search_clients in that business first; projects cannot be created for a client from another business.`,
    );
  }

  const totalPrice = Math.round(input.totalPrice * 100) / 100;

  const project = await prismaRaw.$transaction(async (tx) => {
    const created = await tx.projectRecord.create({
      data: {
        businessId: business.id,
        clientId: client.id,
        projectName: input.projectName,
        date,
        customServiceText: toNullableText(input.customServiceText),
        totalPrice,
        // ── forced, never taken from input ──
        deposit: 0,
        remaining: totalPrice,
        paymentStatus: "UNPAID",
        workStatus: input.workStatus ?? "WAITING",
        designerName: toNullableText(input.designerName),
        notes: toNullableText(input.notes),
        // designerId and clientType intentionally left at their defaults;
        // no ClientPayment / PoolTransaction rows are created here.
      },
      select: projectView,
    });

    await tx.mcpAuditLog.create({
      data: mcpAuditData({
        principal,
        tool: "create_project",
        action: "CREATE",
        entityType: "ProjectRecord",
        entityId: created.id,
        business,
        metadata: {
          clientId: client.id,
          projectName: created.projectName,
          date: date.toISOString(),
          totalPrice,
          deposit: 0,
          remaining: totalPrice,
          paymentStatus: "UNPAID",
          workStatus: created.workStatus,
        },
      }),
    });

    return created;
  });

  return {
    created: true,
    resource: "project_record",
    business: business.slug,
    client: { id: client.id, name: client.name, phone: client.phone },
    financial: {
      totalPrice,
      deposit: 0,
      remaining: totalPrice,
      paymentStatus: "UNPAID",
      note: "MCP records projects as UNPAID with no deposit. Record payments in the NEXUP app so treasury and receipts stay accurate.",
    },
    project,
  };
}

/* ─── update_project ──────────────────────────────────────── */

export async function updateProjectAction(
  input: z.infer<typeof UpdateProjectInput>,
  principal: McpPrincipal,
) {
  const changedFields = (["projectName", "workStatus", "designerName", "notes"] as const).filter(
    (field) => input[field] !== undefined,
  );
  if (changedFields.length === 0) {
    throw new McpActionError(
      "invalid_input",
      "Nothing to update — provide at least one of: projectName, workStatus, designerName, notes.",
    );
  }

  const scope = getBusinessScopeFilter(principal);
  const existing = await prisma.projectRecord.findFirst({
    where: {
      id: input.projectId,
      ...(scope?.businessId ? { businessId: scope.businessId } : {}),
    },
    select: {
      id: true,
      projectName: true,
      workStatus: true,
      designerName: true,
      notes: true,
      businessId: true,
      business: { select: { slug: true } },
    },
  });

  if (!existing) {
    throw new McpActionError("not_found", `Project not found: ${input.projectId}`);
  }
  if (!isBusinessAllowed(principal, existing.business.slug)) {
    throw new McpActionError(
      "forbidden",
      `Project ${existing.id} belongs to business '${existing.business.slug}', which is not allowed for this MCP profile.`,
    );
  }

  // Non-financial fields only — money columns are never in this payload.
  const updated = await prismaRaw.$transaction(async (tx) => {
    const row = await tx.projectRecord.update({
      where: { id: existing.id },
      data: {
        ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
        ...(input.workStatus !== undefined ? { workStatus: input.workStatus } : {}),
        ...(input.designerName !== undefined
          ? { designerName: toNullableText(input.designerName) }
          : {}),
        ...(input.notes !== undefined ? { notes: toNullableText(input.notes) } : {}),
      },
      select: projectView,
    });

    await tx.mcpAuditLog.create({
      data: mcpAuditData({
        principal,
        tool: "update_project",
        action: "UPDATE",
        entityType: "ProjectRecord",
        entityId: row.id,
        business: { id: existing.businessId, slug: existing.business.slug },
        metadata: {
          changedFields,
          previous: {
            projectName: existing.projectName,
            workStatus: existing.workStatus,
            designerName: existing.designerName,
            notes: existing.notes,
          },
          current: {
            projectName: row.projectName,
            workStatus: row.workStatus,
            designerName: row.designerName,
            notes: row.notes,
          },
        },
      }),
    });

    return row;
  });

  return {
    updated: true,
    resource: "project_record",
    business: existing.business.slug,
    changedFields,
    note: "Only non-financial fields were changed. Amounts and payment status are untouched.",
    previous: {
      projectName: existing.projectName,
      workStatus: existing.workStatus,
      designerName: existing.designerName,
      notes: existing.notes,
    },
    project: updated,
  };
}
