import type { Metadata } from "next";

import { ExecReviewTools } from "@/components/command/exec-lab/review-tools";

/* Same additive stylesheet as the EXEC route, imported HERE as well so the tools
   page is standalone: it is a review instrument, not part of the experience. */
import "../../exec-lab.css";

/**
 * EXEC REVIEW TOOLS (Phase EXEC-01)
 * ────────────────────────────────
 * ROUTE: `/command/exec/lab`
 *
 * The demo scenarios, the state vocabulary, the demo history and the approved
 * reference boards — deliberately outside `/command/exec`, where a founder should
 * see a conversation and nothing else.
 *
 * No data fetching, no provider, no runtime call and no execution: the scenario
 * list is the same typed fixture the conversation uses.
 */
export const metadata: Metadata = {
  title: "EXEC review tools · NEXUP COMMAND",
  description:
    "Review instruments for the EXEC experience: scripted demo scenarios, the state vocabulary, the demo history and the approved reference boards.",
};

export default function ExecReviewToolsPage() {
  return <ExecReviewTools />;
}
