/**
 * THE TRIAL LOCK, TESTED WITHOUT A DATABASE.
 *
 * `TRIAL_READ_ONLY=1` is what makes the private mobile trial a read surface: every
 * mutating API call is refused except sign-in/sign-out, and the external-execution
 * surfaces are closed for every method. Unset, nothing changes — the production
 * behaviour of this middleware is the one the other suite pins.
 *
 * No Prisma import, no rows: only the middleware, a real signed cookie and the
 * environment variable. That is also what keeps this suite runnable on a machine
 * with no database at all.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import middleware from "@/middleware";
import { createSessionToken, SESSION_COOKIE, type Session } from "@/lib/auth";

process.env.AUTH_SECRET ||= "trial-lock-test-secret-value-at-least-32";

const superAdmin: Session = {
  userId: "trial-owner",
  name: "Trial Owner",
  role: "SUPER_ADMIN",
  businessId: "all",
  canAccessNexup: true,
  canAccessRebound: true,
  canAccessAbomazen: true,
  canAccessOfficeFinanceFull: true,
};

const call = async (pathname: string, method = "GET", withSession = true) => {
  const headers: Record<string, string> = {};
  if (withSession) {
    headers.cookie = `${SESSION_COOKIE}=${await createSessionToken(superAdmin)}`;
  }
  return middleware(new NextRequest(`http://localhost:3100${pathname}`, { method, headers }));
};

const passthrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1" || response.status === 200;

const body = async (response: Response) => (await response.json()) as { error?: string };

afterEach(() => {
  delete process.env.TRIAL_READ_ONLY;
});

describe("trial lock — off by default", () => {
  it("lets a write through when TRIAL_READ_ONLY is unset", async () => {
    delete process.env.TRIAL_READ_ONLY;
    const response = await call("/api/projects", "POST");
    expect(passthrough(response)).toBe(true);
  });

  it("keeps the EXEC surface reachable when the flag is off (the route owns its own auth)", async () => {
    delete process.env.TRIAL_READ_ONLY;
    const response = await call("/api/exec/turn", "POST");
    expect(response.status).not.toBe(403);
  });
});

describe("trial lock — on", () => {
  it("refuses a project write with the trial message", async () => {
    process.env.TRIAL_READ_ONLY = "1";
    const response = await call("/api/projects", "POST");
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: "This trial is read-only." });
  });

  it("refuses client writes, project updates and deletes, and the cleanup", async () => {
    process.env.TRIAL_READ_ONLY = "1";
    for (const [path, method] of [
      ["/api/clients", "POST"],
      ["/api/clients/bulk-delete", "DELETE"],
      ["/api/projects/project-1", "PATCH"],
      ["/api/projects/project-1", "DELETE"],
      ["/api/clients/client-1", "DELETE"],
      ["/api/client-payments", "POST"],
      ["/api/office/capital-spends", "POST"],
    ] as const) {
      const response = await call(path, method);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await body(response)).toEqual({ error: "This trial is read-only." });
    }
  });

  it("keeps every read the trial actually needs", async () => {
    process.env.TRIAL_READ_ONLY = "1";
    for (const path of [
      "/api/auth/me",
      "/api/clients",
      "/api/projects",
      "/api/office/stats",
      "/command/clients",
      "/command/projects",
    ]) {
      const response = await call(path);
      expect(passthrough(response), `GET ${path}`).toBe(true);
    }
  });

  it("still lets the operator sign in and out", async () => {
    process.env.TRIAL_READ_ONLY = "1";
    expect(passthrough(await call("/api/auth/login", "POST", false))).toBe(true);
    expect(passthrough(await call("/api/auth/logout", "POST", false))).toBe(true);
  });

  it("closes the external-execution surfaces for every method, signed in or not", async () => {
    process.env.TRIAL_READ_ONLY = "1";
    for (const [path, method, withSession] of [
      ["/api/exec/turn", "POST", true],
      ["/api/exec/turn", "POST", false],
      ["/api/ai-workforce/health", "GET", true],
      ["/api/ai-workforce/jobs", "POST", true],
      ["/api/ai-workforce/missions", "GET", false],
    ] as const) {
      const response = await call(path, method, withSession);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await body(response)).toEqual({ error: "External execution is disabled in this trial." });
    }
  });
});
