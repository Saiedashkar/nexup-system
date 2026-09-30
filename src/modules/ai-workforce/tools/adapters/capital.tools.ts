import { field } from "../../core/schema";
import { egpToPiasters, piastersToEGP } from "../../policies/money-safety";
import { defineTool } from "../../registry/tool-definition";

/**
 * capital.summary — LOW / READ
 *
 * WRAP, not rewrite: the port delegates to `getCapitalSummary()` in
 * `src/lib/capital.ts`, the single place that already owns the balance rules
 * (CASH contributions only, soft-deleted rows excluded). This tool never
 * recomputes a balance itself.
 *
 * Monetary values are returned in EGP (as NEXUP stores them) together with an
 * integer-piaster mirror so downstream arithmetic never drifts.
 */

export type CapitalSummaryToolInput = Record<string, never>;

export type CapitalSummaryToolOutput = {
  currency: "EGP";
  totalReceived: number;
  totalSpent: number;
  available: number;
  availablePiasters: number;
  contributionCount: number;
  spendCount: number;
  funderCount: number;
  readAt: string;
};

export const capitalSummaryTool = defineTool(
  {
    id: "capital.summary",
    version: "1.0.0",
    name: "ملخّص رأس المال",
    description:
      "يعرض إجمالي المستلم والمصروف والرصيد المتاح في رأس المال المكتبي. قراءة فقط ومحسوب من السجلات الفعلية.",
    domain: "capital",
    action: "summary",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: {
      kind: "object",
      description: "لا يحتاج أي مدخلات — الرصيد مكتبي وليس مرتبطًا بـBusiness",
      fields: {},
    },
    outputSchema: {
      kind: "object",
      description: "ملخّص رأس المال بالجنيه + مرآة بالقروش",
      fields: {
        currency: field("string", { required: true }),
        totalReceived: field("number", { required: true }),
        totalSpent: field("number", { required: true }),
        available: field("number", { required: true }),
        availablePiasters: field("integer", { required: true }),
        contributionCount: field("integer", { required: true }),
        spendCount: field("integer", { required: true }),
        funderCount: field("integer", { required: true }),
        readAt: field("string", { required: true }),
      },
    },
    // Capital is office-wide data: it is gated by the office-finance permission
    // rather than a business scope.
    requiredPermissions: ["aiworkforce.access", "capital.read"],
    businessScoped: false,
    requiresApproval: false,
    estimatedCostPolicy: { kind: "NONE" },
    timeoutPolicy: { timeoutMs: 5_000, onTimeout: "FAIL" },
    retryPolicy: { maxAttempts: 1, backoff: "NONE", retryOn: [] },
  },
  async (_input, ctx): Promise<CapitalSummaryToolOutput> => {
    const summary = await ctx.ports.capital.summary();
    const availablePiasters = egpToPiasters(summary.available);

    return {
      currency: "EGP",
      totalReceived: summary.totalReceived,
      totalSpent: summary.totalSpent,
      available: piastersToEGP(availablePiasters),
      availablePiasters,
      contributionCount: summary.contributionCount,
      spendCount: summary.spendCount,
      funderCount: summary.funderCount,
      readAt: ctx.now().toISOString(),
    };
  },
);
