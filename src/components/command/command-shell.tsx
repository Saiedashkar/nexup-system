"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { useCommand } from "./state/command-store";
import { useKeyboardInset } from "./state/use-keyboard-inset";
import { useLocale } from "./i18n/command-locale";
import { GlobalNav } from "./global-nav";
import { GlobalCommandBar } from "./global-command-bar";
import { ExecutiveSurface } from "./executive-dock";
import { ContextRail } from "./context-rail";
import { MotionDemoController } from "./motion-demo-controller";
import { MobileNav } from "./mobile-nav";
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
 * dominant centre column · and a narrow, COLLAPSED-BY-DEFAULT context column
 * whose top band aligns with the command bar.
 *
 * PASS 3 REMOVES THE FIXED BOTTOM BAR. It used to be shell chrome pinned under
 * every route — five or six cells of controls that covered the bottom of the
 * content and repeated actions the page (and the rail) already offered. Those
 * actions now live in the page they belong to (`command-actions.tsx` renders one
 * primary action and the contextual secondaries inside the home's own flow), so
 * every screen's height belongs to its content and NO FIXED ELEMENT COVERS ANY
 * OF IT. The stage simply took the freed row.
 *
 * The command bar is SHELL chrome, not page content: it stays put while the
 * page scrolls under it. The Executive console rises inside the centre stage,
 * above the content, so opening it never covers the control that opened it.
 */
export function CommandShell({ children }: { children: React.ReactNode }) {
  const { rightCollapsed, motionMode, speed, toast, execOpen, snapshot, focus } = useCommand();
  /* Direction and language live on THIS element and nowhere else. The legacy
     application's `<html lang="ar" dir="rtl">` is never touched. */
  const { dir, locale, t } = useLocale();
  /* WHICH SURFACE IS THIS? The FOUNDATION (`foundation.css`) applies to every
     Product surface — that is what makes it a foundation. The home
     COMPOSITION (`orbit.css`) does not: the orbit belongs to one screen, and
     putting it everywhere would be the "orbital diagram on every page" the
     direction forbids. So the shell names the surface here, as a fact of the
     route rather than an accident of specificity, and `orbit.css` scopes itself
     to it. `/command` is the home and nothing else: every child route is
     deeper, so a prefix test is not needed and a comparison is exact. */
  const pathname = usePathname();
  const surface = pathname === "/command" ? "home" : undefined;

  /* The software keyboard, as one custom property (`--nc-kb`). The shell is
     sized in `dvh`, which follows browser chrome but NOT the keyboard, so the
     bottom-anchored chrome (the phone bar, the toast lane, the sheet) reads
     this inset. On desktop, and on any browser where the visual viewport does
     not change, the value stays `0px` and nothing moves. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useKeyboardInset(rootRef);

  return (
    <div
      ref={rootRef}
      className="nc-root"
      dir={dir}
      lang={locale}
      data-motion={motionMode}
      data-surface={surface}
      data-focus={focus ? "true" : undefined}
      style={cssVars({ "--nc-speed": speed })}
    >
      {/* Environment, not scene: the shell supplies light (a warm window and
          four static blurred lights). The floor and horizon belong to the
          spatial scene itself, so they moved in Phase UI-02.1. */}
      <div className="nc-ambient" aria-hidden="true">
        <span className="nc-ambient__window" />
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

        </main>

        <ContextRail />
      </div>

      {/* Two gates, and both have to open. The condition here is the
          build-time-inlined `process.env.NODE_ENV` check, not a runtime flag: in a
          production bundle this folds to `false`, the JSX is dropped and the
          Motion Lab module with it. The second gate is inside the module, which
          renders nothing unless the review URL asked for it (`?motion-lab=1`) —
          because the product is REVIEWED on a dev server, so compiling the panel
          out of production never removed it from the build anyone looks at. It is
          a review instrument: never shipped, and no longer ambient. */}
      {process.env.NODE_ENV !== "production" && <MotionDemoController />}

      {/* Mobile-only navigation. Inert on desktop: system.css only displays it
          below 760px, where the rail and context column stand down. */}
      <MobileNav />

      {toast && (
        <div className="nc-toast" role="status">
          {toast} <span>· {t("shell.toastNote")}</span>
        </div>
      )}
    </div>
  );
}
