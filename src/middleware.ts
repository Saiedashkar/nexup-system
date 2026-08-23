import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
const employeePaths = ["/clients", "/api/clients"];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname)) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "غير مصرح بتسجيل الدخول." }, { status: 401 });
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login") return NextResponse.redirect(new URL(session.role === "ADMIN" ? "/dashboard" : "/clients", request.url));

  // Employees are restricted to customer-work routes; financial routes and APIs are denied by default.
  if (session.role === "EMPLOYEE" && !employeePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "ليس لديك صلاحية للوصول إلى بيانات الحسابات." }, { status: 403 });
    return NextResponse.redirect(new URL("/clients", request.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
