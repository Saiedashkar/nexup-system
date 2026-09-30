import { FounderHero } from "@/components/command/founder-hero";
import { LivingOrganization } from "@/components/command/organization/living-organization";
import { SystemsLauncher } from "@/components/command/systems-launcher";

/**
 * COMMAND HOME (Phase UI-01)
 * ──────────────────────────
 * Page one of the Command environment. The command bar is shell chrome and
 * lives in the shell's pinned top band; this page is the scrolling surface
 * beneath it, composed from client islands that all read the same local
 * visual-state store — no server data, no database, no AI.
 *
 * Order is intentional: human authority first, then the hero (Living
 * Organization), then the systems the organization can actually reach.
 */
export default function CommandHomePage() {
  return (
    <div className="nc-anim-page">
      <FounderHero />
      <LivingOrganization />

      <section className="nc-section nc-anim-panel" aria-label="Systems" style={{ marginTop: 26 }}>
        <div className="nc-section__head">
          <h2 className="nc-section__title">Systems</h2>
          <div className="nc-section__spacer" />
          <span className="nc-section__note">
            Visual placeholders only — NEXUP System routes to the existing system; nothing else is
            integrated.
          </span>
        </div>
        <SystemsLauncher />
      </section>

      {/* Bottom breathing room so the last row clears the bottom dock. */}
      <div style={{ height: 24 }} />
    </div>
  );
}
