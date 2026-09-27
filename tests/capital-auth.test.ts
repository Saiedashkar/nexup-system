import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import type { NextRequest } from "next/server";

/* Authorization tests for the Capital mutation endpoints.
   Strategy: import the REAL route handlers and mock ONLY the session
   provider (getCurrentSession). canAccessOfficeFinance is delegated to
   the genuine centralized policy from @/lib/auth, so these tests prove
   the routes gate on the same Office Finance rule as the rest of the
   area — and would fail if any handler regressed to a hardcoded
   `session.role === "SUPER_ADMIN"` check. */

const authState = vi.hoisted(() => ({ current: null as import("@/lib/auth").Session | null }));

vi.mock("@/lib/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentSession: async () => authState.current,
    // Delegate to the REAL centralized policy — only the session source is mocked.
    canAccessOfficeFinance: (session: import("@/lib/auth").Session) => actual.canAccessOfficeFinance(session),
  };
});

import type { Session } from "@/lib/auth";
import {
  convertSpendToFixedExpense,
  createCapitalContribution,
  createCapitalSpend,
  getCapitalLedger,
  getCapitalSummary,
} from "@/lib/capital";
import { prisma, prismaRaw } from "@/lib/prisma";
import { PATCH as patchContribution, DELETE as deleteContribution } from "@/app/api/office/capital-contributions/[id]/route";
import { PATCH as patchSpend, DELETE as deleteSpend } from "@/app/api/office/capital-spends/[id]/route";
import { POST as createSpendRoute } from "@/app/api/office/capital-spends/route";
import { DELETE as deleteFixedExpense } from "@/app/api/office/fixed-expenses/[id]/route";

type RouteCtx = { params: Promise<{ id: string }> };

const req = (url: string, method: string, body?: unknown): NextRequest =>
  new Request(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as NextRequest;

const sessionFor = (over: Partial<Session> & Pick<Session, "userId" | "role">): Session => ({
  name: "Auth Test",
  businessId: "all",
  canAccessNexup: false,
  canAccessRebound: false,
  canAccessAbomazen: false,
  canAccessOfficeFinanceFull: false,
  ...over,
});

/* Throwaway database lifecycle — identical to tests/capital.test.ts.
   Files run sequentially (fileParallelism: false), each owning the DB. */
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
  execSync(`npx prisma db push --schema=prisma/schema.prisma --url "${DB_URL}"`, { env: ENV, stdio: "pipe", cwd: path.resolve(__dirname, "..") });
}, 240_000);

afterAll(async () => {
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  try { psql(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`); } catch { /* ignore */ }
});

beforeEach(() => {
  authState.current = null; // default: unauthenticated
});

describe("Capital mutation endpoints — centralized Office Finance authorization", () => {
  let superId: string;
  let adminFlagId: string; // ADMIN with canAccessOfficeFinanceFull — the Saeed-like profile
  let adminNoFlagId: string; // ADMIN without the flag — must stay 403
  let partnerId: string;
  let contribAId: string; // 20,000 CASH
  let contribBId: string; // 3,000 CASH — the soft-delete target
  let spendS1Id: string; // 10,000
  let spendS2Id: string; // 700 — converted to recurring
  let fixedExpenseId: string;

  beforeAll(async () => {
    const [superUser, adminFlag, adminNoFlag, partner] = await Promise.all([
      prisma.user.create({ data: { email: "auth-super@example.local", name: "Super", role: "SUPER_ADMIN", passwordHash: "x" } }),
      prisma.user.create({
        data: {
          email: "auth-admin-flag@example.local", name: "Finance Admin",
          role: "ADMIN", passwordHash: "x", canAccessOfficeFinanceFull: true,
        },
      }),
      prisma.user.create({ data: { email: "auth-admin-noflag@example.local", name: "Plain Admin", role: "ADMIN", passwordHash: "x" } }),
      prisma.partner.create({ data: { name: "مموّل-TEST-AUTH" } }),
    ]);
    superId = superUser.id;
    adminFlagId = adminFlag.id;
    adminNoFlagId = adminNoFlag.id;
    partnerId = partner.id;

    // Seeded ledger: IN 20,000 → spend 10,000 → IN 3,000 → spend 700 (recurring).
    const contribA = await createCapitalContribution({
      partnerId, amount: 20000, type: "CASH", date: new Date("2026-09-01"),
      description: "رأس مال للمكتب", userId: superId,
    });
    contribAId = contribA.id;

    const s1 = await createCapitalSpend({
      amount: 10000, date: new Date("2026-09-05"), category: "تجهيزات",
      description: "تجهيزات تأسيس المكتب", userId: superId,
    });
    spendS1Id = s1.id;

    const contribB = await createCapitalContribution({
      partnerId, amount: 3000, type: "CASH", date: new Date("2026-09-06"),
      description: "مساهمة تُحذف لاحقًا", userId: superId,
    });
    contribBId = contribB.id;

    const s2 = await createCapitalSpend({
      amount: 700, date: new Date("2026-09-08"), category: "اشتراكات",
      description: "اشتراك إدارة", userId: superId,
    });
    spendS2Id = s2.id;
    const { def } = await convertSpendToFixedExpense({
      spendId: s2.id, recurringAmount: 700, name: "اشتراك إدارة", userId: superId,
    });
    fixedExpenseId = def.id;

    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(23000);
    expect(s.totalSpent).toBe(10700);
    expect(s.available).toBe(12300);
  }, 60_000);

  it("1. unauthenticated requests are rejected on every capital mutation endpoint (403 in-process; middleware 401s at the edge)", async () => {
    // In the deployed app, middleware.ts returns 401 for sessionless /api/*
    // requests before routes run. Invoked directly (as here), the routes
    // themselves must still refuse a null session via the centralized guard.
    const results = await Promise.all([
      patchContribution(req(`http://x/c`, "PATCH", { description: "x" }), { params: Promise.resolve({ id: contribAId }) }),
      deleteContribution(req(`http://x/c`, "DELETE"), { params: Promise.resolve({ id: contribAId }) }),
      patchSpend(req(`http://x/s`, "PATCH", { amount: 1 }), { params: Promise.resolve({ id: spendS1Id }) }),
      deleteSpend(req(`http://x/s`, "DELETE"), { params: Promise.resolve({ id: spendS1Id }) }),
      createSpendRoute(req(`http://x/s`, "POST", { amount: 1, date: "2026-09-10", category: "c", description: "d" })),
      deleteFixedExpense(req(`http://x/f`, "DELETE"), { params: Promise.resolve({ id: fixedExpenseId }) }),
    ]);
    for (const res of results) expect(res.status).toBe(403);
    // Nothing was mutated.
    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(10700);
  });

  it("2. ADMIN WITHOUT the Office Finance flag gets 403 everywhere; rows untouched", async () => {
    authState.current = sessionFor({ userId: adminNoFlagId, role: "ADMIN" });

    const results = await Promise.all([
      patchContribution(req(`http://x/c`, "PATCH", { amount: 1 }), { params: Promise.resolve({ id: contribAId }) }),
      deleteContribution(req(`http://x/c`, "DELETE"), { params: Promise.resolve({ id: contribAId }) }),
      patchSpend(req(`http://x/s`, "PATCH", { amount: 1 }), { params: Promise.resolve({ id: spendS1Id }) }),
      deleteSpend(req(`http://x/s`, "DELETE"), { params: Promise.resolve({ id: spendS1Id }) }),
      createSpendRoute(req(`http://x/s`, "POST", { amount: 1, date: "2026-09-10", category: "c", description: "d" })),
      deleteFixedExpense(req(`http://x/f`, "DELETE"), { params: Promise.resolve({ id: fixedExpenseId }) }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("Forbidden");
    }

    const spend = await prisma.capitalSpend.findUnique({ where: { id: spendS1Id } });
    expect(spend?.amount).toBe(10000); // rejected mutation changed nothing
    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(10700);
  });

  it("3. ADMIN WITH canAccessOfficeFinanceFull can edit a CapitalContribution in place (the reported regression)", async () => {
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });

    const res = await patchContribution(
      req(`http://x/c`, "PATCH", { description: "وصف معدّل", reference: "REF-9", date: "2026-09-02" }),
      { params: Promise.resolve({ id: contribAId }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { id: string; description: string; reference: string };
    expect(updated.id).toBe(contribAId); // same row — never a new record
    expect(updated.description).toBe("وصف معدّل");

    const s = await getCapitalSummary();
    expect(s.contributionCount).toBe(2); // no duplicate created
    const { entries } = await getCapitalLedger();
    expect(entries.find(e => e.type === "CAPITAL_IN" && e.id === contribAId)?.reference).toBe("REF-9");
  });

  it("4. ADMIN WITH the flag can edit a CapitalSpend (PATCH) with balance recalculation", async () => {
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });

    const res = await patchSpend(req(`http://x/s`, "PATCH", { amount: 8000, notes: "معدّل" }), { params: Promise.resolve({ id: spendS1Id }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { amount: number }).amount).toBe(8000);

    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(8700);
    expect(s.available).toBe(14300); // derived totals recalculated
  });

  it("5. integrity guards still apply to authorized users (409/400, never bypassed)", async () => {
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });

    // Spend increase beyond available: delta 14,301 > available 14,300.
    const overspend = await patchSpend(req(`http://x/s`, "PATCH", { amount: 22301 }), { params: Promise.resolve({ id: spendS1Id }) });
    expect(overspend.status).toBe(409);
    expect(((await overspend.json()) as { error: string }).error).toBe("INSUFFICIENT_CAPITAL");

    // Reducing the contribution below what was already spent.
    const reduce = await patchContribution(req(`http://x/c`, "PATCH", { amount: 5699 }), { params: Promise.resolve({ id: contribAId }) });
    expect(reduce.status).toBe(409);
    expect(((await reduce.json()) as { error: string }).error).toBe("INSUFFICIENT_CAPITAL");

    // Invalid amount still rejected with 400.
    const invalid = await patchContribution(req(`http://x/c`, "PATCH", { amount: 0 }), { params: Promise.resolve({ id: contribAId }) });
    expect(invalid.status).toBe(400);

    // Deleting the big contribution would go negative → 409 with Arabic message.
    const del = await deleteContribution(req(`http://x/c`, "DELETE"), { params: Promise.resolve({ id: contribAId }) });
    expect(del.status).toBe(409);
    const err = (await del.json()) as { error: string; message: string };
    expect(err.error).toBe("INSUFFICIENT_CAPITAL");
    expect(err.message).toContain("لا يمكن حذف هذه المساهمة");

    // Nothing changed by any rejected request.
    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(23000);
    expect(s.totalSpent).toBe(8700);
  });

  it("6. SUPER_ADMIN keeps full access (regression guard on the policy itself)", async () => {
    authState.current = sessionFor({ userId: superId, role: "SUPER_ADMIN" });

    const res = await patchSpend(req(`http://x/s`, "PATCH", { amount: 10000 }), { params: Promise.resolve({ id: spendS1Id }) });
    expect(res.status).toBe(200);
    const s = await getCapitalSummary();
    expect(s.available).toBe(12300); // back to the seeded baseline
  });

  it("7. ADMIN WITH the flag can soft-delete a CapitalSpend — recurring link surfaced first, then explicit force (soft only)", async () => {
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });

    // spendS2 is linked to a recurring FixedExpense: the first attempt must
    // refuse with 409 RECURRING_LINKED instead of silently orphaning it.
    const first = await deleteSpend(req(`http://x/s`, "DELETE"), { params: Promise.resolve({ id: spendS2Id }) });
    expect(first.status).toBe(409);
    const err = (await first.json()) as { error: string; message: string };
    expect(err.error).toBe("RECURRING_LINKED");
    expect(err.message).toContain("اشتراك إدارة");

    // Explicit second confirmation (?force=1) → soft delete proceeds.
    const res = await deleteSpend(req(`http://x/s?force=1`, "DELETE"), { params: Promise.resolve({ id: spendS2Id }) });
    expect(res.status).toBe(200);

    const raw = await prismaRaw.capitalSpend.findUnique({ where: { id: spendS2Id } });
    expect(raw?.deletedAt).toBeTruthy(); // SOFT delete — row survives
    const s = await getCapitalSummary();
    expect(s.totalSpent).toBe(10000); // 700 returned to available
    expect(s.available).toBe(13000);
    const { entries } = await getCapitalLedger();
    expect(entries.find(e => e.id === spendS2Id)).toBeUndefined();
  });

  it("8. ADMIN WITH the flag can soft-delete a CapitalContribution when the balance stays valid", async () => {
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });

    const res = await deleteContribution(req(`http://x/c`, "DELETE"), { params: Promise.resolve({ id: contribBId }) });
    expect(res.status).toBe(200);

    const raw = await prismaRaw.capitalContribution.findUnique({ where: { id: contribBId } });
    expect(raw?.deletedAt).toBeTruthy(); // SOFT delete — recoverable, never hard
    const s = await getCapitalSummary();
    expect(s.totalReceived).toBe(20000);
    expect(s.available).toBe(10000);
  });

  it("9. fixed-expenses [id] DELETE follows the same policy (deactivates, never destroys history)", async () => {
    // Unauthenticated → refused (middleware 401s at the edge; in-process 403).
    const anon = await deleteFixedExpense(req(`http://x/f`, "DELETE"), { params: Promise.resolve({ id: fixedExpenseId }) });
    expect(anon.status).toBe(403);

    // Ineligible ADMIN → 403.
    authState.current = sessionFor({ userId: adminNoFlagId, role: "ADMIN" });
    const forbidden = await deleteFixedExpense(req(`http://x/f`, "DELETE"), { params: Promise.resolve({ id: fixedExpenseId }) });
    expect(forbidden.status).toBe(403);

    // Authorized finance admin → 200 and the definition is deactivated (not deleted).
    authState.current = sessionFor({ userId: adminFlagId, role: "ADMIN", canAccessOfficeFinanceFull: true });
    const ok = await deleteFixedExpense(req(`http://x/f`, "DELETE"), { params: Promise.resolve({ id: fixedExpenseId }) });
    expect(ok.status).toBe(200);
    const def = await prismaRaw.fixedExpense.findUnique({ where: { id: fixedExpenseId } });
    expect(def?.active).toBe(false);
  });
});
