import type { Metadata } from "next";

import { ExecExperience } from "@/components/command/exec-lab/exec-experience";

/* The EXEC Experience's one additive stylesheet. Scoped under `.nce`, and
   imported HERE rather than from the shared command layout, so this pass adds no
   line to a file another track owns. */
import "../exec-lab.css";

/**
 * EXEC — the executive experience (Phase EXEC-01)
 * ──────────────────────────────────────────────
 * ROUTE: `/command/exec`
 *
 * This is the EXEC screen. It sits under the existing `/command` layout, so the
 * shell, the command bar and the room stay mounted and EXEC remains reachable
 * from everywhere — the same placement the console used.
 *
 * The previous EXEC foundation console was NOT deleted: it moved to
 * `/command/exec/console`, so the earlier mock structure stays reviewable while
 * the experience is reviewed. Promoting this file's content back to a different
 * route is a one-line change once ownership is settled.
 *
 * There is no data fetching, no provider, no runtime call and no execution on
 * this route. Everything on screen comes from `components/command/exec-lab/`
 * (typed demo fixtures + a deterministic scenario engine) and is labelled as
 * demo state in the UI.
 */
export const metadata: Metadata = {
  title: "EXEC · NEXUP COMMAND",
  description:
    "EXEC — the executive intelligence of NEXUP COMMAND. A reviewable, local demo experience: brief, plan, delegation, review, correction and verified result.",
};

export default function ExecPage() {
  return <ExecExperience />;
}
