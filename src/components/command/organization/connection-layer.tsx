"use client";

import { DEPARTMENTS, EXECUTIVE, nodeAnchor } from "../state/organization-model";
import { isWorkingStatus, type OrganizationVisualState } from "../state/visual-state";
import { cssVars } from "../ui/css-vars";

/**
 * The wiring of the organization.
 *
 * Three things are drawn, and each answers a different question:
 *   · rings around the Executive — "this is one organism", and they turn only
 *     while the Executive is actually thinking or working;
 *   · Executive → department links — they take the department's accent and
 *     brighten the moment that department is working, so the eye finds "who is
 *     working" without reading a single label;
 *   · a handoff signal — a one-shot travelling dot plus a flowing dashed stroke
 *     along the real connection, so "who delegated to whom" is legible at a
 *     glance.
 *
 * The link SVG uses a 0-100 viewBox stretched over the same box the cards are
 * percent-anchored in, so both layers share one coordinate system and can never
 * drift apart — including during contextual zoom, because they live inside the
 * same transformed canvas.
 */
export function ConnectionLayer({ visual }: { visual: OrganizationVisualState }) {
  const executiveBusy = isWorkingStatus(visual.executive.status);

  return (
    <>
      {/* Rings sit in their own square SVG so the ellipses keep their shape at
          any stage width — the link layer is stretched, this one is not. */}
      <div
        className="nc-rings"
        aria-hidden="true"
        style={cssVars({ left: `${EXECUTIVE.x}%`, top: `${EXECUTIVE.y}%` })}
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <ellipse className={`nc-ring${executiveBusy ? " nc-ring--live" : ""}`} cx="50" cy="50" rx="46" ry="13" />
          <ellipse className={`nc-ring${executiveBusy ? " nc-ring--live" : ""}`} cx="50" cy="50" rx="36" ry="21" />
          <ellipse className={`nc-ring${executiveBusy ? " nc-ring--live nc-ring--spin" : ""}`} cx="50" cy="50" rx="25" ry="29" />
        </svg>
      </div>

      <svg className="nc-org__links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {DEPARTMENTS.map((department) => {
          const node = visual.departments[department.id];
          const live = isWorkingStatus(node.status) || node.needsApproval === true;

          return (
            <line
              key={department.id}
              className={live ? "nc-link nc-link--live" : "nc-link"}
              x1={EXECUTIVE.x}
              y1={EXECUTIVE.y}
              x2={department.x}
              y2={department.y}
              style={cssVars({ "--nc-link-accent": `var(${department.accentVar})` })}
            />
          );
        })}

        {visual.handoffs.map((handoff) => {
          const from = nodeAnchor(handoff.from);
          const to = nodeAnchor(handoff.to);
          if (!from || !to) return null;
          return (
            <line
              key={handoff.id}
              className="nc-link nc-link--handoff"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
      </svg>

      {/* Energy travelling along the connection — the "data signal" of a handoff. */}
      {visual.handoffs.map((handoff) => {
        const from = nodeAnchor(handoff.from);
        const to = nodeAnchor(handoff.to);
        if (!from || !to) return null;
        return (
          <span
            key={handoff.id}
            className="nc-travel"
            style={cssVars({
              "--nc-from-x": `${from.x}%`,
              "--nc-from-y": `${from.y}%`,
              "--nc-to-x": `${to.x}%`,
              "--nc-to-y": `${to.y}%`,
            })}
          />
        );
      })}
    </>
  );
}
