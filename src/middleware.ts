import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type Session } from "@/lib/auth";
import { canUseDirectoryFeature, canUseProjectsFeature } from "@/lib/read-scope";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

// EXEC conversation turn — ROUTE-MANAGED AUTH.
//
// This is deliberately an exact-path set, not a prefix: only the one route that
// owns the `exec-conversation/v1` error envelope (and must answer a foreign
// origin with 403 before it says anything about a session) skips the blanket
// `/api/**` 401 here. The route is NOT public — the handler re-checks the
// session itself, and nothing runs without it. Any sibling path, including
// `/api/exec/turn/<anything>`, keeps the blanket guard below.
const routeManagedAuthPaths = new Set(["/api/exec/turn"]);

// Business-specific route prefixes: "may this session enter THIS COMPANY" — a
// company question, answered per prefix.
const businessRoutes: Record<string, string[]> = {
  nexup: ["/office/nexup", "/api/nexup", "/api/pool", "/api/withdrawals", "/api/expenses", "/api/services", "/api/client-payments"],
  rebound: ["/office/rebound", "/api/rebound", "/api/expenses"],
  abomazen: ["/office/abomazen", "/api/abomazen"],
};

// Feature gates: "may this session use this capability at all", independent of
// which companies it may see. Each entry is answered by the same pure rule the
// route uses (`lib/read-scope.ts`), so the gate and the handler cannot disagree.
const featureRoutes: { prefixes: string[]; allows: (session: Session) => boolean }[] = [
  /* Projects are an operator surface: an employee is refused here, on the page and
     through the API, whatever company flags it carries. */
  { prefixes: ["/api/projects", "/command/projects"], allows: canUseProjectsFeature },
  { prefixes: ["/command/clients"], allows: canUseDirectoryFeature },
];

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
  "/api/office/capital-ledger",
  "/api/office/capital-spends",
  "/api/office/fixed-expenses",
  "/api/office/settings",
  "/office/admin/users",
  "/api/admin/users",
  // AI Workforce (control core). Additive: these prefixes did not exist before,
  // and access is intentionally limited to office-finance/super-admin in
  // Phase 1A. The workforce permission policy still re-checks every tool call.
  "/office/ai-workforce",
  "/api/ai-workforce",
];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (routeManagedAuthPaths.has(pathname)) return NextResponse.next();
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

  // ─── Check FEATURE access ───
  //
  // A capability, not a company: any company allowance opens the clients/projects
  // workspace, and every row it returns is still scoped by the flags below.
  // `/api/projects` used to sit in `businessRoutes.nexup`, which made "the nexup
  // flag" the price of the whole workspace and told an abomazen admin it could
  // not open the page for its own projects; the capability rule restores that gate
  // without re-coupling it to one company. The route re-checks it too, so calling
  // the handler directly is refused just the same.
  for (const feature of featureRoutes) {
    if (feature.prefixes.some(p => pathname === p || pathname.startsWith(p + "/"))) {
      if (!feature.allows(session)) {
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

// Exclude Next.js internals from auth entirely: only real app routes should be
// gated. The previous matcher only skipped `/_next/static`, so `next dev`
// resources such as `/_next/hmr` and `/__nextjs_*` were redirected to /login —
// which broke the HMR socket and the dev overlay.
export const config = { matcher: ["/((?!_next|__nextjs|favicon.ico).*)"] };
