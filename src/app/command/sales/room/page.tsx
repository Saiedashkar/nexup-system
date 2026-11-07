import type { Metadata } from "next";
import { SalesRoom } from "@/components/command/sales/sales-room";

/**
 * SALES OPERATING ROOM — the room the gateway's sales door opens
 * ───────────────────────────────────────────────────────────────
 * ROUTE: `/command/sales/room`
 *
 * A client component under the `/command` layout: three clickable stations, the
 * decisions card, the team and the five-step demo journey. The journey lives in
 * React state only — this route has no action, no route handler and no database
 * access, which is what keeps the demo from creating a client, a project, an
 * offer or an activity record.
 *
 * The route exists so the gateway never links to a placeholder: `/command/sales`
 * → `/command/sales/room` → `/command/clients` · `/command/projects` are all real
 * pages, and the marketing door stays unlinked until its tree is delivered.
 */
export const metadata: Metadata = {
  title: "NEXUP COMMAND — Sales room",
  description: "Sales operating room: qualification, follow-up and offer, as a demo preview.",
};

export default function SalesRoomPage() {
  return <SalesRoom />;
}
