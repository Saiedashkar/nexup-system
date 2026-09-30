"use client";

import { useCommand } from "./state/command-store";
import { GlobalNav } from "./global-nav";
import { GlobalCommandBar } from "./global-command-bar";
import { CommandDock } from "./command-dock";
import { ExecutiveSurface } from "./executive-dock";
import { RightContext } from "./right-context";
import { MotionDemoController } from "./motion-demo-controller";
import { cssVars } from "./ui/css-vars";

/**
 * The Command shell.
 *
 * Owns the single `.nc-root` surface — the element every token and motion
 * primitive is scoped to — so this whole environment is one isolated island
 * inside the legacy NEXUP app. It is also the only place that decides:
 *   · LTR direction (COMMAND is an English-first operating surface while the
 *     legacy system stays RTL — neither affects the other);
 *   · the motion mode and speed multiplier used by the dev Motion Lab.
 *
 * Composition: a tiny permanent global nav · a pinned command bar over a
 * dominant centre column · a narrow collapsible context column whose top band
 * aligns with the command bar · and one integrated dock holding the Executive
 * orb and the contextual actions.
 *
 * The command bar is SHELL chrome, not page content: it stays put while the
 * page scrolls under it. The Executive console rises inside the centre stage,
 * above the dock, so opening it never covers the control that opened it.
 */
export function CommandShell({ children }: { children: React.ReactNode }) {
  const { rightCollapsed, motionMode, speed, toast, execOpen, snapshot } = useCommand();

  return (
    <div
      className="nc-root"
      dir="ltr"
      lang="en"
      data-motion={motionMode}
      style={cssVars({ "--nc-speed": speed })}
    >
      <div className="nc-ambient" aria-hidden="true">
        <span className="nc-ambient__window" />
        <span className="nc-ambient__floor" />
        <span className="nc-ambient__grid" />
        <span className="nc-ambient__bokeh">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="nc-shell" data-right={rightCollapsed ? "collapsed" : "expanded"}>
        <GlobalNav />

        <main className="nc-main">
          <div className="nc-topbar">
            <GlobalCommandBar />
          </div>

          <div className="nc-main__stage">
            <div className="nc-main__scroll">{children}</div>

            {/* Keyed by scenario+revision: a new demo state starts a clean
                console, and its opening line is initialised lazily rather than
                pushed in from an effect. */}
            {execOpen && <ExecutiveSurface key={`${snapshot.scenario}:${snapshot.revision}`} />}
          </div>

          <div className="nc-rail-bottom">
            <CommandDock />
          </div>
        </main>

        <RightContext />
      </div>

      {/* The condition is the build-time-inlined `process.env.NODE_ENV` check,
          not a runtime flag: in a production bundle this folds to `false`, the
          JSX is dropped and the Motion Lab module with it. It is a review
          instrument, never a shipped control. */}
      {process.env.NODE_ENV !== "production" && <MotionDemoController />}

      {toast && (
        <div className="nc-toast" role="status">
          {toast} <span>· mocked, nothing executed</span>
        </div>
      )}
    </div>
  );
}
