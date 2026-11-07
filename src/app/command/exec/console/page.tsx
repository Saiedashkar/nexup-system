import type { Metadata } from "next";

import { ExecWorkspace } from "@/components/command/workspace/exec-workspace";

/**
 * EXEC FOUNDATION CONSOLE — preserved
 * ───────────────────────────────────
 * ROUTE: `/command/exec/console`
 *
 * The EXEC workspace that lived at `/command/exec` before Phase EXEC-01. It is
 * moved rather than deleted: the earlier mock structure (Command, Summon, War
 * Room, Mission Routing, Repeating Work, Context, Activity) stays reviewable
 * while the new experience is reviewed, and nothing that referenced it lost
 * access to it.
 *
 * Unchanged behaviour: mock configuration only. No AI provider, no tool runtime,
 * no scheduler and no memory store behind any of it.
 */
export const metadata: Metadata = {
  title: "EXEC console · NEXUP COMMAND",
  description: "The EXEC foundation console — the mock structural foundation, preserved.",
};

export default function ExecConsolePage() {
  return <ExecWorkspace />;
}
