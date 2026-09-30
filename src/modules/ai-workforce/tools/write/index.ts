import type { ToolAdapter } from "../../registry/tool-definition";
import { systemStagingWriteTool } from "../adapters/system.tools";

/**
 * Phase 1B write bundle.
 *
 * Exactly one capability, and it is a fixture: it proves
 * HIGH → approval → resume → execute-once without any real business write.
 *
 * Real write capabilities (recording an expense, writing capital) arrive only
 * after the approval loop is proven, and they must WRAP the existing services
 * (`src/lib/capital.ts`) rather than re-implement any money rule.
 */
export const writeToolAdapters: readonly ToolAdapter[] = [systemStagingWriteTool];

export { systemStagingWriteTool };
