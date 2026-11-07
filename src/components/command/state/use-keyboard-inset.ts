"use client";

import { useEffect, type RefObject } from "react";

/**
 * THE SOFTWARE KEYBOARD, MEASURED
 * ───────────────────────────────
 * The phone composition has two pieces of shell chrome at the bottom edge — the
 * four-cell navigation bar and the toast lane above it — and both of them have to
 * stay reachable while the reader is typing in the composer. That is not a
 * styling preference: a bar that has slid behind the keyboard is a bar the reader
 * cannot use, and "usable with the keyboard open" is a requirement of this pass.
 *
 * WHY THIS EXISTS AT ALL, WHEN THE SHELL IS ALREADY `dvh`
 * `100dvh` follows browser chrome (URL bar, tab bar). It does NOT follow the
 * software keyboard: on both Android Chrome and iOS Safari the keyboard shrinks
 * the VISUAL viewport while the layout viewport keeps its height, so a
 * `position: fixed; bottom: 0` element ends up under the keyboard. The layout
 * viewport is therefore still the right thing to size the shell with, and the
 * keyboard is a separate quantity that has to be read from
 * `window.visualViewport` and applied to the bottom-anchored chrome.
 *
 * The meta viewport on this route asks for `interactive-widget=resizes-content`
 * (see `src/app/command/layout.tsx`), which makes Android resize the layout
 * viewport instead — and then this hook measures an inset of zero and changes
 * nothing. So the two mechanisms are complementary rather than duplicated: the
 * meta tag is the fast path, and this is the fallback for browsers that ignore
 * it. Nothing here writes to the DOM during render or during hydration, so it
 * cannot cause a server/client mismatch; it runs after mount and only ever sets
 * one custom property.
 */

/**
 * The inset, in pixels, between the bottom of the LAYOUT viewport and the bottom
 * of the VISUAL one — i.e. how much of the shell the keyboard is covering.
 *
 * Pure and exported so the arithmetic can be tested without a browser: the
 * clamping is the part that is easy to get wrong. `offsetTop` is included because
 * a page zoomed or scrolled in the visual viewport reports a smaller height AND a
 * non-zero offset, and counting the height alone would under-report by that
 * offset.
 */
export function keyboardInset(
  layoutHeight: number,
  visualHeight: number,
  offsetTop = 0,
): number {
  /* Both inputs are clamped before they are used: `offsetTop` cannot be
     negative in any browser state, and reading a negative one as "the visual
     viewport starts above the page" would ADD height that no keyboard occupies.
     Garbage in, zero out — never a bar moved to a place nothing asked for. */
  const offset = Number.isFinite(offsetTop) ? Math.max(0, offsetTop) : 0;
  const covered = layoutHeight - visualHeight - offset;
  /* A keyboard is never a negative quantity, and a pinch-zoom or a rounding
     error must not be able to push the bar off the top of the screen. */
  if (!Number.isFinite(covered) || covered < 0) return 0;
  return Math.round(covered);
}

/**
 * Writes the inset to `--nc-kb` on the shell's root element.
 *
 * `visualViewport` is absent in older browsers and in some embedded webviews; in
 * that case the property stays at its declared `0px` and the composition is
 * exactly what it is today — the bottom chrome sits at the layout viewport's
 * bottom, which is correct until a keyboard exists that can cover it.
 */
export function useKeyboardInset(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const node = root.current;
    if (!viewport || !node) return;

    const apply = () => {
      node.style.setProperty(
        "--nc-kb",
        `${keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop)}px`,
      );
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      node.style.removeProperty("--nc-kb");
    };
  }, [root]);
}
