import { field } from "../../core/schema";
import { defineTool } from "../../registry/tool-definition";

/**
 * system.staging_write — HIGH / WRITE / approval REQUIRED
 *
 * The Phase 1B approval fixture. It exists to prove the write path end to end:
 *
 *   HIGH-risk capability → Policy says approval required → Job parks in
 *   WAITING_APPROVAL → human APPROVES → job resumes → tool executes ONCE
 *
 * It deliberately writes NOTHING outside the workforce module. There is no
 * business table, no money, no customer record and no external call behind it —
 * the handler only mints a receipt id, which the run + tool invocation rows
 * then persist. That is enough to prove the loop without touching a single
 * real business row.
 *
 * It is NOT part of the Phase 1A read bundle: it is registered explicitly by
 * the application composition root and by the Phase 1B tests, so the read-only
 * surface stays exactly as approved.
 */

export type StagingWriteInput = {
  note: string;
  requestRef?: string;
};

export type StagingWriteOutput = {
  stagingId: string;
  note: string;
  requestRef: string | null;
  recordedAt: string;
  /** Always NONE: this capability has no business or external effect. */
  businessImpact: "NONE";
  persistedBy: "WORKFORCE_ONLY";
  /** Present when the execution was authorised by a human approval. */
  approvalId: string | null;
};

export const systemStagingWriteTool = defineTool(
  {
    id: "system.staging_write",
    version: "1.0.0",
    name: "كتابة تجريبية آمنة",
    description:
      "أداة كتابة تجريبية (HIGH) تُستخدم لإثبات مسار الموافقة البشرية. لا تكتب أي بيانات أعمال ولا تُنفّذ أي تأثير خارجي — تُصدر إيصالًا داخليًّا فقط.",
    domain: "system",
    action: "staging_write",
    riskLevel: "HIGH",
    readWriteMode: "WRITE",
    inputSchema: {
      kind: "object",
      description: "ملاحظة تُخزَّن في سجل التشغيل فقط",
      fields: {
        note: field("string", { required: true, minLength: 3, maxLength: 200, description: "وصف مختصر للعملية" }),
        requestRef: field("string", { maxLength: 64, description: "مرجع خارجي اختياري" }),
      },
    },
    outputSchema: {
      kind: "object",
      description: "إيصال داخلي بلا أي أثر على بيانات الأعمال",
      fields: {
        stagingId: field("string", { required: true }),
        note: field("string", { required: true }),
        recordedAt: field("string", { required: true }),
        businessImpact: field("string", { required: true }),
        persistedBy: field("string", { required: true }),
        approvalId: field("string"),
      },
    },
    // `system.write` is granted to SUPER_ADMIN only, so the staging path is
    // also an RBAC probe: an office-finance admin can see it and cannot run it.
    requiredPermissions: ["aiworkforce.access", "system.write"],
    businessScoped: false,
    requiresApproval: true,
    estimatedCostPolicy: { kind: "NONE" },
    timeoutPolicy: { timeoutMs: 5_000, onTimeout: "FAIL" },
    // Writing tools must never be retried silently: one attempt, one effect.
    retryPolicy: { maxAttempts: 1, backoff: "NONE", retryOn: [] },
  },
  async (input: StagingWriteInput, ctx): Promise<StagingWriteOutput> => {
    return {
      stagingId: ctx.ids.next("staging"),
      note: input.note,
      requestRef: input.requestRef ?? null,
      recordedAt: ctx.now().toISOString(),
      businessImpact: "NONE",
      persistedBy: "WORKFORCE_ONLY",
      approvalId: ctx.context.approvalId ?? null,
    };
  },
);
