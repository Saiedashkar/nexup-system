import type { Metadata } from "next";
import { MarketingRoom } from "@/components/command/marketing/marketing-room";
import "./marketing.css";

/**
 * MARKETING ROOM
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/marketing`
 *
 * The campaign «تصميم متاجر سلة وزد» worked in place: strategy (the brief),
 * content (the editable X draft) and publish review (approval, slot, scheduling
 * request) all open INSIDE this room. The scheduling connector is a local demo,
 * and an accepted schedule is a request — not a publication.
 *
 * This page adds no shell, no navigation and no data access. It sits under the
 * existing `/command` layout, so the rail, the composer and the Executive
 * console stay exactly where MAIN BUILDER 2 keeps them; the room is the content
 * of one surface and nothing else.
 */
export const metadata: Metadata = {
  title: "غرفة التسويق · NEXUP COMMAND",
  description:
    "غرفة التسويق في COMMAND — حملة تصميم متاجر سلة وزد من البريف إلى طلب الجدولة التجريبي.",
};

export default function MarketingRoomPage() {
  return <MarketingRoom />;
}
