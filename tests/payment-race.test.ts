import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { recordClientPaymentWithRetry, PaymentValidationError } from "../src/lib/payments/recordClientPayment";
import { prepareCreateClientPayment, confirmCreateClientPayment } from "../src/lib/mcp/redActions";
import {
  admin,
  TEST,
  setupDatabase,
  teardownDatabase,
  operatorPrincipal,
} from "./mcp-pending.setup";

/* ═══════════════════════════════════════════════════════════════
   Permanent race regression — shared payment primitive.

   A  web reads first  → MCP commits first → web CAS fails → retry →
      BOTH payments land exactly once (30 + 40 on a 100 project).
   B  MCP reads first  → web commits first → MCP fails closed
      (pending FAILED, zero partial rows), web payment intact.
   C  web vs web       → retry makes concurrent valid payments land;
      the over-limit pair lets only the financially valid subset win.
   D  MCP vs MCP       → single consumer + CAS (replay proof).

   Determinism: a test-session row lock (SELECT … FOR UPDATE) parks
   both writers' CAS updates in Postgres's FIFO lock queue; we wait
   until BOTH are waiting (pg_locks), then release — the queue order
   decides who re-evaluates first. No sleeps-based hoping.

   Financial invariants are asserted after every scenario:
     deposit == SUM(live ClientPayment.amount)
     remaining == max(0, totalPrice − deposit)
     Pool IN total == ClientPayment total (for these test payments)
   ═══════════════════════════════════════════════════════════════ */

beforeAll(setupDatabase, 240_000);
afterAll(teardownDatabase, 60_000);

const SEED = { totalPrice: 100 };
let WEB_USER_ID = "";

beforeAll(async () => {
  const user = await admin.user.create({
    data: { name: "Web Clerk", email: "race-clerk@test.local", passwordHash: "test-hash", role: "ADMIN" },
  });
  WEB_USER_ID = user.id;
});

beforeEach(async () => {
  if (!TEST.projectId) return;
  await admin.activityLog.deleteMany({});
  await admin.mcpAuditLog.deleteMany({});
  await admin.mcpPendingAction.deleteMany({});
  await admin.clientPayment.deleteMany({});
  await admin.poolTransaction.deleteMany({});
  await admin.projectRecord.deleteMany({ where: { id: { not: TEST.projectId } } });
  await admin.projectRecord.update({
    where: { id: TEST.projectId },
    data: { totalPrice: SEED.totalPrice, deposit: 0, remaining: SEED.totalPrice, paymentStatus: "UNPAID" },
  });
  await admin.client.update({ where: { id: TEST.clientId }, data: { tier: "NORMAL" } });
});

/* ─── helpers ───────────────────────────────────────────────── */

type LockSession = { pool: Pool; release: () => Promise<void> };

/** Hold the project row lock so other writers' CAS updates queue up. */
async function holdProjectRowLock(): Promise<LockSession> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 1 });
  const c = await pool.connect();
  await c.query("BEGIN");
  await c.query(`SELECT id FROM "ProjectRecord" WHERE id = $1 FOR UPDATE`, [TEST.projectId]);
  return {
    pool,
    release: async () => {
      await c.query("COMMIT");
      c.release();
      await pool.end();
    },
  };
}

/** Wait until `n` CAS writers are parked on the lock queue (FIFO set). */
async function waitForWaitingLocks(n: number, timeoutMs = 15_000): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 1 });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const r = await pool.query(
        `SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`,
      );
      if (r.rows[0].waiting >= n) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error(`only ${0} of ${n} writers reached the lock queue in time`);
  } finally {
    await pool.end();
  }
}

async function webPay(amount: number, projectId = TEST.projectId) {
  return recordClientPaymentWithRetry({
    projectRecordId: projectId,
    amount,
    createdByUserId: WEB_USER_ID,
    activityLogUserId: WEB_USER_ID,
  });
}

async function mcpPrepareConfirm(amount: number, projectId = TEST.projectId) {
  const principal = operatorPrincipal();
  const prepared = await prepareCreateClientPayment(
    { business: "nexup", projectId, amount },
    principal,
  );
  return confirmCreateClientPayment(
    { confirmationId: prepared.confirmationId, token: prepared.token },
    principal,
  );
}

async function paymentsOf(projectId = TEST.projectId) {
  const rows = await admin.clientPayment.findMany({
    where: { projectRecordId: projectId },
    select: { amount: true },
  });
  return rows.map((r) => Number(r.amount)).sort((a, b) => a - b);
}

/** The financial invariants that matter more than HTTP codes. */
async function assertInvariants(projectId = TEST.projectId) {
  const p = await admin.projectRecord.findUniqueOrThrow({ where: { id: projectId } });
  const paidAgg = await admin.clientPayment.aggregate({
    where: { projectRecordId: projectId, deletedAt: null },
    _sum: { amount: true },
  });
  const poolAgg = await admin.poolTransaction.aggregate({
    where: { projectRecordId: projectId, type: "IN", deletedAt: null },
    _sum: { amountSAR: true },
  });
  const paid = Number(paidAgg._sum.amount ?? 0);
  const poolIn = Number(poolAgg._sum.amountSAR ?? 0);
  expect(Number(p.deposit)).toBe(paid); // deposit == recorded payments
  expect(Number(p.remaining)).toBe(Math.max(0, Number(p.totalPrice) - Number(p.deposit)));
  expect(poolIn).toBe(paid); // pool IN mirrors recorded payments
  return { deposit: Number(p.deposit), remaining: Number(p.remaining), total: Number(p.totalPrice), paid, poolIn };
}

/* ─── A. web reads first, MCP commits first ─────────────────── */

describe("race A: web reads first, MCP commits first", () => {
  it("web CAS fails → retry → BOTH payments land exactly once (30 + 40 of 100)", async () => {
    const lock = await holdProjectRowLock();
    let mcpOutcome: Awaited<ReturnType<typeof mcpPrepareConfirm>> | null = null;

    try {
      // MCP confirm starts first → its CAS queues FIRST (FIFO wins).
      const mcpPromise = mcpPrepareConfirm(40).then((o) => {
        mcpOutcome = o;
        return o;
      });
      await waitForWaitingLocks(1); // MCP CAS parked on the lock

      // Web starts second → reads 0/100 (unchanged), CAS queues second.
      const webPromise = webPay(30);
      await waitForWaitingLocks(2); // both writers parked, order fixed

      await lock.release(); // MCP re-evaluates first → commits 40/60; web CAS fails → retries fresh

      const mcp = await mcpPromise;
      const web = await webPromise;

      expect(Number(mcp.result.depositAfter)).toBe(40); // MCP committed exactly its share
      expect(web.depositAfter).toBe(70); // web retried on top of MCP's commit

      expect(await paymentsOf()).toEqual([30, 40]); // BOTH payments, exactly once
      const inv = await assertInvariants();
      expect(inv).toMatchObject({ deposit: 70, remaining: 30, paid: 70, poolIn: 70 });
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
});

/* ─── B. MCP reads first, web commits first ─────────────────── */

describe("race B: MCP reads first, web commits first", () => {
  it("MCP fails closed (pending FAILED, no partial rows); web payment intact", async () => {
    const lock = await holdProjectRowLock();
    let mcpError: unknown = null;

    try {
      // Web starts first → its CAS queues FIRST and wins on release.
      const webPromise = webPay(30);
      await waitForWaitingLocks(1);

      // MCP confirm starts second → fingerprint passes (balance still
      // 0/100 in its snapshot view), CAS queues second, re-evaluates
      // against web's committed 30/70 → conflict → fail closed.
      const mcpPromise = mcpPrepareConfirm(40).catch((e: unknown) => {
        mcpError = e;
        return null;
      });
      await waitForWaitingLocks(2);

      await lock.release();

      const web = await webPromise;
      expect(web.depositAfter).toBe(30);

      await mcpPromise;
      expect(mcpError).toMatchObject({ name: "McpActionError", code: "conflict" });

      // Web payment intact and the ONLY one.
      expect(await paymentsOf()).toEqual([30]);

      // MCP left zero partial financial rows and no execution audit.
      expect(await admin.poolTransaction.count({ where: { projectRecordId: TEST.projectId } })).toBe(1);
      expect(await admin.mcpAuditLog.count({ where: { tool: "create_client_payment", action: "CREATE" } })).toBe(0);
      // Pending action FAILED per the lifecycle — not silently consumed.
      const pendings = await admin.mcpPendingAction.findMany();
      expect(pendings).toHaveLength(1);
      expect(pendings[0]!.status).toBe("FAILED");

      await assertInvariants();
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
});

/* ─── C. web vs web ─────────────────────────────────────────── */

describe("race C: web vs web", () => {
  it("concurrent valid payments (30+40 of 100) both land via retry — no overwrite", async () => {
    const [a, b] = await Promise.all([webPay(30), webPay(40)]);

    expect(await paymentsOf().then((xs) => xs.reduce((s, x) => s + x, 0))).toBe(70);
    const inv = await assertInvariants();
    expect(inv.deposit).toBe(70);
    expect(inv.remaining).toBe(30);
    expect([a.paymentId]).not.toEqual([b.paymentId]);
  });

  it("over-limit pair (70+70 of 100): exactly the valid subset wins, deposit never exceeds totalPrice", async () => {
    const results = await Promise.allSettled([webPay(70), webPay(70)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one can be financially valid; the loser hits overpayment
    // on its retry (remaining 30 < 70) — a terminal validation, never a
    // silent overwrite.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "PaymentValidationError",
      code: "PAYMENT_OVERPAYMENT",
    });

    const inv = await assertInvariants();
    expect(inv.deposit).toBe(70);
    expect(inv.deposit).toBeLessThanOrEqual(inv.total);
  });
});

/* ─── D. MCP vs MCP / replay ────────────────────────────────── */

describe("race D: MCP vs MCP and replay", () => {
  it("three concurrent confirms → exactly one winner, one payment, one pool IN", async () => {
    const principal = operatorPrincipal();
    const prepared = await prepareCreateClientPayment(
      { business: "nexup", projectId: TEST.projectId, amount: 30 },
      principal,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        confirmCreateClientPayment(
          { confirmationId: prepared.confirmationId, token: prepared.token },
          principal,
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await paymentsOf()).toEqual([30]);
    await assertInvariants();
  });

  it("replay after success is rejected and mutates nothing", async () => {
    const principal = operatorPrincipal();
    const prepared = await prepareCreateClientPayment(
      { business: "nexup", projectId: TEST.projectId, amount: 25 },
      principal,
    );
    await confirmCreateClientPayment(
      { confirmationId: prepared.confirmationId, token: prepared.token },
      principal,
    );
    await expect(
      confirmCreateClientPayment(
        { confirmationId: prepared.confirmationId, token: prepared.token },
        operatorPrincipal(),
      ),
    ).rejects.toMatchObject({ name: "McpActionError", code: "confirmation_used" });
    expect(await paymentsOf()).toEqual([25]);
    await assertInvariants();
  });
});

/* ─── audit/activity atomicity on the web path ──────────────── */

describe("web path bookkeeping", () => {
  it("ActivityLog is written in the SAME transaction as the payment", async () => {
    const rec = await webPay(10);
    const logs = await admin.activityLog.findMany({ where: { entityId: rec.paymentId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.userId).toBe(WEB_USER_ID);
    expect(logs[0]!.entityType).toBe("ClientPayment");
    // MCP never writes ActivityLog.
    const mcp = await mcpPrepareConfirm(10);
    expect(await admin.activityLog.count({ where: { entityId: mcp.result.paymentId } })).toBe(0);
  });

  it("conflict retry does not duplicate ActivityLog or pool rows", async () => {
    const lock = await holdProjectRowLock();
    try {
      const mcpPromise = mcpPrepareConfirm(40);
      await waitForWaitingLocks(1);
      const webPromise = webPay(30);
      await waitForWaitingLocks(2);
      await lock.release();
      await mcpPromise;
      const web = await webPromise;

      expect(await admin.activityLog.count({ where: { entityId: web.paymentId } })).toBe(1);
      expect(await admin.poolTransaction.count({ where: { projectRecordId: TEST.projectId } })).toBe(2);
      await assertInvariants();
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
});
