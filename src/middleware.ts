import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

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

// Business-specific route prefixes.
//
// `/api/projects` and `/api/clients` are deliberately NOT here. They are the two
// SHARED reads: each resolves the session's companies itself, with the same rule
// (`lib/read-scope.ts`), so the gate in front of them could only answer a
// different question than the route did — that is how one session ended up able
// to read a company's clients and not its projects. Every company keeps its own
// typed routes (`/api/nexup`, `/api/rebound`, `/api/abomazen`), which remain
// gated below, and the project rows these two return were already readable
// through `/api/clients` for exactly the same companies.
const businessRoutes: Record<string, string[]> = {
  nexup: ["/office/nexup", "/api/nexup", "/api/pool", "/api/withdrawals", "/api/expenses", "/api/services", "/api/client-payments"],
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
