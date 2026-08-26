import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "nexup_session";
const sessionDurationSeconds = 60 * 60 * 8;

export type Session = {
  userId: string;
  name: string;
  role: Role;
  businessId: string; // SUPER_ADMIN gets "all" or specific businessId
  // ─── Permission Flags ───
  canAccessNexup: boolean;
  canAccessRebound: boolean;
  canAccessAbomazen: boolean;
  canAccessOfficeFinanceFull: boolean;
};

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(session: Session) {
  return new SignJWT({
    name: session.name,
    role: session.role,
    businessId: session.businessId,
    canAccessNexup: session.canAccessNexup,
    canAccessRebound: session.canAccessRebound,
    canAccessAbomazen: session.canAccessAbomazen,
    canAccessOfficeFinanceFull: session.canAccessOfficeFinanceFull,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationSeconds}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token?: string): Promise<Session | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.sub !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.businessId !== "string" ||
      (payload.role !== "SUPER_ADMIN" && payload.role !== "ADMIN" && payload.role !== "EMPLOYEE")
    ) return null;

    return {
      userId: payload.sub,
      name: payload.name,
      role: payload.role as Role,
      businessId: payload.businessId,
      canAccessNexup: payload.canAccessNexup === true,
      canAccessRebound: payload.canAccessRebound === true,
      canAccessAbomazen: payload.canAccessAbomazen === true,
      canAccessOfficeFinanceFull: payload.canAccessOfficeFinanceFull === true,
    };
  } catch {
    return null;
  }
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: sessionDurationSeconds,
};

/** Check if user has admin-level access (SUPER_ADMIN or ADMIN) */
export function isAdmin(session: Session): boolean {
  return session.role === "SUPER_ADMIN" || session.role === "ADMIN";
}

/** Check if user is super admin */
export function isSuperAdmin(session: Session): boolean {
  return session.role === "SUPER_ADMIN";
}

// ═══════════════════════════════════════════════════════
// Permission Flag Helpers (Backend Enforcement)
// ═══════════════════════════════════════════════════════

/** SUPER_ADMIN bypasses all permission checks — always returns true */
export function canAccessBusiness(session: Session, businessSlug: string): boolean {
  // SUPER_ADMIN always has full access
  if (session.role === "SUPER_ADMIN") return true;

  switch (businessSlug) {
    case "nexup": return session.canAccessNexup;
    case "rebound": return session.canAccessRebound;
    case "abomazen": return session.canAccessAbomazen;
    default: return false;
  }
}

/** Check if user can access Office Finance full admin pages */
export function canAccessOfficeFinance(session: Session): boolean {
  if (session.role === "SUPER_ADMIN") return true;
  return session.canAccessOfficeFinanceFull;
}

/** Get all business slugs the user can access */
export function getAccessibleBusinesses(session: Session): string[] {
  if (session.role === "SUPER_ADMIN") return ["nexup", "rebound", "abomazen"];
  const slugs: string[] = [];
  if (session.canAccessNexup) slugs.push("nexup");
  if (session.canAccessRebound) slugs.push("rebound");
  if (session.canAccessAbomazen) slugs.push("abomazen");
  return slugs;
}
