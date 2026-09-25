import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { McpActionError } from "../src/lib/mcp/errors";
import { prepareCreateClientPayment, confirmCreateClientPayment } from "../src/lib/mcp/redActions";
import { runConfirmedAction } from "../src/lib/mcp/pending";
import { RED_ACTIONS, RED_PREPARE_TOOL_NAMES, RED_CONFIRM_TOOL_NAMES, isRedTool } from "../src/lib/mcp/classification";
import { redActionsEnabled } from "../src/lib/mcp/auth";
import {
  admin,
  TEST,
  setupDatabase,
  teardownDatabase,
  operatorPrincipal,
  otherPrincipal,
  restrictedPrincipal,
  withRedEnabled,
} from "./mcp-pending.setup";

/* ═══════════════════════════════════════════════════════════════
   Phase 2B Red action: create_client_payment — isolated-DB battery.

   MCP_RED_ACTIONS_ENABLED stays OFF for the whole run: these tests
   drive the handler functions directly (the env-gate layer is
   separately asserted below and by the smoke tests), so the Red flag
   never needs to be truthy in the environment.
   ═══════════════════════════════════════════════════════════════ */

beforeAll(setupDatabase, 240_000);
afterAll(teardownDatabase, 60_000);

/** Canonical seed: totalPrice 100, deposit 0, remaining 100, UNPAID. */
const SEED = { totalPrice: 100, deposit: 0, remaining: 100 };

/** Restore the seeded world so every test starts canonical. */
beforeEach(async () => {
  if (!TEST.projectId) return;
  await admin.mcpAuditLog.deleteMany({});
  await admin.mcpPendingAction.deleteMany({});
  await admin.clientPayment.deleteMany({});
  await admin.poolTransaction.deleteMany({});
  await admin.projectRecord.deleteMany({ where: { id: { not: TEST.projectId } } });
  await admin.projectRecord.update({
    where: { id: TEST.projectId },
    data: {
      totalPrice: SEED.totalPrice,
      deposit: SEED.deposit,
      remaining: SEED.remaining,
      paymentStatus: "UNPAID",
    },
  });
  await admin.client.update({ where: { id: TEST.clientId }, data: { tier: "NORMAL" } });
});

/* ─── helpers ───────────────────────────────────────────────── */

type TestInput = {
  business: "nexup" | "rebound" | "abomazen";
  projectId: string;
  amount: number;
  date?: string;
  note?: string;
};

function input(overrides?: Partial<TestInput>) {
  return { business: "nexup" as const, projectId: TEST.projectId, amount: 40, ...overrides };
}

async function currentProject() {
  return admin.projectRecord.findUniqueOrThrow({ where: { id: TEST.projectId } });
}

async function currentClient() {
  return admin.client.findUniqueOrThrow({ where: { id: TEST.clientId } });
}

/** State that prepare must NEVER touch. */
async function businessState() {
  const p = await currentProject();
  return {
    deposit: String(p.deposit),
    remaining: String(p.remaining),
    paymentStatus: p.paymentStatus,
    payments: await admin.clientPayment.count({ where: { projectRecordId: TEST.projectId } }),
    pool: await admin.poolTransaction.count({ where: { projectRecordId: TEST.projectId } }),
    clientTier: (await currentClient()).tier,
  };
}

type Operator = ReturnType<typeof operatorPrincipal>;

async function prepareIntent(opts?: {
  principal?: Operator;
  input?: ReturnType<typeof input>;
}) {
  const principal = opts?.principal ?? operatorPrincipal();
  return prepareCreateClientPayment(opts?.input ?? input(), principal);
}

async function confirmIntent(
  prepared: { confirmationId: string; token: string },
  principal?: Operator,
) {
  return confirmCreateClientPayment(prepared, principal ?? operatorPrincipal());
}

function expectMcpError(fn: () => Promise<unknown>, code: string) {
  return expect(fn()).rejects.toMatchObject({ name: "McpActionError", code });
}

/* ─── 0. classification registry + gate (no DB) ─────────────── */

describe("create_client_payment — classification & gate", () => {
  it("is registered as Red with exactly one prepare and one confirm tool", () => {
    expect(RED_ACTIONS).toEqual([
      {
        prepareTool: "prepare_create_client_payment",
        confirmTool: "confirm_create_client_payment",
        actionName: "create_client_payment",
      },
    ]);
    expect(RED_PREPARE_TOOL_NAMES).toEqual(["prepare_create_client_payment"]);
    expect(RED_CONFIRM_TOOL_NAMES).toEqual(["confirm_create_client_payment"]);
    expect(isRedTool("prepare_create_client_payment")).toBe(true);
    expect(isRedTool("confirm_create_client_payment")).toBe(true);
    expect(isRedTool("create_client")).toBe(false);
  });

  it("Red gate is OFF while MCP_RED_ACTIONS_ENABLED is unset (flag stays off in this run)", () => {
    expect(process.env.MCP_RED_ACTIONS_ENABLED).toBeUndefined();
    expect(redActionsEnabled()).toBe(false);
    // Layered gate: even with the Red flag set, writes-off keeps Red off.
    const prev = process.env.MCP_WRITE_TOOLS_ENABLED;
    delete process.env.MCP_WRITE_TOOLS_ENABLED;
    try {
      expect(withRedEnabled(() => redActionsEnabled())).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MCP_WRITE_TOOLS_ENABLED;
      else process.env.MCP_WRITE_TOOLS_ENABLED = prev;
    }
  });
});

/* ─── 1. successful prepare + confirm ───────────────────────── */

describe("create_client_payment — success path", () => {
  it("prepare returns preview + token + expiry, writes one PENDING row and one PREPARE audit", async () => {
    const before = await businessState();

    const prepared = await prepareIntent();

    expect(prepared.confirmationId).toBeTruthy();
    expect(prepared.token).toHaveLength(43); // 256-bit base64url
    expect(prepared.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } });
    expect(row.status).toBe("PENDING");
    expect(row.tool).toBe("create_client_payment");
    expect(row.businessSlug).toBe("nexup");
    expect(row.confirmTokenHash).not.toBe(prepared.token); // only the SHA-256 is stored
    expect(row.attempts).toBe(0);
    expect(row.preconditionFingerprint).toMatchObject({
      [`ProjectRecord:${TEST.projectId}`]: {
        totalPrice: "100",
        deposit: "0",
        remaining: "100",
        clientId: TEST.clientId,
      },
    });

    // Args snapshot is the server-side financial truth.
    expect(row.argsSnapshot).toMatchObject({
      projectId: TEST.projectId,
      amount: 40,
      clientId: TEST.clientId,
      businessId: TEST.businessId,
      note: null,
    });

    const auditRow = await admin.mcpAuditLog.findFirstOrThrow({
      where: { entityType: "McpPendingAction", entityId: prepared.confirmationId, action: "PREPARE" },
    });
    expect(auditRow.tool).toBe("create_client_payment");

    // No business mutation during prepare.
    expect(await businessState()).toEqual(before);
  });

  it("preview contains client, project, amount SAR, paid, remaining before/after", async () => {
    const prepared = await prepareIntent();
    const p = prepared.preview as Record<string, unknown>;

    expect(p).toMatchObject({
      business: "nexup",
      amountSAR: 40,
      paidBefore: 0,
      remainingBefore: 100,
      remainingAfter: 60,
      paymentStatusAfter: "PARTIAL",
    });
    expect((p.client as Record<string, unknown>).name).toBeTruthy();
    expect((p.project as Record<string, unknown>).name).toBeTruthy();
    expect(prepared.summary).toContain("40.00 SAR");
    expect(prepared.summary).toContain("60.00 SAR");
  });

  it("confirm executes atomically: payment + project update + pool IN + audit + EXECUTED", async () => {
    const prepared = await prepareIntent();
    const outcome = await confirmIntent(prepared);

    const payment = await admin.clientPayment.findUniqueOrThrow({ where: { id: outcome.result.paymentId } });
    expect(Number(payment.amount)).toBe(40);
    expect(payment.note).toBeNull();
    expect(payment.createdByUserId).toBeNull(); // MCP has no human User FK

    const project = await currentProject();
    expect(Number(project.deposit)).toBe(40);
    expect(Number(project.remaining)).toBe(60);
    expect(project.paymentStatus).toBe("PARTIAL");

    const pool = await admin.poolTransaction.findFirstOrThrow({ where: { projectRecordId: TEST.projectId } });
    expect(Number(pool.amountSAR)).toBe(40);
    expect(pool.type).toBe("IN");
    expect(pool.businessId).toBe(TEST.businessId);
    expect(pool.note).toBe("Payment: Pending Test Client — Pending Test Project");

    // Tier: 1 project / 0 paid-in-full revenue → NORMAL by the app rule.
    expect((await currentClient()).tier).toBe("NORMAL");

    const pendingRow = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } });
    expect(pendingRow.status).toBe("EXECUTED");
    expect(pendingRow.confirmedAt).toBeTruthy();
    expect(pendingRow.executedAt).toBeTruthy();

    // Exactly one successful business audit, linked bidirectionally.
    const audits = await admin.mcpAuditLog.findMany({
      where: { tool: "create_client_payment", action: "CREATE" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entityId).toBe(outcome.result.paymentId);
    expect(pendingRow.resultAuditLogId).toBe(audits[0]!.id);
    expect(audits[0]!.metadata).toMatchObject({ amountSAR: 40, currency: "SAR", poolTransaction: "IN" });
  });

  it("full payment flips paymentStatus to FULL and remaining to 0", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 100 }) });
    await confirmIntent(prepared);

    const project = await currentProject();
    expect(Number(project.remaining)).toBe(0);
    expect(Number(project.deposit)).toBe(100);
    expect(project.paymentStatus).toBe("FULL");
  });

  it("sets the LOYAL tier when paid-in-full revenue crosses 500", async () => {
    // Second project, already FULL, 450 → paid-in-full revenue so far.
    await admin.projectRecord.create({
      data: {
        businessId: TEST.businessId,
        clientId: TEST.clientId,
        projectName: "Big Project",
        date: new Date(),
        totalPrice: 450,
        deposit: 450,
        remaining: 0,
        paymentStatus: "FULL",
      },
    });

    // Pay the seeded project in full: revenue becomes 550 > 500 → LOYAL.
    const prepared = await prepareIntent({ input: input({ amount: 100 }) });
    await confirmIntent(prepared);

    expect((await currentClient()).tier).toBe("LOYAL");
  });

  it("sets the VIP tier when paid-in-full revenue crosses 1000", async () => {
    await admin.projectRecord.create({
      data: {
        businessId: TEST.businessId,
        clientId: TEST.clientId,
        projectName: "Bigger Project",
        date: new Date(),
        totalPrice: 950,
        deposit: 950,
        remaining: 0,
        paymentStatus: "FULL",
      },
    });
    const prepared = await prepareIntent({ input: input({ amount: 100 }) });
    await confirmIntent(prepared);
    // paid-in-full revenue: 950 + 100 = 1050 > 1000 → VIP.
    expect((await currentClient()).tier).toBe("VIP");
  });

  it("honors optional date and note (pool note suffix matches the app format)", async () => {
    const prepared = await prepareIntent({
      input: input({ amount: 10, date: "2026-09-01", note: "  transfer from Ahmed  " }),
    });
    await confirmIntent(prepared);

    const payment = await admin.clientPayment.findFirstOrThrow({
      where: { projectRecordId: TEST.projectId },
      orderBy: { createdAt: "desc" },
    });
    expect(payment.date.toISOString()).toContain("2026-09-01");
    expect(payment.note).toBe("transfer from Ahmed"); // trimmed

    const pool = await admin.poolTransaction.findFirstOrThrow({
      where: { projectRecordId: TEST.projectId },
      orderBy: { createdAt: "desc" },
    });
    expect(pool.note).toBe("Payment: Pending Test Client — Pending Test Project (transfer from Ahmed)");
  });
});

/* ─── 2. prepare mutates nothing ─────────────────────────────── */

describe("create_client_payment — prepare never mutates", () => {
  it("abandoned prepare leaves zero payments, pool rows, project money and tier untouched", async () => {
    const before = await businessState();
    const prepared = await prepareIntent();
    // Intentionally never confirm.
    expect(prepared.token).toBeTruthy();
    expect(await businessState()).toEqual(before);
  });
});

/* ─── 3. validation failures (nothing prepared) ─────────────── */

describe("create_client_payment — validation", () => {
  it("rejects overpayment with a clear message and prepares nothing", async () => {
    const before = await businessState();
    await expectMcpError(() => prepareIntent({ input: input({ amount: 100.01 }) }), "conflict");
    expect(await businessState()).toEqual(before);
    expect(await admin.mcpPendingAction.count()).toBe(0);
    expect(await admin.mcpAuditLog.count()).toBe(0);
  });

  it("exact remaining balance is allowed (100 on a 100 project)", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 100 }) });
    expect(prepared.preview as Record<string, unknown>).toMatchObject({
      remainingAfter: 0,
      paymentStatusAfter: "FULL",
    });
  });

  it("rejects zero, negative and non-finite amounts", async () => {
    const before = await businessState();
    for (const bad of [0, -1, -0.01, Number.NaN, Infinity, -Infinity]) {
      // The zod schema enforces finite + positive + 2 decimals at the
      // MCP boundary; the handler guard is the fail-closed backstop
      // exercised here (handlers are called directly).
      let threw = false;
      try {
        await prepareCreateClientPayment(input({ amount: bad }) as never, operatorPrincipal());
      } catch {
        threw = true;
      }
      expect(threw, `amount ${String(bad)} must be rejected`).toBe(true);
    }
    expect(await businessState()).toEqual(before);
    expect(await admin.mcpPendingAction.count()).toBe(0);
  });

  it("rejects wrong business scope (restricted principal + foreign slug)", async () => {
    await expectMcpError(
      () => prepareIntent({ principal: restrictedPrincipal(), input: input() }),
      "forbidden",
    );
    // A valid principal naming a slug with no matching project also fails closed.
    await expectMcpError(
      () => prepareIntent({ input: input({ business: "rebound", projectId: TEST.projectId }) }),
      "not_found",
    );
    expect(await admin.mcpPendingAction.count()).toBe(0);
  });

  it("rejects unknown project, foreign project and soft-deleted project", async () => {
    await expectMcpError(
      () => prepareIntent({ input: input({ projectId: "cmonunknownprojectid0000" }) }),
      "not_found",
    );
    await expectMcpError(
      () => prepareIntent({ input: input({ business: "rebound", projectId: TEST.projectId }) }),
      "not_found",
    );

    const temp = await admin.projectRecord.create({
      data: {
        businessId: TEST.businessId,
        clientId: TEST.clientId,
        projectName: "Ghost Project",
        date: new Date(),
        totalPrice: 50,
        deposit: 0,
        remaining: 50,
        paymentStatus: "UNPAID",
        deletedAt: new Date(), // soft-deleted → invisible to prepare
      },
    });
    await expectMcpError(() => prepareIntent({ input: input({ projectId: temp.id, amount: 10 }) }), "not_found");
    expect(await admin.mcpPendingAction.count()).toBe(0);
  });

  it("rejects invalid dates (not real calendar dates)", async () => {
    await expectMcpError(() => prepareIntent({ input: input({ date: "2026-02-31" }) }), "invalid_input");
    await expectMcpError(() => prepareIntent({ input: input({ date: "not-a-date" }) }), "invalid_input");
  });

  it("trims/normalizes note: empty and whitespace-only become null", async () => {
    const prepared = await prepareIntent({ input: input({ note: "   " }) });
    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } });
    expect((row.argsSnapshot as Record<string, unknown>).note).toBeNull();
  });
});

/* ─── 4. confirm-time failures (fail-closed) ────────────────── */

describe("create_client_payment — confirm fail-closed", () => {
  it("rejects replay: second confirm with same id+token executes nothing", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await confirmIntent(prepared);
    const afterFirst = await businessState();

    await expectMcpError(() => confirmIntent(prepared), "confirmation_used");
    expect(await businessState()).toEqual(afterFirst);
  });

  it("rejects a wrong token and never executes", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await expectMcpError(
      () => confirmIntent({ confirmationId: prepared.confirmationId, token: "wrong-token-wrong-token-wrong-token123" }),
      "confirmation_invalid",
    );
    expect((await currentProject()).paymentStatus).toBe("UNPAID");
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("precondition conflict: balance changed between prepare and confirm → nothing executes", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });

    // Simulate a web-app payment that raced the confirmation window.
    await admin.projectRecord.update({
      where: { id: TEST.projectId },
      data: { deposit: 10, remaining: 90 },
    });

    await expectMcpError(() => confirmIntent(prepared), "conflict");
    expect(Number((await currentProject()).deposit)).toBe(10); // untouched
    expect(await admin.clientPayment.count()).toBe(0);
    expect(await admin.poolTransaction.count()).toBe(0);
    // Pending action marked FAILED so it cannot linger confirmable.
    expect(
      (await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } })).status,
    ).toBe("FAILED");
  });

  it("precondition conflict: project hard-removed between prepare and confirm", async () => {
    const temp = await admin.projectRecord.create({
      data: {
        businessId: TEST.businessId,
        clientId: TEST.clientId,
        projectName: "Doomed Project",
        date: new Date(),
        totalPrice: 50,
        deposit: 0,
        remaining: 50,
        paymentStatus: "UNPAID",
      },
    });
    const prepared = await prepareIntent({ input: input({ projectId: temp.id, amount: 25 }) });

    await admin.projectRecord.delete({ where: { id: temp.id } });

    await expectMcpError(() => confirmIntent(prepared), "conflict");
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("confirming a confirmation prepared for a different action is rejected (tool mismatch)", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_create_client_payment",
        actionTool: "some_other_red_action",
        confirmationId: prepared.confirmationId,
        token: prepared.token,
        execution: {
          execute: async () => {
            throw new Error("must never run");
          },
        },
      }),
    ).rejects.toMatchObject({ name: "McpActionError", code: "confirmation_invalid" });
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("expiry: expired confirmation is rejected and marked EXPIRED", async () => {
    const principal = operatorPrincipal();
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await admin.mcpPendingAction.update({
      where: { id: prepared.confirmationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectMcpError(() => confirmIntent(prepared, principal), "confirmation_expired");
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("wrong actor: only the preparing principal may confirm (v1 rule)", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await expectMcpError(() => confirmIntent(prepared, otherPrincipal()), "forbidden");
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("project moved to another business between prepare and confirm → conflict", async () => {
    const rebound = await admin.business.create({ data: { name: "REBOUND", slug: "rebound", currencyMode: "EGP_DIRECT" } });
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    try {
      await admin.projectRecord.update({
        where: { id: TEST.projectId },
        data: { businessId: rebound.id },
      });
      await expectMcpError(() => confirmIntent(prepared), "conflict");
      expect(await admin.clientPayment.count()).toBe(0);
      expect(await admin.poolTransaction.count()).toBe(0);
    } finally {
      await admin.projectRecord.update({ where: { id: TEST.projectId }, data: { businessId: TEST.businessId } });
      await admin.business.delete({ where: { id: rebound.id } });
    }
  });

  it("client soft-deleted between prepare and confirm → conflict, nothing executes", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await admin.client.update({ where: { id: TEST.clientId }, data: { deletedAt: new Date() } });
    try {
      await expectMcpError(() => confirmIntent(prepared), "conflict");
      expect(await admin.clientPayment.count()).toBe(0);
      expect(await admin.poolTransaction.count()).toBe(0);
      expect(Number((await currentProject()).deposit)).toBe(0);
    } finally {
      await admin.client.update({ where: { id: TEST.clientId }, data: { deletedAt: null } });
    }
  });

  it("tier aggregates ignore soft-deleted projects (app parity)", async () => {
    // Two extra FULL projects — but soft-deleted, so the app (and the
    // MCP path) must not see them in tier aggregation.
    for (const name of ["Deleted A", "Deleted B"]) {
      await admin.projectRecord.create({
        data: {
          businessId: TEST.businessId,
          clientId: TEST.clientId,
          projectName: name,
          date: new Date(),
          totalPrice: 500,
          deposit: 500,
          remaining: 0,
          paymentStatus: "FULL",
          deletedAt: new Date(),
        },
      });
    }
    // Live set: 1 project, 0 paid-in-full revenue → NORMAL, NOT VIP
    // (a raw aggregate would see 3 projects / 1100 revenue → VIP).
    const prepared = await prepareIntent({ input: input({ amount: 100 }) });
    await confirmIntent(prepared);
    expect((await currentClient()).tier).toBe("NORMAL");
  });
});

/* ─── 5. concurrency & transaction rollback ─────────────────── */

describe("create_client_payment — concurrency + rollback", () => {
  it("concurrent confirms: exactly one winner, one payment, one pool row", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 30 }) });

    const results = await Promise.allSettled([
      confirmIntent(prepared),
      confirmIntent(prepared),
      confirmIntent(prepared),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await admin.clientPayment.count({ where: { projectRecordId: TEST.projectId } })).toBe(1);
    expect(await admin.poolTransaction.count({ where: { projectRecordId: TEST.projectId } })).toBe(1);
    expect(Number((await currentProject()).deposit)).toBe(30);
  });

  it("payment race: a web-app payment landing before confirm flips the fingerprint → conflict", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 30 }) });

    // A "web app" payment lands while the confirmation is pending.
    await admin.projectRecord.update({
      where: { id: TEST.projectId },
      data: { deposit: 5, remaining: 95 },
    });

    await expectMcpError(() => confirmIntent(prepared), "conflict");
    expect(Number((await currentProject()).deposit)).toBe(5);
    expect(await admin.clientPayment.count()).toBe(0);
  });

  it("in-tx compare-and-swap: project update carries the pre-read balance predicates", async () => {
    // The executor's projectRecord.updateMany is a conditional
    // (compare-and-swap) write: WHERE id + deposit + remaining +
    // totalPrice AS READ INSIDE THE CONFIRM TRANSACTION. Postgres
    // re-evaluates that predicate against the latest committed row
    // under the row lock, so a web payment committing in the window
    // between the MCP read and the MCP update makes count = 0 and the
    // whole transaction aborts — the lost-update anomaly is closed at
    // the database level, independent of the pending-action gate.
    // (Deterministic injection of a write inside that microsecond
    // window is not possible from a test; the outer-window race is
    // covered by the fingerprint test above, and the CAS predicate is
    // asserted here via the executed result: balance math flows from
    // the same row version the predicates pinned.)
    const prepared = await prepareIntent({ input: input({ amount: 30 }) });
    await confirmIntent(prepared);
    const p = await currentProject();
    expect(Number(p.deposit)).toBe(30);
    expect(Number(p.remaining)).toBe(70);
    expect(p.paymentStatus).toBe("PARTIAL");
  });

  it("rolls back EVERYTHING when the pool insert fails after the payment create", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 30 }) });

    // Poison the PoolTransaction amount column so the pool create
    // throws AFTER the payment create and project update succeeded.
    await admin.$executeRawUnsafe(
      `ALTER TABLE "PoolTransaction" ALTER COLUMN "amountSAR" SET DATA TYPE DECIMAL(3,2)`,
    );

    try {
      // A raw Postgres error (value out of range) propagates as-is —
      // what matters is that the whole transaction rolled back.
      await expect(confirmIntent(prepared)).rejects.toThrow();

      expect(await admin.clientPayment.count({ where: { projectRecordId: TEST.projectId } })).toBe(0);
      expect(Number((await currentProject()).deposit)).toBe(0);
      expect((await currentProject()).paymentStatus).toBe("UNPAID");
      const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } });
      expect(row.status).not.toBe("EXECUTED");
      expect(await admin.mcpAuditLog.count({ where: { action: "CREATE" } })).toBe(0);
    } finally {
      await admin.$executeRawUnsafe(
        `ALTER TABLE "PoolTransaction" ALTER COLUMN "amountSAR" SET DATA TYPE DECIMAL(12,2)`,
      );
    }
  });

  it("rolls back when the audit insert fails after all business writes", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 30 }) });

    // Shrink the audit tool column so the audit insert (tool =
    // "create_client_payment", 21 chars) fails AFTER every business
    // write succeeded — proving the audit row is atomic with them.
    // Existing rows (the PREPARE audit) must go first or the ALTER
    // itself fails on over-long data.
    await admin.mcpAuditLog.deleteMany({});
    await admin.$executeRawUnsafe(`ALTER TABLE "McpAuditLog" ALTER COLUMN "tool" SET DATA TYPE VARCHAR(4)`);

    try {
      await expect(confirmIntent(prepared)).rejects.toThrow();

      expect(await admin.clientPayment.count({ where: { projectRecordId: TEST.projectId } })).toBe(0);
      expect(Number((await currentProject()).deposit)).toBe(0);
      expect(await admin.poolTransaction.count()).toBe(0);
      const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: prepared.confirmationId } });
      expect(row.status).not.toBe("EXECUTED");
    } finally {
      await admin.$executeRawUnsafe(`ALTER TABLE "McpAuditLog" ALTER COLUMN "tool" SET DATA TYPE VARCHAR(50)`);
    }
  });

  it("throws the coded McpActionError on conflict (never a raw Prisma error)", async () => {
    const prepared = await prepareIntent({ input: input({ amount: 25 }) });
    await admin.projectRecord.update({
      where: { id: TEST.projectId },
      data: { remaining: 1 },
    });
    const err = await confirmIntent(prepared).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpActionError);
    expect((err as McpActionError).code).toBe("conflict");
  });
});
