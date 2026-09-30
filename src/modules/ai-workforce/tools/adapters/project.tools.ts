import { field } from "../../core/schema";
import type { ProjectSummary } from "../../core/ports";
import { defineTool } from "../../registry/tool-definition";

/**
 * project.list — LOW / READ
 *
 * Adapter over the existing project records. Status values mirror the schema
 * enums (`WorkStatus`, `PaymentStatus`) — the vocabulary is not redefined.
 */

export const WORK_STATUSES = ["WAITING", "IN_PROGRESS", "COMPLETED", "PAUSED"] as const;
export const PAYMENT_STATUSES = ["FULL", "PARTIAL", "UNPAID"] as const;

export type ProjectListInput = {
  businessId: string;
  workStatus?: string;
  paymentStatus?: string;
  limit: number;
};

export type ProjectListOutput = {
  businessId: string;
  count: number;
  projects: ProjectSummary[];
  listedAt: string;
};

export const projectListTool = defineTool(
  {
    id: "project.list",
    version: "1.0.0",
    name: "قائمة المشاريع",
    description:
      "يسرد مشاريع Business محدد مع حالات التنفيذ والدفع والمبالغ. قراءة فقط.",
    domain: "projects",
    action: "list",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: {
      kind: "object",
      description: "فلاتر قائمة المشاريع",
      fields: {
        businessId: field("string", { required: true, minLength: 1 }),
        workStatus: field("string", { enum: WORK_STATUSES, description: "حالة التنفيذ" }),
        paymentStatus: field("string", { enum: PAYMENT_STATUSES, description: "حالة الدفع" }),
        limit: field("integer", { min: 1, max: 50, default: 20 }),
      },
    },
    outputSchema: {
      kind: "object",
      description: "قائمة المشاريع + عددها",
      fields: {
        businessId: field("string", { required: true }),
        count: field("integer", { required: true }),
        listedAt: field("string", { required: true }),
      },
    },
    requiredPermissions: ["aiworkforce.access", "projects.read"],
    businessScoped: true,
    requiresApproval: false,
    estimatedCostPolicy: { kind: "NONE" },
    timeoutPolicy: { timeoutMs: 5_000, onTimeout: "FAIL" },
    retryPolicy: { maxAttempts: 2, backoff: "FIXED", backoffMs: 0, retryOn: [] },
  },
  async (input: ProjectListInput, ctx): Promise<ProjectListOutput> => {
    const projects = await ctx.ports.projects.list(input);
    return {
      businessId: input.businessId,
      count: projects.length,
      projects,
      listedAt: ctx.now().toISOString(),
    };
  },
);
