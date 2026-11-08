/**
 * NEXUP COMMAND — DIRECTORY BINDING, THE WIRE TYPES
 * ─────────────────────────────────────────────────
 * These are the shapes the EXISTING routes answer with, named once so the
 * surfaces do not each invent a private view of them:
 *
 *   GET /api/clients   → ClientDto[]   (session-scoped, enriched)
 *   GET /api/projects  → ProjectDto[]  (session-scoped, enriched)
 *   GET /api/auth/me   → { user: SessionDto }
 *
 * The routes are the authority on scoping, so the client never filters by a
 * company of its own: it renders exactly what the session was allowed to read.
 *
 * MONEY IS DECIMAL ON THE WIRE. Prisma serialises `Decimal` as a string, so
 * every amount is typed `number | string` and normalised once in `mapping.ts`
 * rather than being trusted at each render site.
 */

/* ── Enumerations as the database declares them ─────────────────────────── */

/** `enum ClientTier` in prisma/schema.prisma. */
export type Tier = "VIP" | "LOYAL" | "NORMAL" | "DELINQUENT";

/** `enum WorkStatus` in prisma/schema.prisma. */
export type WorkStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED" | "PAUSED";

/** `enum PaymentStatus` in prisma/schema.prisma. */
export type PaymentStatus = "FULL" | "PARTIAL" | "UNPAID";

/* ── GET /api/clients ───────────────────────────────────────────────────── */

/** The project summary embedded in a client row (subset of ProjectRecord). */
export type ClientProjectDto = {
  id: string;
  projectName: string;
  totalPrice: number | string;
  deposit: number | string;
  workStatus: string;
  paymentStatus: string;
  date: string;
};

export type ClientDto = {
  id: string;
  /** The company that owns the row — shown only in the "all companies" read. */
  businessId?: string;
  name: string;
  phone: string;
  /** The stored tier; the route ALSO returns a computed tier of the same name. */
  tier?: string;
  createdAt?: string;
  projectRecords?: ClientProjectDto[];
  /** Computed by the route from the client's own projects. */
  projectCount?: number;
  totalPaid?: number;
  totalRemaining?: number;
  isRepeatClient?: boolean;
};

/* ── GET /api/projects ──────────────────────────────────────────────────── */

export type ProjectDto = {
  id: string;
  businessId?: string;
  clientId: string;
  projectName: string;
  date: string;
  customServiceText?: string | null;
  totalPrice: number | string;
  deposit: number | string;
  remaining: number | string;
  workStatus: string;
  paymentStatus: string;
  designerName?: string | null;
  designer?: { id: string; name: string } | null;
  services?: Array<{ id: string; name: string }>;
  client?: {
    id: string;
    name: string;
    phone: string;
    tier?: string;
    projectCount?: number;
    totalPaid?: number;
    isRepeatClient?: boolean;
  } | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/* ── GET /api/auth/me ───────────────────────────────────────────────────── */

/**
 * The session, as the route reports it. `business` is the session's own company
 * (absent for a super admin operating across every company) — which is what the
 * pages print instead of the shell's demo scope label.
 */
export type SessionDto = {
  userId: string;
  name: string;
  role: "SUPER_ADMIN" | "ADMIN" | "EMPLOYEE";
  businessId: string;
  business?: { id: string; name: string; slug: string } | null;
  canAccessNexup: boolean;
  canAccessRebound: boolean;
  canAccessAbomazen: boolean;
};
