"use client";

import { useState } from "react";
import { IS_DEV, useCommand } from "./state/command-store";
import { DEMO_SCENARIOS, type DemoScenarioId } from "./state/demo-scenarios";

/**
 * MOTION DEMO CONTROLLER — dev only.
 *
 * This is the review instrument for the Living Organization: it drives the
 * visual state contract directly so every state can be inspected without a
 * backend, an AI provider or a running job. It is gated behind `IS_DEV`
 * (inlined at build time), so it does not exist in a production bundle and can
 * never be a production-facing control.
 *
 * It also exposes the two things you can't review by clicking alone:
 * slow-motion (so a 140ms micro-interaction is actually inspectable) and a
 * reduced-motion override.
 */
export function MotionDemoController() {
  const {
    scenario,
    revision,
    selectScenario,
    replay,
    speed,
    setSpeed,
    motionMode,
    setMotionMode,
    autoCycle,
    setAutoCycle,
    osReducedMotion,
    snapshot,
  } = useCommand();

  /* Collapsed by default: the lab is a review instrument, not part of the
     composition, and an open panel sits over the lower-left department. */
  const [open, setOpen] = useState(false);

  if (!IS_DEV) return null;

  return (
    <div className="nc-lab" data-open={open}>
      <button
        type="button"
        className="nc-lab__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle motion demo controller"
      >
        <span className="nc-lab__dot" />
        <span className="nc-lab__title">Motion lab · dev only</span>
        <span style={{ flex: 1 }} />
        <span className="nc-lab__note" style={{ margin: 0 }}>
          {open ? "—" : "+"}
        </span>
      </button>

      {open && (
        <div className="nc-lab__body">
          <div className="nc-lab__group">
            <div className="nc-lab__group-label">Runtime state</div>
            <div className="nc-lab__grid">
              {DEMO_SCENARIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="nc-lab__btn"
                  data-active={scenario === item.id}
                  onClick={() => selectScenario(item.id as DemoScenarioId)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" className="nc-lab__btn" style={{ width: "100%", marginTop: 5, textAlign: "center" }} onClick={replay}>
              Replay animation ({revision})
            </button>
          </div>

          <div className="nc-lab__group">
            <div className="nc-lab__group-label">Motion</div>
            <label className="nc-lab__toggle">
              <input
                type="checkbox"
                checked={speed > 1}
                onChange={(event) => setSpeed(event.target.checked ? 3 : 1)}
              />
              Slow motion (3×)
            </label>
            <label className="nc-lab__toggle" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={motionMode === "reduced"}
                onChange={(event) => setMotionMode(event.target.checked ? "reduced" : "full")}
              />
              Simulate reduced motion
            </label>
            <label className="nc-lab__toggle" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={autoCycle} onChange={(event) => setAutoCycle(event.target.checked)} />
              Auto-cycle scenarios
            </label>
            {osReducedMotion && (
              <div className="nc-lab__note">Your OS is reporting prefers-reduced-motion: reduce.</div>
            )}
          </div>

          <div className="nc-lab__note">
            {snapshot.narrative}
            <br />
            <span style={{ color: "var(--nc-text-3)" }}>
              Not shipped: this panel is compiled out of production builds.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
