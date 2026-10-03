import { LivingOrganization } from "@/components/command/organization/living-organization";

/**
 * COMMAND HOME (Phase UI-02.1)
 * ────────────────────────────
 * One page, one environment. The command bar is shell chrome and lives in the
 * shell's pinned top band; the command surface belongs to the environment and
 * lives in the shell's bottom band; everything between them is the ROOM.
 *
 * UI-01.1 stacked three sections here — a hero, a bordered organization panel
 * and a four-card Systems section — which is what made the environment read as a
 * dashboard of unrelated blocks. Identity now stands inside the room, systems
 * are mounted on its perimeter, and there is nothing left to stack.
 */
export default function CommandHomePage() {
  return (
    <div className="nc-page">
      <LivingOrganization />
    </div>
  );
}
