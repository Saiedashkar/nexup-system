import type { Metadata } from "next";
import { SalesGateway } from "@/components/command/sales/sales-gateway";

/**
 * MARKETING & SALES GATEWAY — the door from the home's department plate
 * ────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/sales`
 *
 * This route is the one the department plate opens (see `workspaceHref` in
 * `state/department-workspace.ts`), so entering Marketing & Sales from the home
 * lands on a choice between its rooms rather than in a generic workspace. The
 * full pre-existing workspace is still linked from the gateway, unchanged.
 *
 * It sits under the `/command` layout: the shell, the command bar, the rail and
 * the Executive console stay mounted, and nothing here fetches or writes.
 */
export const metadata: Metadata = {
  title: "NEXUP COMMAND — Marketing & Sales",
  description: "Gateway to the marketing and sales rooms inside NEXUP COMMAND (demo preview).",
};

export default function SalesGatewayPage() {
  return <SalesGateway />;
}
