import { AiWorkforceError } from "../core/errors";
import { riskAtLeast } from "../core/types";
import type { ToolDefinition } from "../registry/tool-definition";

/**
 * Money safety.
 *
 * NEXUP stores money in EGP (Decimal columns) while its write paths convert
 * from integer piasters first (`toPiasters` in `src/lib/capital.ts`). The
 * workforce module NEVER re-implements those business rules: a money tool must
 * delegate to the existing service.
 *
 * What this policy enforces at registration time:
 *   1. a money-writing tool must be HIGH or CRITICAL risk
 *   2. a money-writing tool must require approval
 *   3. a money-writing tool may never be exposed as CRITICAL-less autonomous work
 */

/** Domains that touch money. */
export const MONEY_DOMAINS = ["capital", "finance"] as const;

export function isMoneyDomain(domain: string): boolean {
  return (MONEY_DOMAINS as readonly string[]).includes(domain);
}

export function isMoneySensitive(tool: Pick<ToolDefinition, "domain" | "readWriteMode">): boolean {
  return isMoneyDomain(tool.domain);
}

export function assertMoneySafety(tool: ToolDefinition): void {
  if (!isMoneySensitive(tool)) return;
  if (tool.readWriteMode !== "WRITE") return;

  if (!riskAtLeast(tool.riskLevel, "HIGH")) {
    throw new AiWorkforceError(
      "MONEY_SAFETY_VIOLATION",
      `Money-writing tool "${tool.id}" must be at least HIGH risk`,
      { riskLevel: tool.riskLevel },
    );
  }

  if (!tool.requiresApproval) {
    throw new AiWorkforceError(
      "MONEY_SAFETY_VIOLATION",
      `Money-writing tool "${tool.id}" must require approval`,
      { toolId: tool.id },
    );
  }
}

/* ═══════════════════════════════════════════════════════
   Integer piaster helpers
   ═══════════════════════════════════════════════════════

   Mirror of the arithmetic rules in `src/lib/capital.ts` so tools can compare
   and sum amounts without floating point drift. Conversion of persisted
   values is still owned by the existing service/adapter layer. */

export function egpToPiasters(egp: number): number {
  if (!Number.isFinite(egp)) {
    throw new AiWorkforceError("MONEY_SAFETY_VIOLATION", "Amount must be a finite number");
  }
  return Math.round(egp * 100);
}

export function piastersToEGP(piasters: number): number {
  if (!Number.isInteger(piasters)) {
    throw new AiWorkforceError("MONEY_SAFETY_VIOLATION", "Piaster amounts must be integers", { piasters });
  }
  return piasters / 100;
}

export function sumPiasters(...amounts: number[]): number {
  return amounts.reduce((total, amount) => {
    if (!Number.isInteger(amount)) {
      throw new AiWorkforceError("MONEY_SAFETY_VIOLATION", "Piaster amounts must be integers", { amount });
    }
    return total + amount;
  }, 0);
}
