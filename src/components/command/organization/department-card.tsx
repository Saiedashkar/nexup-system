"use client";

import type { Department, DepartmentId } from "../state/organization-model";
import { DEPARTMENT_ICONS, IconChevronRight } from "../ui/icons";
import { cssVars } from "../ui/css-vars";
import { STATUS_LABEL, workerLevel, type VisualNodeState } from "../state/visual-state";

/**
 * A department in the Living Organization: the card plus the lit platform it
 * stands on.
 *
 * Note what this component does NOT know: which department the demo happens to
 * be animating, what a "Growth" is, or where its data came from. It renders the
 * §11 prop contract — status · activityLevel · activeJob · needsApproval ·
 * handoffTarget — and nothing else. The identical component will render a real
 * agent, a mission or a second company without modification.
 *
 * One deliberate product decision: the identity line ("Leads · Sales · Market")
 * yields to the department's *current work* the moment it has any. That is how
 * "who is working on what" becomes readable straight off the ring, without
 * opening a single panel.
 */
type DepartmentCardProps = {
  department: Department;
  /** Visual state only. Business meaning never reaches this component. */
  visual: VisualNodeState;
  dimmed: boolean;
  onOpen: (id: DepartmentId) => void;
};

export function DepartmentCard({ department, visual, dimmed, onOpen }: DepartmentCardProps) {
  const { status, activityLevel, activeJob, needsApproval, workerActivity } = visual;
  const Icon = DEPARTMENT_ICONS[department.id];
  const crew = department.workers.slice(0, 3);
  const subtitle = activeJob ?? department.capability;

  return (
    <div
      className="nc-slot"
      data-status={status}
      data-dim={dimmed}
      style={cssVars({
        left: `${department.x}%`,
        top: `${department.y}%`,
        "--nc-accent": `var(${department.accentVar})`,
      })}
    >
      <span className="nc-platform" aria-hidden="true" />

      <button
        type="button"
        className="nc-dept-card"
        onClick={() => onOpen(department.id)}
        aria-label={`${department.name} — ${STATUS_LABEL[status]}${
          activeJob ? `. ${activeJob}` : ""
        }. Open department.`}
      >
        {needsApproval && <span className="nc-dept-card__badge">Needs you</span>}

        <span className="nc-dept-card__top">
          <span className="nc-dept-card__icon">
            <Icon size={17} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="nc-dept-card__name" style={{ display: "block" }}>
              {department.name}
            </span>
            <span className="nc-dept-card__capability" data-working={Boolean(activeJob)} style={{ display: "block" }}>
              {subtitle}
            </span>
          </span>
          <span className="nc-dept-card__chev">
            <IconChevronRight size={15} />
          </span>
        </span>

        <span className="nc-dept-card__bottom">
          <span className="nc-crew" aria-hidden="true">
            {crew.map((worker) => (
              <span
                key={worker.id}
                className="nc-crew__dot"
                data-level={workerLevel(workerActivity?.[worker.id] ?? 0)}
              />
            ))}
            <span className="nc-crew__more">+{department.crew}</span>
          </span>

          <span className="nc-dept-card__status">
            <span className="nc-dept-card__led" />
            {STATUS_LABEL[status]}
          </span>
        </span>

        <span className="nc-dept-card__meter" aria-hidden="true">
          <i style={{ width: `${Math.round(activityLevel * 100)}%` }} />
        </span>
      </button>
    </div>
  );
}
