/**
 * WHO MAY READ WHAT, AND WHO MAY WRITE WHERE — one rule, no prisma.
 * ────────────────────────────────────────────────────────────────
 * `/api/clients` and `/api/projects` used to answer two different questions about
 * the same session: clients came from the permission FLAGS, projects from a bare
 * `businessId` comparison. A session could therefore read three clients and zero
 * projects, and no screen could say honestly what it was looking at.
 *
 * The rule now lives here, once, for both routes and for the scope line the
 * surfaces print:
 *
 *   • READ  — a session reads every company its flags grant (`getAccessibleBusinesses`).
 *             A super admin reads all of them. Nothing else widens a read.
 *   • WRITE — a read scope never authorises a write. A write names its company
 *             explicitly: a scoped session writes only its own, and a session *     that spans companies has to name one (the literal `"all"` is not a
 *             company and is refused). An employee may not write at all.
 *
 * Kept free of prisma and of `next/headers` so it can be tested directly; the
 * slug → row resolution lives in `read-scope-db.ts`.
 */

export type ScopedRole = "SUPER_ADMIN" | "ADMIN" | "EMPLOYEE";

/** The part of a session this module is allowed to look at. */
export type ScopedSession = {
  userId: string;
  role: ScopedRole;
  businessId: string;
  canAccessNexup: boolean;
  canAccessRebound: boolean;
  canAccessAbomazen: boolean;
};

export type ReadScopeMode = "all" | "companies";

export type ReadScopeSlugs = {
  mode: ReadScopeMode;
  slugs: string[];
};

/** The companies a session may READ — identical for every read route. */
export function readScopeSlugs(session: ScopedSession): ReadScopeSlugs {
  if (session.role === "SUPER_ADMIN") {
    return { mode: "all", slugs: ["nexup", "rebound", "abomazen"] };
  }
  const slugs: string[] = [];
  if (session.canAccessNexup) slugs.push("nexup");
  if (session.canAccessRebound) slugs.push("rebound");
  if (session.canAccessAbomazen) slugs.push("abomazen");
  return { mode: "companies", slugs };
}

/* `strict` is off in this project, so a discriminated union does not narrow at
   the call site; the inactive branch carries the other side's keys as optional
   so both routes can read `error`/`status` without a cast. */
export type WriteScopeResult =
  | { ok: true; businessId: string; explicit: boolean; status?: undefined; error?: undefined }
  | { ok: false; status: 400 | 403; error: string; businessId?: undefined; explicit?: undefined };

/**
 * The company a WRITE targets. `explicitBusinessId` is whatever the caller named
 * (query string, request body); a caller that names no company is never handed
 * one by accident, and a caller that names a company it does not own is refused.
 */
export function resolveWriteScope(
  session: ScopedSession,
  explicitBusinessId?: string | null,
): WriteScopeResult {
  const requested = typeof explicitBusinessId === "string" ? explicitBusinessId.trim() : "";

  /* Permission first, scope second: reading a company never implies writing it. */
  if (session.role === "EMPLOYEE") {
    return { ok: false, status: 403, error: "Access denied" };
  }

  if (session.role === "SUPER_ADMIN") {
    if (!requested || requested === "all") {
      return {
        ok: false,
        status: 400,
        error: "businessId is required: this session spans every company",
      };
    }
    return { ok: true, businessId: requested, explicit: true };
  }

  if (requested && requested !== session.businessId) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  if (!session.businessId || session.businessId === "all") {
    return { ok: false, status: 400, error: "This session carries no company" };
  }
  return { ok: true, businessId: session.businessId, explicit: false };
}
