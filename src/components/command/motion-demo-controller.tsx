"use client";

import { useState, useSyncExternalStore } from "react";
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
 *
 * WHY IT NO LONGER SHOWS UP ON ITS OWN
 * `IS_DEV` is not enough on its own, because the product is REVIEWED on a dev
 * server: an orange panel parked in the lower right of every screen is chrome the
 * direction never approved, and it was reported as overlapping the product (the
 * floating EXEC tab, and the lower department at narrow widths). Compiling it out
 * of production did not remove it from the only build anyone looks at.
 *
 * So it is now REQUESTED, never ambient. It renders only when the review URL asks
 * for it (`?motion-lab=1`), and the request is remembered for the session so
 * internal navigation — which drops query strings — cannot make it disappear
 * mid-review. "Hide" removes the request from the URL and from the session, so
 * from then on the product is left alone. Nothing about the instrument's
 * behaviour changed; only who sees it.
 *
 * WHY THIS IS A STORE AND NOT AN EFFECT. Whether the lab is wanted lives in the
 * URL and in session storage — OUTSIDE React — so it is read as external state
 * with `useSyncExternalStore`: the server is told `false`, the client gets its
 * real answer, and hydration stays in step without an effect that sets state on
 * mount (which is what the previous version did, and which React's own lint rule
 * flags as a cascading render).
 */

/* The opt-in's three keys. The query string is the entry point (a URL can be
   pasted); the session flag is what survives client-side navigation; the event is
   how "Hide" tells the store to re-read. */
const LAB_QUERY_KEY = "motion-lab";
const LAB_SESSION_KEY = "nc.motion-lab";
const LAB_EVENT = "nc:motion-lab";

/**
 * Has the review asked for the lab? A PURE read of the two places that can ask.
 * The URL wins, so pasting `?motion-lab=1` again always re-opens it in the same
 * tab; "Hide" strips that parameter, which is what makes the opt-out stick.
 */
function labRequested(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get(LAB_QUERY_KEY) === "1") return true;
    return window.sessionStorage.getItem(LAB_SESSION_KEY) === "on";
  } catch {
    /* Private modes can throw on storage access; a review instrument is never
       worth breaking a page for. */
    return false;
  }
}

function subscribeLabRequest(onChange: () => void): () => void {
  /* The AUTHENTICATED review is a client-side app: the next internal navigation
     drops the query string, so a request that arrives in the URL is recorded for
     the session the moment it is first honoured. */
  try {
    if (labRequested()) window.sessionStorage.setItem(LAB_SESSION_KEY, "on");
  } catch {
    /* see labRequested */
  }
  window.addEventListener(LAB_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LAB_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The lab never renders on the server, so the server's answer is always no. */
function labRequestedOnServer(): boolean {
  return false;
}
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

  const requested = useSyncExternalStore(subscribeLabRequest, labRequested, labRequestedOnServer);

  /* "Hide" is a real opt-out, not a collapse: the parameter leaves the URL and
     the session stops remembering it, so the next reload — and every internal
     navigation after this one — leaves the product alone. */
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(LAB_SESSION_KEY, "off");
      const url = new URL(window.location.href);
      url.searchParams.delete(LAB_QUERY_KEY);
      window.history.replaceState(null, "", url);
    } catch {
      /* see labRequested */
    }
    setOpen(false);
    window.dispatchEvent(new Event(LAB_EVENT));
  };

  if (!IS_DEV || !requested) return null;

  return (
    <div className="nc-lab" data-open={open}>
      <div className="nc-lab__bar">
        <button
          type="button"
          className="nc-lab__head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="nc-lab__dot" />
          <span className="nc-lab__title">Motion lab · dev only</span>
          <span className="nc-lab__sign" aria-hidden="true">
            {open ? "—" : "+"}
          </span>
        </button>
        <button
          type="button"
          className="nc-lab__hide"
          onClick={dismiss}
          aria-label="Hide the motion lab for this session"
        >
          ×
        </button>
      </div>

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
              Not shipped: this panel is compiled out of production builds, and it is not shown in
              normal review either — append ?{LAB_QUERY_KEY}=1 to the review URL to open it.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
