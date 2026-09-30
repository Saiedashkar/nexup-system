import type { ToolAdapter } from "../../registry/tool-definition";
import { capitalSummaryTool } from "../adapters/capital.tools";
import { clientSearchTool } from "../adapters/client.tools";
import { projectListTool } from "../adapters/project.tools";

/**
 * Phase 1A ships exactly three read-only capabilities.
 *
 * The goal is to prove the Tool Contract (registry, risk, policy, approvals,
 * run/audit), not to grow a catalogue. Write tools arrive in Phase 1B together
 * with the approval UI and an isolated development database.
 */
export const readToolAdapters: readonly ToolAdapter[] = [clientSearchTool, projectListTool, capitalSummaryTool];

export { capitalSummaryTool, clientSearchTool, projectListTool };
