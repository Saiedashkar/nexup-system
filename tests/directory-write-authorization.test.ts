/**
 * THE GATES BEHIND /api/projects AND /api/clients, TESTED WHERE THEY RUN.
 *
 * Not the scope rule in isolation — the REAL middleware and the REAL route
 * handlers, against a throwaway database of two companies, with only the session
 * source mocked. Every refused request is checked against the rows it would have
 * touched: the client, its projects, its payments, its treasury movements and its
 * subscriptions must be exactly as they were.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({ current: null as import("@/lib/auth").Session | null }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentSession: async () => authState.current };
});

import middleware from "@/middleware";
import { createSessionToken, SESSION_COOKIE, type Session } from "@/lib/auth";
import { prisma, prismaRaw } from "@/lib/prisma";
import { GET as listProjects, POST as createProject } from "@/app/api/projects/route";
import {
  DELETE as deleteProject,
  PATCH as patchProject,
} from "@/app/api/projects/[id]/route";
import { DELETE as deleteClient } from "@/app/api/clients/[id]/route";
import { DELETE as cleanupClients, GET as listClients } from "@/app/api/clients/route";
import { GET as officeStats } from "@/app/api/office/stats/route";

process.env.AUTH_SECRET ||= "directory-write-test-secret-value-at-least-32";

/* Throwaway database lifecycle — the same recipe the capital suites use. The
   setup file binds the Prisma pool to `.../capital_test`, and this file owns that
   database for its own run (files run sequentially: fileParallelism: false). */
const BASE_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435";
const DB_NAME = "capital_test";
const DB_URL = `${BASE_URL}/${DB_NAME}`;
const PSQL = `"${process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"}" -h 127.0.0.1 -p ${new URL(BASE_URL).port || 5432} -U postgres`;
const ENV = { ...process.env, PGPASSWORD: "postgres", DATABASE_URL: DB_URL };

function psql(sql: string, db = "postgres") {
  return execSync(`${PSQL} -c "${sql.replace(/"/g, '\\"')}" -d ${db}`, { env: ENV, stdio: "pipe" });
}

beforeAll(async () => {
  try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* may not exist */ }
  psql(`CREATE DATABASE "${DB_NAME}"`);
  execSync(`npx prisma db push --schema=prisma/schema.prisma --url "${DB_URL}"`, {
    env: ENV,
    stdio: "pipe",
    cwd: path.resolve(__dirname, ".."),
  });
}, 240_000);

afterAll(async () => {
  /* The database is NOT dropped here. `DROP DATABASE … WITH (FORCE)` terminates
     the app pool's idle connections, and pg raises that termination as an
     uncaught error — the same "unhandled ECONNRESET" the capital suites carry in
     their teardown. The pool is closed instead, and the next run's `beforeAll`
     drops and recreates the database on a silent cluster. */
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { await prismaRaw.$disconnect(); } catch { /* ignore */ }
});

type Row = Record<string, unknown>;

let bizA: { id: string; slug: string };
let bizB: { id: string; slug: string };
let clientA: { id: string };
let clientB: { id: string };
let projectA: { id: string };
let projectB: { id: string };
let orphanA: { id: string };
let orphanB: { id: string };

const date = new Date("2026-11-01T10:00:00.000Z");

beforeEach(async () => {
  await prismaRaw.paymentReceipt.deleteMany({});
  await prismaRaw.subscriptionInvoice.deleteMany({});
  await prismaRaw.clientPayment.deleteMany({});
  await prismaRaw.poolTransaction.deleteMany({});
  await prismaRaw.projectRecord.deleteMany({});
  await prismaRaw.subscription.deleteMany({});
  await prismaRaw.client.deleteMany({});
  await prismaRaw.activityLog.deleteMany({});
  await prismaRaw.serviceType.deleteMany({});
  await prismaRaw.user.deleteMany({});
  await prismaRaw.business.deleteMany({});

  bizA = await prismaRaw.business.create({ data: { name: "NEXUP GATE TEST", slug: "nexup" } });
  bizB = await prismaRaw.business.create({ data: { name: "ABOMAZEN GATE TEST", slug: "abomazen" } });

  /* The activity log points at a real user, and the sessions below reuse these
     ids — an allowed write must succeed for the right reason, not fail on a
     foreign key. */
  await prismaRaw.user.createMany({
    data: [
      { id: "adm-a", email: "adm-a@gate.test", name: "مدير أ", passwordHash: "x", role: "ADMIN", businessId: bizA.id },
      { id: "adm-b", email: "adm-b@gate.test", name: "مدير ب", passwordHash: "x", role: "ADMIN", businessId: bizB.id },
      { id: "emp-a", email: "emp-a@gate.test", name: "موظف أ", passwordHash: "x", role: "EMPLOYEE", businessId: bizA.id },
      { id: "adm-carried", email: "adm-carried@gate.test", name: "حامل ب", passwordHash: "x", role: "ADMIN", businessId: bizB.id },
      { id: "adm-none", email: "adm-none@gate.test", name: "بلا أعلام", passwordHash: "x", role: "ADMIN", businessId: null },
      { id: "root", email: "root@gate.test", name: "مدير عام", passwordHash: "x", role: "SUPER_ADMIN", businessId: null },
    ],
  });

  clientA = await prismaRaw.client.create({
    data: { businessId: bizA.id, phone: "0100", name: "عميل أ" },
  });
  clientB = await prismaRaw.client.create({
    data: { businessId: bizB.id, phone: "0200", name: "عميل ب" },
  });
  orphanA = await prismaRaw.client.create({
    data: { businessId: bizA.id, phone: "0101", name: "يتيم أ" },
  });
  orphanB = await prismaRaw.client.create({
    data: { businessId: bizB.id, phone: "0201", name: "يتيم ب" },
  });

  projectA = await prismaRaw.projectRecord.create({
    data: {
      businessId: bizA.id, clientId: clientA.id, projectName: "مشروع أ",
      date, totalPrice: 1000, deposit: 400, remaining: 600,
    },
  });
  projectB = await prismaRaw.projectRecord.create({
    data: {
      businessId: bizB.id, clientId: clientB.id, projectName: "مشروع ب",
      date, totalPrice: 800, deposit: 200, remaining: 600,
    },
  });

  for (const [project, business] of [[projectA, bizA], [projectB, bizB]] as const) {
    await prismaRaw.poolTransaction.create({
      data: { businessId: business.id, projectRecordId: project.id, amountSAR: 1, type: "IN", date },
    });
    await prismaRaw.clientPayment.create({
      data: { projectRecordId: project.id, amount: 1, date },
    });
  }
  await prismaRaw.subscription.create({
    data: { clientId: clientA.id, businessId: bizA.id, services: "[]", monthlyFee: 100, startDate: date },
  });
});

const base = { name: "Gate Test", canAccessOfficeFinanceFull: false } as const;

const sessions = () => ({
  adminA: {
    ...base, userId: "adm-a", role: "ADMIN", businessId: bizA.id,
    canAccessNexup: true, canAccessRebound: false, canAccessAbomazen: false,
  } as Session,
  adminB: {
    ...base, userId: "adm-b", role: "ADMIN", businessId: bizB.id,
    canAccessNexup: false, canAccessRebound: false, canAccessAbomazen: true,
  } as Session,
  employeeA: {
    ...base, userId: "emp-a", role: "EMPLOYEE", businessId: bizA.id,
    canAccessNexup: true, canAccessRebound: false, canAccessAbomazen: false,
  } as Session,
  /* Carries company B in `businessId`, but has no flag for it at all. */
  carriedBNoFlag: {
    ...base, userId: "adm-carried", role: "ADMIN", businessId: bizB.id,
    canAccessNexup: true, canAccessRebound: false, canAccessAbomazen: false,
  } as Session,
  noFlagsAdmin: {
    ...base, userId: "adm-none", role: "ADMIN", businessId: "all",
    canAccessNexup: false, canAccessRebound: false, canAccessAbomazen: false,
  } as Session,
  superAdmin: {
    ...base, userId: "root", role: "SUPER_ADMIN", businessId: "all",
    canAccessNexup: true, canAccessRebound: true, canAccessAbomazen: true,
  } as Session,
});

const as = (session: Session) => {
  authState.current = session;
};

const request = (url: string, method: string, body?: unknown, session?: Session) => {
  if (session) as(session);
  return new NextRequest(`http://localhost:3100${url}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Everything a refused request could have changed, for one client. */
const clientState = async (clientId: string) => {
  const client = await prismaRaw.client.findUnique({
    where: { id: clientId },
    select: { name: true, tier: true, deletedAt: true, businessId: true },
  });
  return {
    name: client?.name,
    tier: client?.tier,
    hidden: client?.deletedAt !== null && client?.deletedAt !== undefined,
    projects: await prismaRaw.projectRecord.count({ where: { clientId } }),
    payments: await prismaRaw.clientPayment.count({ where: { projectRecord: { clientId } } }),
    poolMovements: await prismaRaw.poolTransaction.count({ where: { projectRecord: { clientId } } }),
    subscriptions: await prismaRaw.subscription.count({ where: { clientId } }),
  };
};

/** The whole ledger of both companies — a refused write must move none of it. */
const worldState = async (): Promise<Row> => ({
  clients: await prismaRaw.client.count(),
  liveClients: await prismaRaw.client.count({ where: { deletedAt: null } }),
  projects: await prismaRaw.projectRecord.count(),
  liveProjects: await prismaRaw.projectRecord.count({ where: { deletedAt: null } }),
  payments: await prismaRaw.clientPayment.count({ where: { deletedAt: null } }),
  poolMovements: await prismaRaw.poolTransaction.count({ where: { deletedAt: null } }),
  subscriptions: await prismaRaw.subscription.count({ where: { deletedAt: null } }),
});

const passthrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1" || response.status === 200;

/** The middleware reads the real signed cookie, so these calls carry one. */
const middlewareFor = async (pathname: string, session: Session) => {
  const token = await createSessionToken(session);
  return middleware(
    new NextRequest(`http://localhost:3100${pathname}`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    }),
  );
};

const newProjectBody = (over: Row = {}) => ({
  clientPhone: "0999",
  clientName: "عميل جديد",
  projectName: "مشروع جديد",
  date: "2026-11-08",
  totalPrice: 1000,
  deposit: 100,
  ...over,
});

describe("middleware — the projects workspace is a capability, not a company", () => {
  it("refuses a manager with no company flags at all", async () => {
    const s = sessions();
    const api = await middlewareFor("/api/projects", s.noFlagsAdmin);
    expect(api.status).toBe(403);

    const page = await middlewareFor("/command/projects", s.noFlagsAdmin);
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/office");

    const clientsPage = await middlewareFor("/command/clients", s.noFlagsAdmin);
    expect(clientsPage.status).toBe(307);
  });

  it("lets an employee with a company allowance into the workspace (the route still scopes the rows)", async () => {
    const s = sessions();
    const response = await middlewareFor("/api/projects", s.employeeA);
    expect(passthrough(response)).toBe(true);
  });

  it("lets a manager of ANOTHER company into its own projects — the gate no longer asks for nexup", async () => {
    const s = sessions();
    const response = await middlewareFor("/api/projects", s.adminB);
    expect(passthrough(response)).toBe(true);
  });

  it("keeps every company's own typed routes gated", async () => {
    const s = sessions();
    const foreign = await middlewareFor("/api/nexup/dashboard", s.adminB);
    expect(foreign.status).toBe(403);
    const own = await middlewareFor("/api/abomazen/dashboard", s.adminB);
    expect(passthrough(own)).toBe(true);
  });

  it("refuses a signed-out request before any permission question", async () => {
    const response = await middleware(new NextRequest("http://localhost:3100/api/projects"));
    expect(response.status).toBe(401);
  });
});

describe("GET — a capability opens the workspace, the flags scope the rows", () => {
  it("refuses a manager with no flags on the projects read", async () => {
    const s = sessions();
    const response = await listProjects(request("/api/projects", "GET", undefined, s.noFlagsAdmin));
    expect(response.status).toBe(403);
  });

  it("returns only the session's own company to an employee", async () => {
    const s = sessions();
    const response = await listProjects(request("/api/projects", "GET", undefined, s.employeeA));
    expect(response.status).toBe(200);
    const rows = (await response.json()) as { businessId: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].businessId).toBe(bizA.id);
  });

  it("reads the same companies on both routes", async () => {
    const s = sessions();
    const projects = (await (
      await listProjects(request("/api/projects", "GET", undefined, s.adminA))
    ).json()) as { businessId: string }[];
    const clients = (await (await listClients()).json()) as { businessId: string }[];
    expect(new Set(projects.map((p) => p.businessId))).toEqual(new Set([bizA.id]));
    expect(new Set(clients.map((c) => c.businessId))).toEqual(new Set([bizA.id]));
  });
});

describe("POST /api/projects — role, company flag, target company, and the client's owner", () => {
  it("refuses an employee and writes nothing", async () => {
    const s = sessions();
    const before = await worldState();
    const response = await createProject(
      request("/api/projects", "POST", newProjectBody(), s.employeeA),
    );
    expect(response.status).toBe(403);
    expect(await worldState()).toEqual(before);
  });

  it("refuses a manager with no flags", async () => {
    const s = sessions();
    const before = await worldState();
    const response = await createProject(
      request("/api/projects", "POST", newProjectBody({ businessId: bizA.id }), s.noFlagsAdmin),
    );
    expect(response.status).toBe(403);
    expect(await worldState()).toEqual(before);
  });

  it("refuses a company the session merely carries without its flag", async () => {
    const s = sessions();
    const before = await worldState();
    const response = await createProject(
      request("/api/projects", "POST", newProjectBody(), s.carriedBNoFlag),
    );
    expect(response.status).toBe(403);
    expect(await worldState()).toEqual(before);
  });

  it("refuses naming another company explicitly", async () => {
    const s = sessions();
    const before = await worldState();
    const response = await createProject(
      request("/api/projects", "POST", newProjectBody({ businessId: bizA.id }), s.adminB),
    );
    expect(response.status).toBe(403);
    expect(await worldState()).toEqual(before);
  });

  it("refuses a FOREIGN client before touching it or creating anything", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const world = await worldState();

    const response = await createProject(
      request(
        "/api/projects",
        "POST",
        newProjectBody({
          businessId: bizB.id,
          clientId: clientA.id,
          clientName: "اسم لا يجب أن يُحفظ",
        }),
        s.adminB,
      ),
    );

    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
    expect(await worldState()).toEqual(world);
  });

  it("creates the project, its deposit and the client's tier inside one transaction", async () => {
    const s = sessions();
    const response = await createProject(
      request("/api/projects", "POST", newProjectBody({ businessId: bizB.id }), s.adminB),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; businessId: string; clientId: string };
    expect(created.businessId).toBe(bizB.id);

    const project = await prismaRaw.projectRecord.findUnique({ where: { id: created.id } });
    expect(project?.businessId).toBe(bizB.id);
    const movement = await prismaRaw.poolTransaction.count({
      where: { projectRecordId: created.id },
    });
    expect(movement).toBe(1);
  });

  it("leaves NOTHING behind when the write fails halfway (no renamed client, no orphan project)", async () => {
    const s = sessions();
    const before = await clientState(clientB.id);
    const world = await worldState();

    const response = await createProject(
      request(
        "/api/projects",
        "POST",
        newProjectBody({
          businessId: bizB.id,
          clientId: clientB.id,
          clientName: "اسم نصف مكتوب",
          // A designer that does not exist: the project insert fails AFTER the
          // rename would have been written, which is exactly what the
          // transaction has to undo.
          designerId: "designer-that-does-not-exist",
        }),
        s.adminB,
      ),
    );

    expect(response.status).toBe(500);
    expect(await clientState(clientB.id)).toEqual(before);
    expect(await worldState()).toEqual(world);
  });

  it("lets a super admin create in a company it names — and only a company it names", async () => {
    const s = sessions();
    const unnamed = await createProject(
      request("/api/projects", "POST", newProjectBody(), s.superAdmin),
    );
    expect(unnamed.status).toBe(400);

    const named = await createProject(
      request("/api/projects", "POST", newProjectBody({ businessId: bizA.id }), s.superAdmin),
    );
    expect(named.status).toBe(201);
  });
});

describe("PATCH /api/projects/[id] — same gates, and no partial money", () => {
  it("refuses an employee", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await patchProject(
      request(`/api/projects/${projectA.id}`, "PATCH", { deposit: 900 }, s.employeeA),
      params(projectA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });

  it("refuses a manager of another company", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await patchProject(
      request(`/api/projects/${projectA.id}`, "PATCH", { deposit: 900 }, s.adminB),
      params(projectA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });

  it("refuses a manager with no company at all", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await patchProject(
      request(`/api/projects/${projectA.id}`, "PATCH", { deposit: 900 }, s.noFlagsAdmin),
      params(projectA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });

  it("applies an allowed payment as one movement pair", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await patchProject(
      request(`/api/projects/${projectA.id}`, "PATCH", { deposit: 900 }, s.adminA),
      params(projectA.id),
    );
    expect(response.status).toBe(200);
    const after = await clientState(clientA.id);
    expect(after.payments).toBe(before.payments + 1);
    expect(after.poolMovements).toBe(before.poolMovements + 1);
  });
});

describe("DELETE /api/projects/[id] — an employee cannot remove a project (or hide its client)", () => {
  it("refuses an employee and leaves project, client and money in place", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await deleteProject(
      request(`/api/projects/${projectA.id}`, "DELETE", undefined, s.employeeA),
      params(projectA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
    const project = await prismaRaw.projectRecord.findUnique({ where: { id: projectA.id } });
    expect(project?.deletedAt).toBeNull();
  });

  it("refuses a manager of another company", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await deleteProject(
      request(`/api/projects/${projectA.id}`, "DELETE", undefined, s.adminB),
      params(projectA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });
});

describe("DELETE /api/clients/[id] — an admin operation, never an employee one", () => {
  it("refuses an employee: client, project, payments and subscription stay live", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await deleteClient(
      request(`/api/clients/${clientA.id}`, "DELETE", undefined, s.employeeA),
      params(clientA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
    expect(before.hidden).toBe(false);
  });

  it("refuses a manager of another company", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await deleteClient(
      request(`/api/clients/${clientA.id}`, "DELETE", undefined, s.adminB),
      params(clientA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });

  it("refuses a manager with no company flags", async () => {
    const s = sessions();
    const before = await clientState(clientA.id);
    const response = await deleteClient(
      request(`/api/clients/${clientA.id}`, "DELETE", undefined, s.noFlagsAdmin),
      params(clientA.id),
    );
    expect(response.status).toBe(403);
    expect(await clientState(clientA.id)).toEqual(before);
  });

  it("lets the company's own admin hide it and everything under it", async () => {
    const s = sessions();
    const response = await deleteClient(
      request(`/api/clients/${clientA.id}`, "DELETE", undefined, s.adminA),
      params(clientA.id),
    );
    expect(response.status).toBe(200);
    const after = await clientState(clientA.id);
    expect(after.hidden).toBe(true);
    expect(await prismaRaw.subscription.count({ where: { clientId: clientA.id, deletedAt: null } })).toBe(0);
  });
});

describe("DELETE /api/clients — the cleanup obeys the same policy", () => {
  it("refuses an employee", async () => {
    const s = sessions();
    const response = await cleanupClients(
      request(`/api/clients?businessId=${bizA.id}`, "DELETE", undefined, s.employeeA),
    );
    expect(response.status).toBe(403);
    expect((await clientState(orphanA.id)).hidden).toBe(false);
  });

  it("refuses a manager of another company", async () => {
    const s = sessions();
    const response = await cleanupClients(
      request(`/api/clients?businessId=${bizA.id}`, "DELETE", undefined, s.adminB),
    );
    expect(response.status).toBe(403);
    expect((await clientState(orphanA.id)).hidden).toBe(false);
  });

  it("cleans only the named company", async () => {
    const s = sessions();
    const response = await cleanupClients(
      request(`/api/clients?businessId=${bizB.id}`, "DELETE", undefined, s.adminB),
    );
    expect(response.status).toBe(200);
    expect((await clientState(orphanB.id)).hidden).toBe(true);
    expect((await clientState(orphanA.id)).hidden).toBe(false);
  });
});

describe("GET /api/office/stats — the dashboard must not delete for an employee (or across companies)", () => {
  it("keeps an employee's orphan client visible", async () => {
    const s = sessions();
    as(s.employeeA);
    await officeStats();
    expect((await clientState(orphanA.id)).hidden).toBe(false);
  });

  it("cleans only the companies the admin's flags grant", async () => {
    const s = sessions();
    as(s.adminA);
    await officeStats();
    expect((await clientState(orphanA.id)).hidden).toBe(true);
    expect((await clientState(orphanB.id)).hidden).toBe(false);
  });
});
