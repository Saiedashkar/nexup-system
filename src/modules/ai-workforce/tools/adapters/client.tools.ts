import { field } from "../../core/schema";
import type { ClientSummary } from "../../core/ports";
import { defineTool } from "../../registry/tool-definition";

/**
 * client.search — LOW / READ
 *
 * Thin adapter over the existing client read path. The port implementation
 * delegates to the same Prisma model the legacy pages use (including the
 * soft-delete aware client), so no business rule is re-implemented here.
 */

export type ClientSearchInput = {
  businessId: string;
  query: string;
  limit: number;
};

export type ClientSearchOutput = {
  businessId: string;
  count: number;
  clients: ClientSummary[];
  searchedAt: string;
};

export const clientSearchTool = defineTool(
  {
    id: "client.search",
    version: "1.0.0",
    name: "البحث عن عميل",
    description:
      "يبحث عن عملاء داخل نطاق Business محدد بالاسم أو رقم الهاتف. قراءة فقط ولا يعدّل أي بيانات.",
    domain: "crm",
    action: "search",
    riskLevel: "LOW",
    readWriteMode: "READ",
    inputSchema: {
      kind: "object",
      description: "نطاق البحث ومعيار المطابقة",
      fields: {
        businessId: field("string", { required: true, minLength: 1, description: "معرّف الـBusiness (من الجلسة)" }),
        query: field("string", { required: true, minLength: 2, maxLength: 120, description: "اسم أو جزء من اسم/هاتف العميل" }),
        limit: field("integer", { min: 1, max: 50, default: 20, description: "أقصى عدد نتائج" }),
      },
    },
    outputSchema: {
      kind: "object",
      description: "قائمة العملاء المطابقين + عددهم",
      fields: {
        businessId: field("string", { required: true }),
        count: field("integer", { required: true }),
        searchedAt: field("string", { required: true }),
      },
    },
    requiredPermissions: ["aiworkforce.access", "clients.read"],
    businessScoped: true,
    requiresApproval: false,
    estimatedCostPolicy: { kind: "NONE" },
    timeoutPolicy: { timeoutMs: 5_000, onTimeout: "FAIL" },
    retryPolicy: { maxAttempts: 2, backoff: "FIXED", backoffMs: 0, retryOn: [] },
  },
  async (input: ClientSearchInput, ctx): Promise<ClientSearchOutput> => {
    const clients = await ctx.ports.clients.search(input);
    return {
      businessId: input.businessId,
      count: clients.length,
      clients,
      searchedAt: ctx.now().toISOString(),
    };
  },
);
