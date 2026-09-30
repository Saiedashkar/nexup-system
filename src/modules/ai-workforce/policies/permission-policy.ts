import { AiWorkforceError } from "../core/errors";
import type { ExecutionContext, PermissionToken } from "../core/execution-context";
import { PERMISSION_TOKENS } from "../core/execution-context";
import type { ToolDefinition } from "../registry/tool-definition";

/**
 * Permission policy.
 *
 * The legacy NEXUP session (role + 4 flags + business slug) stays the single
 * source of truth. This module only MIRRORS those rules into tool tokens, so
 * a workforce capability can never grant more than its actor already has in
 * the existing system.
 *
 * INTERIM MIRROR — Phase 1B should centralise this derivation next to
 * `src/lib/auth.ts`, but nothing here modifies legacy auth.
 */

export type LegacyAccessFlags = {
  role: string;
  isSuperAdmin: boolean;
  hasOfficeFinanceFull: boolean;
  accessibleBusinessSlugs: string[];
};

export function derivePermissionTokens(flags: LegacyAccessFlags): PermissionToken[] {
  const granted = new Set<PermissionToken>();
  const all = () => PERMISSION_TOKENS.forEach((token) => granted.add(token));

  if (flags.isSuperAdmin || flags.role === "SUPER_ADMIN") {
    // SUPER_ADMIN bypasses every check in the existing middleware.
    all();
    return [...granted];
  }

  if (flags.hasOfficeFinanceFull) {
    granted.add("aiworkforce.access");
    granted.add("capital.read");
    granted.add("capital.write");
    granted.add("capital.approve");
    granted.add("clients.read");
    granted.add("projects.read");
  }

  if (flags.accessibleBusinessSlugs.length > 0) {
    granted.add("aiworkforce.access");
    granted.add("clients.read");
    granted.add("projects.read");
    if (flags.role === "ADMIN") {
      granted.add("clients.write");
      granted.add("projects.write");
    } else if (flags.role === "EMPLOYEE") {
      // Legacy semantics: an EMPLOYEE works with clients only.
      granted.delete("projects.read");
      granted.add("clients.write");
    }
  }

  return [...granted];
}

export type PermissionDecisionReason =
  | "GRANTED"
  | "MODULE_DISABLED"
  | "MISSING_TOKENS"
  | "SCOPE_MISSING"
  | "SCOPE_DENIED"
  /** Permission was never checked — the capability did not resolve. */
  | "NOT_EVALUATED";

export type PermissionDecision = {
  allowed: boolean;
  reason: PermissionDecisionReason;
  missing: PermissionToken[];
  detail?: string;
};

export function notEvaluatedDecision(detail: string): PermissionDecision {
  return { allowed: false, reason: "NOT_EVALUATED", missing: [], detail };
}

export class PermissionPolicy {
  evaluate(tool: ToolDefinition, context: ExecutionContext, input?: Record<string, unknown>): PermissionDecision {
    const granted = new Set(context.actor.permissionTokens);

    if (!granted.has("aiworkforce.access")) {
      return {
        allowed: false,
        reason: "MODULE_DISABLED",
        missing: ["aiworkforce.access"],
        detail: "Actor has no AI Workforce access",
      };
    }

    const missing = tool.requiredPermissions.filter((token) => !granted.has(token));
    if (missing.length > 0) {
      return { allowed: false, reason: "MISSING_TOKENS", missing };
    }

    if (tool.businessScoped) {
      if (!context.business) {
        return { allowed: false, reason: "SCOPE_MISSING", missing: [], detail: "No business scope resolved for this execution" };
      }

      const { actor } = context;
      if (!actor.isSuperAdmin && !actor.accessibleBusinessSlugs.includes(context.business.slug)) {
        return {
          allowed: false,
          reason: "SCOPE_DENIED",
          missing: [],
          detail: `Actor cannot reach business "${context.business.slug}"`,
        };
      }

      // Tool input may never widen the scope that the session already fixed.
      const inputBusinessId = input?.businessId;
      if (!actor.isSuperAdmin && typeof inputBusinessId === "string" && inputBusinessId !== context.business.id) {
        return {
          allowed: false,
          reason: "SCOPE_DENIED",
          missing: [],
          detail: "Input businessId does not match the execution scope",
        };
      }
    }

    return { allowed: true, reason: "GRANTED", missing: [] };
  }

  /** Same as `evaluate`, but throws the typed error the runtime expects. */
  assert(tool: ToolDefinition, context: ExecutionContext, input?: Record<string, unknown>): void {
    const decision = this.evaluate(tool, context, input);
    if (decision.allowed) return;

    const code = decision.reason === "SCOPE_MISSING" ? "SCOPE_MISSING" : decision.reason === "SCOPE_DENIED" ? "SCOPE_DENIED" : "PERMISSION_DENIED";

    throw new AiWorkforceError(code, decision.detail ?? "Permission denied", {
      toolId: tool.id,
      reason: decision.reason,
      missing: decision.missing,
    });
  }
}
