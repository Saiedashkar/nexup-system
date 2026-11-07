import { LivingOrganization } from "@/components/command/organization/living-organization";
import { CommandMobileOverview } from "@/components/command/organization/command-mobile-overview";

/**
 * COMMAND HOME (Phase UI-02.1, extended UI-05, extended by the Product Lab)
 * ────────────────────────────────────────────────────────────────────────
 * One page, one environment. The command bar is shell chrome and lives in the
 * shell's pinned top band; the command surface belongs to the environment and
 * lives in the shell's bottom band; everything between them is the ROOM.
 *
 * Phase UI-05 adds a second, deliberate composition for phones: the desktop
 * room is stood down at ≤760px and `CommandMobileOverview` takes its place —
 * EXEC first, then the actions and departments a thumb actually reaches for.
 * The two are never both visible; see `system.css`.
 *
 * The Product Lab's separate operating-detail band is deliberately NOT appended
 * any more. It repeated the figures, the priority panels and the services that
 * the home's own disclosure already folds one tap away; two disclosures in one
 * scroll was the dashboard clutter the approved composition removes. The band
 * component is untouched and still available to any surface that wants it.
 */
export default function CommandHomePage() {
  return (
    <div className="nc-page">
      <LivingOrganization />
      <CommandMobileOverview />
    </div>
  );
}
