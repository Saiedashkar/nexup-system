import { z } from "zod";
import { BUSINESS_SLUGS } from "./auth";

/* ═══════════════════════════════════════════════════════════════
   Input validation for every MCP tool (Phase 1 reads +
   Phase 2A create/update actions).
   Hard caps keep any single call cheap: page sizes are clamped,
   ids are cuid-shaped, enums are closed sets from the real schema.
   Action inputs are `z.strictObject`: unknown keys (e.g. deposit,
   paymentStatus, clientId on a project update) are rejected outright
   instead of being silently dropped. Only constructs already proven
   safe with the MCP SDK schema converter are used here — no
   transforms, pipes or refinements.
   ═══════════════════════════════════════════════════════════════ */

/** Prisma cuid — matches ids produced by @default(cuid()). */
const cuidSchema = z.string().regex(/^[a-z0-9]{20,30}$/i, "Invalid id format");

/** Free-text search term — trimmed, length-capped, no empty strings. */
const querySchema = z.string().trim().min(1).max(80);

const businessSlugSchema = z.enum(BUSINESS_SLUGS);

/* ─── Clients ──────────────────────────────────────────────── */

export const SearchClientsInput = z.object({
  query: querySchema.describe("Name or phone fragment to search for"),
  business: businessSlugSchema.optional().describe("Restrict to one business slug"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max results (1-50)"),
});
export type SearchClientsInput = z.infer<typeof SearchClientsInput>;

export const GetClientInput = z.object({
  clientId: cuidSchema.describe("Client id (cuid)"),
});
export type GetClientInput = z.infer<typeof GetClientInput>;

export const GetClientsInput = z.object({
  business: businessSlugSchema.optional().describe("Restrict to one business slug"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max results (1-50)"),
  offset: z.number().int().min(0).max(10_000).default(0).describe("Pagination offset"),
});
export type GetClientsInput = z.infer<typeof GetClientsInput>;

/* ─── Projects ─────────────────────────────────────────────── */

const workStatusSchema = z.enum(["WAITING", "IN_PROGRESS", "COMPLETED", "PAUSED"]);
export { workStatusSchema };
const paymentStatusSchema = z.enum(["FULL", "PARTIAL", "UNPAID"]);

export const GetProjectsInput = z.object({
  business: businessSlugSchema.optional(),
  clientId: cuidSchema.optional().describe("Only projects of this client"),
  workStatus: workStatusSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type GetProjectsInput = z.infer<typeof GetProjectsInput>;

export const GetProjectInput = z.object({
  projectId: cuidSchema.describe("Project record id (cuid)"),
});
export type GetProjectInput = z.infer<typeof GetProjectInput>;

/* ─── Businesses ───────────────────────────────────────────── */

export const GetBusinessSummaryInput = z.object({
  business: businessSlugSchema.describe("Business slug"),
});
export type GetBusinessSummaryInput = z.infer<typeof GetBusinessSummaryInput>;

export const GetBrandContextInput = z.object({
  business: businessSlugSchema.optional().describe(
    "One business, or omit for a compact profile of all three",
  ),
});
export type GetBrandContextInput = z.infer<typeof GetBrandContextInput>;

/* ═══════════════════════════════════════════════════════════════
   Phase 2A — action tool inputs (create + update only)

   Deliberately narrow and closed (z.strictObject): an agent that
   tries to send `deposit`, `paymentStatus`, `remaining`,
   `payRemaining`, `clientId` (on a project update), `businessId` or
   any delete flag gets a hard validation error rather than a silent
   partial success.
   ═══════════════════════════════════════════════════════════════ */

/** ClientTier — closed set, mirrors the Prisma enum. */
const clientTierSchema = z.enum(["VIP", "LOYAL", "NORMAL", "DELINQUENT"]);

/** Person / business entity name: trimmed, 1-120 chars. */
const nameSchema = z.string().trim().min(1).max(120);

/**
 * Phone numbers are unique per business (`@@unique([businessId, phone])`).
 * Digits plus the usual international punctuation; at least 3 characters.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s()\-]{2,31}$/, "Phone must start with a digit (optionally +) and use digits, spaces, ( ) or -");

/**
 * Money: finite, strictly positive, at most 2 decimals.
 * `min`/`max` (not `.finite()`) already exclude NaN and ±Infinity, and
 * the bound keeps the value inside the Decimal(12,2) column.
 * `multipleOf` is zod's float-safe remainder, so 1000.25 passes and
 * 1000.005 is rejected instead of being silently rounded.
 */
const amountSchema = z
  .number()
  .multipleOf(0.01, "Amount can have at most 2 decimal places")
  .min(0.01, "Amount must be greater than 0")
  .max(99_999_999.99, "Amount is out of range")
  .describe("Amount in the business currency, greater than 0, max 2 decimals");

/** YYYY-MM-DD or a full ISO 8601 timestamp; range-checked in the handler. */
const dateSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/, "Date must be ISO 8601, e.g. 2026-09-24")
  .describe("Service date, ISO 8601 (YYYY-MM-DD or full timestamp)");

/** Optional free text, trimmed and capped. Empty string stores NULL. */
const clearableTextSchema = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional();

/* ─── create_client ───────────────────────────────────────── */

export const CreateClientInput = z.strictObject({
  business: businessSlugSchema.describe("Explicit business slug: nexup | rebound | abomazen"),
  name: nameSchema.describe("Client full name"),
  phone: phoneSchema.describe("Client phone — must be unused by a live client in this business"),
  tier: clientTierSchema.optional().describe("Client tier; defaults to NORMAL"),
});
export type CreateClientInput = z.infer<typeof CreateClientInput>;

/* ─── update_client ───────────────────────────────────────── */

export const UpdateClientInput = z.strictObject({
  clientId: cuidSchema.describe("Client id (cuid)"),
  name: nameSchema.optional().describe("New client name"),
  phone: phoneSchema.optional().describe("New phone — must be unused by another live client in the same business"),
  tier: clientTierSchema.optional().describe("New client tier"),
});
export type UpdateClientInput = z.infer<typeof UpdateClientInput>;

/* ─── create_project ──────────────────────────────────────── */

/**
 * NO deposit / remaining / paymentStatus here, and none accepted:
 * the handler forces deposit = 0, remaining = totalPrice,
 * paymentStatus = UNPAID and writes no ClientPayment/PoolTransaction.
 */
export const CreateProjectInput = z.strictObject({
  business: businessSlugSchema.describe("Explicit business slug — the client must belong to it"),
  clientId: cuidSchema.describe("Existing client id that belongs to `business`"),
  projectName: z.string().trim().min(1).max(160).describe("Project / service name"),
  date: dateSchema,
  totalPrice: amountSchema.describe("Total agreed price (> 0). Recorded unpaid: deposit 0, remaining = totalPrice"),
  customServiceText: clearableTextSchema(2000).describe("Free-text description of a custom service"),
  workStatus: workStatusSchema.optional().describe("Work status; defaults to WAITING"),
  designerName: clearableTextSchema(120).describe("Designer name (free text)"),
  notes: clearableTextSchema(2000).describe("Internal notes"),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/* ─── update_project ──────────────────────────────────────── */

/**
 * Non-financial fields only. `deposit`, `remaining`, `totalPrice`,
 * `paymentStatus`, `payRemaining`, `clientId` and `businessId` are
 * not part of this schema and are rejected if sent.
 */
export const UpdateProjectInput = z.strictObject({
  projectId: cuidSchema.describe("Project record id (cuid)"),
  projectName: z.string().trim().min(1).max(160).optional().describe("New project name"),
  workStatus: workStatusSchema.optional().describe("New work status"),
  designerName: clearableTextSchema(120).describe("New designer name (null clears it)"),
  notes: clearableTextSchema(2000).describe("New notes (null clears them)"),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;
