"use client";

import { useCommand } from "../state/command-store";
import type { Department } from "../state/organization-model";
import { cssVars } from "../ui/css-vars";
import { IconArrowLeft } from "../ui/icons";
import { STATUS_LABEL, workerLevel, workerState, type VisualNodeState } from "../state/visual-state";

const WORKER_STATE_LABEL: Record<string, string> = {
  IDLE: "Idle",
  WORKING: "Working",
  ACTIVE: "Active",
  WAITING: "Waiting",
  APPROVAL_REQUIRED: "Needs approval",
};

/**
 * The destination of contextual zoom: one department, opened in place.
 *
 * It is deliberately a panel *inside* the organization stage rather than a new
 * route — moving into a department should feel like going deeper into the
 * organization, not like leaving it. "Back to Organization" reverses one step.
 */
export function DepartmentFocusPanel({
  department,
  visual,
  onBack,
}: {
  department: Department;
  visual: VisualNodeState;
  onBack: () => void;
}) {
  const { notify } = useCommand();

  return (
    <>
      <div className="nc-focus__scrim" aria-hidden="true" />
      <aside
        className="nc-focus"
        style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
        aria-label={`${department.name} detail`}
      >
        <header className="nc-focus__head">
          <div className="nc-focus__kicker">{department.short}</div>
          <h3 className="nc-focus__title">{department.name}</h3>
          <p className="nc-org__sub" style={{ marginTop: 5 }}>
            {department.brief}
          </p>
          <div className="nc-focus__kicker" style={{ marginTop: 10, color: "var(--nc-text-3)" }}>
            {STATUS_LABEL[visual.status]} · {Math.round(visual.activityLevel * 100)}% activity
          </div>
        </header>

        <div className="nc-focus__body">
          <div className="nc-context__label" style={{ marginBottom: 10 }}>
            Specialists · {department.workers.length}
          </div>

          <div className="nc-focus__grid">
            {department.workers.map((worker) => {
              const level = visual.workerActivity?.[worker.id] ?? 0;
              const state = workerState(level);
              return (
                <div key={worker.id} className="nc-worker" data-state={state} data-level={workerLevel(level)}>
                  <span className="nc-worker__avatar">{worker.name.slice(0, 2)}</span>
                  <span>
                    <span className="nc-worker__name">{worker.name}</span>
                    <span className="nc-org__sub" style={{ display: "block" }}>
                      {worker.role}
                    </span>
                  </span>
                  <span className="nc-worker__spacer" />
                  <span className="nc-worker__status">{WORKER_STATE_LABEL[state] ?? state}</span>
                </div>
              );
            })}
          </div>

          <div className="nc-context__label" style={{ margin: "18px 0 8px" }}>
            Current work
          </div>
          <p style={{ fontSize: 12.5, color: "var(--nc-text-2)" }}>
            {visual.activeJob ?? "No active work assigned to this department."}
          </p>
        </div>

        <footer className="nc-focus__foot">
          <button type="button" className="nc-btn nc-btn--lime" onClick={onBack}>
            <IconArrowLeft size={14} />
            Back to Organization
          </button>
          <button
            type="button"
            className="nc-btn nc-btn--sm"
            onClick={() => notify("The Work area (department jobs, runs, history) is a later phase.")}
          >
            Open in Work
          </button>
        </footer>
      </aside>
    </>
  );
}
