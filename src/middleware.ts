import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

// Business-specific route prefixes
const businessRoutes: Record<string, string[]> = {
  nexup: ["/office/nexup", "/api/nexup", "/api/pool", "/api/withdrawals", "/api/expenses", "/api/services", "/api/projects", "/api/client-payments"],
  rebound: ["/office/rebound", "/api/rebound", "/api/expenses"],
  abomazen: ["/office/abomazen", "/api/abomazen"],
};

// Office finance routes (require canAccessOfficeFinanceFull or SUPER_ADMIN)
const officeFinanceRoutes = [
  "/office/admin/dashboard",
  "/office/admin/partners",
  "/office/admin/partner-ledger",
  "/office/admin/profit-transfers",
  "/office/admin/office-expenses",
  "/office/admin/capital",
  "/office/admin/settings",
  "/api/office/admin-stats",
  "/api/office/profit-transfers",
  "/api/office/partners",
  "/api/office/partner-ledger",
  "/api/office/office-expenses",
  "/api/office/capital",
  "/api/office/settings",
  "/office/admin/users",
  "/api/admin/users",
];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname)) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect away from login page if already authenticated
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/office", request.url));
  }

  // Root page goes to /office
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/office", request.url));
  }

  // SUPER_ADMIN bypasses ALL permission checks
  if (session.role === "SUPER_ADMIN") return NextResponse.next();

  // ─── Check business-specific access ───
  for (const [slug, prefixes] of Object.entries(businessRoutes)) {
    if (prefixes.some(p => pathname === p || pathname.startsWith(p + "/"))) {
      const hasAccess =
        (slug === "nexup" && session.canAccessNexup) ||
        (slug === "rebound" && session.canAccessRebound) ||
        (slug === "abomazen" && session.canAccessAbomazen);

      if (!hasAccess) {
        if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Access denied" }, { status: 403 });
        return NextResponse.redirect(new URL("/office", request.url));
      }
    }
  }

  // ─── Check Office Finance access ───
  if (officeFinanceRoutes.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    if (!session.canAccessOfficeFinanceFull) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Access denied" }, { status: 403 });
      return NextResponse.redirect(new URL("/office", request.url));
    }
  }

  // ADMIN/EMPLOYEE: allowed for anything not caught above
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
