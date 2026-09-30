import type { Clock, IdFactory } from "./types";
import type { ExecutionContext } from "./execution-context";

/* ═══════════════════════════════════════════════════════
   Read ports
   ═══════════════════════════════════════════════════════

   A port is the ONLY way a tool reaches business data.

   Phase 1A ships read-only ports implemented against the existing Prisma
   client (see `adapters/prisma-read-ports.ts`). Tests inject fakes, which is
   why the control core never imports Prisma itself.

   Every port is a thin boundary over EXISTING behaviour: it must not
   re-implement business rules (balances, commissions, soft-delete filtering).
   Where a legacy service already owns that rule, the implementation delegates
   to it — that is the "WRAP service directly" rule. */

export type ClientSummary = {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  tier: string;
};

export type ClientSearchInput = {
  businessId: string;
  query: string;
  limit: number;
};

export interface ClientReadPort {
  search(input: ClientSearchInput): Promise<ClientSummary[]>;
}

export type ProjectSummary = {
  id: string;
  businessId: string;
  projectName: string;
  clientId: string;
  workStatus: string;
  paymentStatus: string;
  /** EGP as stored in NEXUP; Decimal columns are converted by the adapter. */
  totalPrice: number;
  deposit: number;
  remaining: number;
  date: string;
};

export type ProjectListInput = {
  businessId: string;
  workStatus?: string;
  paymentStatus?: string;
  limit: number;
};

export interface ProjectReadPort {
  list(input: ProjectListInput): Promise<ProjectSummary[]>;
}

/** Mirrors `CapitalSummary` from `src/lib/capital.ts` — values are EGP. */
export type CapitalSummaryView = {
  totalReceived: number;
  totalSpent: number;
  available: number;
  contributionCount: number;
  spendCount: number;
  funderCount: number;
};

export interface CapitalReadPort {
  summary(): Promise<CapitalSummaryView>;
}

/** The full port surface available to workforce tools. */
export interface WorkforcePorts {
  clients: ClientReadPort;
  projects: ProjectReadPort;
  capital: CapitalReadPort;
}

/* ═══════════════════════════════════════════════════════
   Tool handler contract
   ═══════════════════════════════════════════════════════ */

export type ToolHandlerContext = {
  /** Identity + permissions + scope for THIS execution. Read-only. */
  context: ExecutionContext;
  ports: WorkforcePorts;
  ids: IdFactory;
  now: Clock;
};

export type ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  ctx: ToolHandlerContext,
) => Promise<TOutput>;
