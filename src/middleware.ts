import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
const employeePaths = ["/clients", "/api/clients"];
const adminPaths = ["/dashboard", "/finance", "/api/projects", "/api/pool", "/api/withdrawals", "/api/expenses", "/api/services", "/api/users"];

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

  if (pathname === "/login") {
    if (session.role === "SUPER_ADMIN") return NextResponse.redirect(new URL("/office", request.url));
    if (session.role === "ADMIN") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.redirect(new URL("/clients", request.url));
  }

  // SUPER_ADMIN can access everything
  if (session.role === "SUPER_ADMIN") return NextResponse.next();

  // ADMIN can access admin + employee routes
  if (session.role === "ADMIN") {
    // Allow admin and employee routes
    return NextResponse.next();
  }

  // EMPLOYEE: restricted to client-work routes only
  if (session.role === "EMPLOYEE" && !employeePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    return NextResponse.redirect(new URL("/clients", request.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
