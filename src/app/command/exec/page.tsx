import type { Metadata } from "next";
import { ExecWorkspace } from "@/components/command/workspace/exec-workspace";

/**
 * EXEC — the organization's central intelligence (Phase UI-05)
 * ───────────────────────────────────────────────────────────
 * ROUTE: `/command/exec`
 *
 * EXEC is a first-class entity, so it gets its own route rather than living
 * only inside the command bar. It sits under the existing `/command` layout, so
 * the shell, the command bar and the executive console stay mounted and EXEC
 * remains reachable from everywhere.
 *
 * There is no data fetching and no AI provider: `ExecWorkspace` renders mock
 * configuration only.
 */
export const metadata: Metadata = {
  title: "EXEC · NEXUP COMMAND",
  description: "The central intelligence of NEXUP COMMAND — mock foundation.",
};

export default function ExecPage() {
  return <ExecWorkspace />;
}
