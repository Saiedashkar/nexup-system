import { z } from "zod";
import { BUSINESS_SLUGS } from "./auth";

/* ═══════════════════════════════════════════════════════════════
   Input validation for every MCP tool (Phase 1 — read-only).
   Hard caps keep any single call cheap: page sizes are clamped,
   ids are cuid-shaped, enums are closed sets from the real schema.
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
