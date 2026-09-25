import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { McpPendingAction, Prisma } from "@prisma/client";
import {
  createPendingAction,
  runConfirmedAction,
  PENDING_ACTION_TTL_MS,
  MAX_TOKEN_ATTEMPTS,
  requestHashOf,
  stableStringify,
} from "../src/lib/mcp/pending";
import { McpActionError } from "../src/lib/mcp/errors";
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
   Phase 2B pending-action core — isolated-DB battery.

   Uses a throwaway LOCAL Postgres database (never Supabase).
   The "business mutation" under test is a minimal, generic update
   of the seeded ProjectRecord's notes — proving the transactional
   consume + mutation + audit + EXECUTED linkage without shipping
   any real Red business action (none exist in v1).
   ═══════════════════════════════════════════════════════════════ */

const ACTION_TOOL = "test_red_action";

beforeAll(setupDatabase, 240_000);
afterAll(teardownDatabase, 60_000);

// Tests share the seeded project; restore its guarded field so every
// test starts from the canonical fingerprint state (notes = null).
beforeEach(async () => {
  if (TEST.projectId) {
    await admin.projectRecord.update({ where: { id: TEST.projectId }, data: { notes: null } });
  }
});

/* ─── helpers ───────────────────────────────────────────────── */

function fingerprintFor(): Prisma.InputJsonValue {
  return { [`ProjectRecord:${TEST.projectId}`]: { notes: null } };
}

async function currentProject() {
  return admin.projectRecord.findUniqueOrThrow({ where: { id: TEST.projectId } });
}

async function prepareIntent(opts?: {
  principal?: ReturnType<typeof operatorPrincipal>;
  fingerprint?: Prisma.InputJsonValue;
  expiresInOverride?: number;
}) {
  const principal = opts?.principal ?? operatorPrincipal();
  return createPendingAction(principal, {
    tool: ACTION_TOOL,
    actionType: "UPDATE",
    entityType: "ProjectRecord",
    entityId: TEST.projectId,
    business: { id: TEST.businessId, slug: "nexup" },
    argsSnapshot: { projectId: TEST.projectId, notes: "confirmed-by-test" },
    preview: { setsNotesTo: "confirmed-by-test" },
    summary: "Set the test project's notes to 'confirmed-by-test'.",
    preconditionFingerprint: opts?.fingerprint ?? fingerprintFor(),
  });
}

/** Generic execution: write the snapshot's notes; audit via mcpAuditData shape. */
function makeExecution(noteOverride?: string) {
  return {
    execute: async (tx: Prisma.TransactionClient, pending: McpPendingAction) => {
      const args = pending.argsSnapshot as { projectId: string; notes?: string };
      const notes = noteOverride ?? args.notes ?? null;
      const row = await (tx as unknown as {
        projectRecord: { update: (a: unknown) => Promise<{ id: string; notes: string | null }> };
      }).projectRecord.update({
        where: { id: args.projectId },
        data: { notes },
      });
      return {
        data: row,
        audit: {
          source: "MCP/Hermes",
          actor: pending.actor,
          actorName: pending.actorName,
          tool: pending.tool,
          action: "UPDATE",
          entityType: "ProjectRecord",
          entityId: row.id,
          businessId: pending.businessId,
          businessSlug: pending.businessSlug,
          metadata: { notes },
        } as Prisma.McpAuditLogCreateInput,
      };
    },
  };
}

async function auditCountFor(pendingId: string): Promise<number> {
  return admin.mcpAuditLog.count({ where: { entityType: "McpPendingAction", entityId: pendingId } });
}

/* ─── suite ─────────────────────────────────────────────────── */

describe("Phase 2B — Red switch", () => {
  it("is OFF by default and requires BOTH switches truthy", async () => {
    const mod = await import("../src/lib/mcp/auth");
    delete process.env.MCP_WRITE_TOOLS_ENABLED;
    delete process.env.MCP_RED_ACTIONS_ENABLED;
    expect(mod.redActionsEnabled()).toBe(false);
    process.env.MCP_WRITE_TOOLS_ENABLED = "true";
    expect(mod.redActionsEnabled()).toBe(false); // red requires red flag
    process.env.MCP_RED_ACTIONS_ENABLED = "true";
    expect(mod.redActionsEnabled()).toBe(true);
    process.env.MCP_RED_ACTIONS_ENABLED = "TRUE";
    expect(mod.redActionsEnabled()).toBe(true);
    process.env.MCP_RED_ACTIONS_ENABLED = "1";
    expect(mod.redActionsEnabled()).toBe(true);
    process.env.MCP_RED_ACTIONS_ENABLED = "yes";
    expect(mod.redActionsEnabled()).toBe(true);
    for (const bad of ["", "false", "FALSE", "0", "no", " on", "enabled"]) {
      process.env.MCP_RED_ACTIONS_ENABLED = bad;
      expect(mod.redActionsEnabled()).toBe(false);
    }
    // writes off + red on must still be off (layered switches)
    delete process.env.MCP_WRITE_TOOLS_ENABLED;
    process.env.MCP_RED_ACTIONS_ENABLED = "true";
    expect(mod.redActionsEnabled()).toBe(false);
    delete process.env.MCP_WRITE_TOOLS_ENABLED;
    delete process.env.MCP_RED_ACTIONS_ENABLED;
  });

  it("keeps the Yellow Phase 2A surface unchanged (tool names + principal tools)", async () => {
    const mod = await import("../src/lib/mcp/auth");
    delete process.env.MCP_RED_ACTIONS_ENABLED;
    process.env.MCP_WRITE_TOOLS_ENABLED = "true";
    const p = mod.buildSuperPrincipal();
    const names = [...p.allowedTools].sort();
    expect(names).toEqual(
      [
        "search_clients", "get_client", "get_clients", "get_projects",
        "get_project", "get_businesses", "get_business_summary", "get_brand_context",
        "create_client", "update_client", "create_project", "update_project",
      ].sort(),
    );
    delete process.env.MCP_WRITE_TOOLS_ENABLED;
    const ro = mod.buildSuperPrincipal();
    expect([...ro.allowedTools].sort()).toEqual(
      [
        "search_clients", "get_client", "get_clients", "get_projects",
        "get_project", "get_businesses", "get_business_summary", "get_brand_context",
      ].sort(),
    );
    expect(ro.role).toBe("MCP_READONLY");
  });
});

describe("Phase 2B — token handling", () => {
  it("hashes tokens: stored hash matches only the real token; no plaintext anywhere in the row", async () => {
    const { token, confirmationId } = await prepareIntent();
    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(row.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.confirmTokenHash).not.toContain(token);
    // no column of the row contains the plaintext token
    for (const [field, value] of Object.entries(row as unknown as Record<string, unknown>)) {
      if (typeof value === "string") {
        expect(value.includes(token), `plaintext token found in column ${field}`).toBe(false);
      }
    }
    // audit rows also never contain the plaintext
    const audits = await admin.mcpAuditLog.findMany({ where: { entityType: "McpPendingAction", entityId: confirmationId } });
    expect(audits.length).toBe(1);
    expect(JSON.stringify(audits[0].metadata).includes(token)).toBe(false);
  });

  it("gives a 256-bit base64url token and a 10-minute expiry", async () => {
    const { token, expiresAt } = await prepareIntent();
    expect(token.length).toBe(43); // 32 bytes → 43 base64url chars, no padding
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(PENDING_ACTION_TTL_MS - 5_000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(PENDING_ACTION_TTL_MS);
  });
});

describe("Phase 2B — confirm success path (one transaction)", () => {
  it("consumes + mutates + audits + EXECUTED atomically", async () => {
    const before = await currentProject();
    const { token, confirmationId } = await prepareIntent();

    const outcome = await runConfirmedAction({
      principal: operatorPrincipal(),
      confirmTool: "confirm_test_red_action",
      actionTool: ACTION_TOOL,
      confirmationId,
      token,
      execution: makeExecution(),
    });

    expect(outcome.confirmationId).toBe(confirmationId);
    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(row.status).toBe("EXECUTED");
    expect(row.confirmedAt).not.toBeNull();
    expect(row.executedAt).not.toBeNull();
    expect(row.resultAuditLogId).toBeTruthy();

    const after = await currentProject();
    expect(after.notes).toBe("confirmed-by-test");
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    // business audit row exists and is linked
    const bizAudit = await admin.mcpAuditLog.findUniqueOrThrow({ where: { id: outcome.auditLogId } });
    expect(bizAudit.tool).toBe(ACTION_TOOL);
    expect(bizAudit.action).toBe("UPDATE");
    expect(bizAudit.entityId).toBe(TEST.projectId);
  });
});

describe("Phase 2B — fail-closed paths", () => {
  it("rejects a wrong token and never executes (attempts counted, then FAILED)", async () => {
    const { confirmationId } = await prepareIntent();
    for (let i = 1; i < MAX_TOKEN_ATTEMPTS; i++) {
      await expect(
        runConfirmedAction({
          principal: operatorPrincipal(),
          confirmTool: "confirm_test_red_action",
          actionTool: ACTION_TOOL,
          confirmationId,
          token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          execution: makeExecution(),
        }),
      ).rejects.toMatchObject({ code: "confirmation_invalid" });
    }
    // business data untouched
    expect((await currentProject()).notes).toBeNull();
    // final wrong attempt flips the row to FAILED
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "confirmation_invalid" });
    expect((await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("FAILED");
    expect((await currentProject()).notes).toBeNull();
  });

  it("rejects an expired confirmation and marks it EXPIRED", async () => {
    const { token, confirmationId } = await prepareIntent();
    // force expiry
    await admin.mcpPendingAction.update({
      where: { id: confirmationId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "confirmation_expired" });
    expect((await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("EXPIRED");
    expect((await currentProject()).notes).toBeNull();
  });

  it("rejects replay after successful execution", async () => {
    const { token, confirmationId } = await prepareIntent();
    await runConfirmedAction({
      principal: operatorPrincipal(),
      confirmTool: "confirm_test_red_action",
      actionTool: ACTION_TOOL,
      confirmationId,
      token,
      execution: makeExecution(),
    });
    const notesAfterFirst = (await currentProject()).notes;
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: makeExecution("replayed-should-not-appear"),
      }),
    ).rejects.toMatchObject({ code: "confirmation_used" });
    expect((await currentProject()).notes).toBe(notesAfterFirst);
  });

  it("rejects concurrent double-confirmation: exactly one wins, loser rolls back", async () => {
    const { token, confirmationId } = await prepareIntent();
    const execution = makeExecution("concurrent-note");
    const attempt = () =>
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution,
      });
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "confirmation_used" });
    }
    // business mutation applied exactly once (notes value, updatedAt sane)
    expect((await currentProject()).notes).toBe("concurrent-note");
    // exactly one business audit row for this confirmation linkage
    const executed = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(executed.status).toBe("EXECUTED");
    const bizAudits = await admin.mcpAuditLog.count({ where: { id: executed.resultAuditLogId! } });
    expect(bizAudits).toBe(1);
  });

  it("enforces same-principal (v1): another principal cannot confirm", async () => {
    const { token, confirmationId } = await prepareIntent({ principal: operatorPrincipal() });
    await expect(
      runConfirmedAction({
        principal: otherPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await currentProject()).notes).toBeNull();
    // row stays PENDING and the rightful principal can still confirm
    expect((await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("PENDING");
    await runConfirmedAction({
      principal: operatorPrincipal(),
      confirmTool: "confirm_test_red_action",
      actionTool: ACTION_TOOL,
      confirmationId,
      token,
      execution: makeExecution(),
    });
    expect((await currentProject()).notes).toBe("confirmed-by-test");
  });

  it("enforces business scope at confirm time", async () => {
    const { token, confirmationId } = await prepareIntent();
    await expect(
      runConfirmedAction({
        principal: restrictedPrincipal(), // same id, nexup NOT allowed
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await currentProject()).notes).toBeNull();
  });

  it("rejects on precondition conflict and rolls everything back", async () => {
    const { token, confirmationId } = await prepareIntent(); // fingerprint: notes === null
    // drift the guarded field AFTER prepare
    await admin.projectRecord.update({ where: { id: TEST.projectId }, data: { notes: "drifted" } });
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: makeExecution("should-never-land"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    // mutation did not land; pending row flipped FAILED (business-neutral marker)
    expect((await currentProject()).notes).toBe("drifted");
    expect((await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("FAILED");
    // and the business audit row was never created
    const executedRow = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(executedRow.resultAuditLogId).toBeNull();
  });

  it("rolls back mutation AND consumption when execution fails mid-transaction", async () => {
    const { token, confirmationId } = await prepareIntent();
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: {
          execute: async () => {
            throw new Error("simulated business failure");
          },
        },
      }),
    ).rejects.toThrow("simulated business failure");

    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(row.status).toBe("PENDING"); // consumption rolled back
    expect(row.resultAuditLogId).toBeNull();
    expect((await currentProject()).notes).toBeNull();

    // the same confirmation still completes with a working execution
    await runConfirmedAction({
      principal: operatorPrincipal(),
      confirmTool: "confirm_test_red_action",
      actionTool: ACTION_TOOL,
      confirmationId,
      token,
      execution: makeExecution(),
    });
    expect((await currentProject()).notes).toBe("confirmed-by-test");
    expect((await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } })).status).toBe("EXECUTED");
  });

  it("rolls back mutation AND consumption when the audit insert fails", async () => {
    const { token, confirmationId } = await prepareIntent();
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId,
        token,
        execution: {
          execute: async (tx, pending) => ({
            data: { ok: true },
            // actorName NOT NULL violated → audit insert throws
            audit: {
              source: "MCP/Hermes",
              actor: pending.actor,
              actorName: null as unknown as string,
              tool: pending.tool,
              action: "UPDATE",
              entityType: "ProjectRecord",
              entityId: TEST.projectId,
              businessId: pending.businessId,
              businessSlug: pending.businessSlug,
              metadata: {},
            } as unknown as Prisma.McpAuditLogCreateInput,
          }),
        },
      }),
    ).rejects.toThrow();

    const row = await admin.mcpPendingAction.findUniqueOrThrow({ where: { id: confirmationId } });
    expect(row.status).toBe("PENDING"); // consume rolled back with the failed audit
    expect(row.resultAuditLogId).toBeNull();
    expect((await currentProject()).notes).toBeNull();
  });
});

describe("Phase 2B — prepare audit + misc", () => {
  it("writes exactly one PREPARE audit row, transactionally with the pending row", async () => {
    const { confirmationId } = await prepareIntent();
    expect(await auditCountFor(confirmationId)).toBe(1);
    const audit = await admin.mcpAuditLog.findFirstOrThrow({ where: { entityType: "McpPendingAction", entityId: confirmationId } });
    expect(audit.action).toBe("PREPARE");
    expect(audit.actor).toBe(operatorPrincipal().id);
  });

  it("rejects a confirmation id that does not exist", async () => {
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_test_red_action",
        actionTool: ACTION_TOOL,
        confirmationId: "cmaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "confirmation_invalid" });
  });

  it("rejects confirming with the wrong action tool", async () => {
    const { token, confirmationId } = await prepareIntent();
    await expect(
      runConfirmedAction({
        principal: operatorPrincipal(),
        confirmTool: "confirm_other_action",
        actionTool: "some_other_red_action",
        confirmationId,
        token,
        execution: makeExecution(),
      }),
    ).rejects.toMatchObject({ code: "confirmation_invalid" });
    expect((await currentProject()).notes).toBeNull();
  });

  it("requestHash is stable across key order and sensitive to values", () => {
    const a = requestHashOf({ b: 1, a: { d: 2, c: [3, 4] } });
    const b = requestHashOf({ a: { c: [3, 4], d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).not.toBe(requestHashOf({ b: 2, a: { d: 2, c: [3, 4] } }));
    expect(stableStringify({ x: undefined, y: 1 })).toBe(stableStringify({ y: 1 }));
  });
});
