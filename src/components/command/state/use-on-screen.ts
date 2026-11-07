"use client";

import { useEffect, useRef, useState } from "react";

/**
 * IS THIS ON SCREEN? — the pause the direction asks for
 * ────────────────────────────────────────────────────
 * The visual direction asks for in-interface motion (the orb turns, light
 * travels, panels arrive) AND for that motion to stop costing anything when
 * nobody can see it. Those two requirements only conflict if the animation is
 * always running, so this hook is the arbiter: it reports whether the element
 * it is attached to is in the viewport, and the caller writes the answer to a
 * `data-live` attribute that `violet.css` reads with
 * `animation-play-state: paused`.
 *
 * WHY AN ATTRIBUTE RATHER THAN A STYLE: the CSS keeps ownership of which layers
 * animate and which do not. JavaScript only says whether now is a good time, so
 * a rule can pause six animations in one place without the component knowing
 * anything about the orb's internals.
 *
 * IT STARTS AT `true`, DELIBERATELY. The server has no viewport to measure, so a
 * server render that claimed "off screen" and a first client pass that claimed
 * "on screen" would be a hydration mismatch on an attribute. Starting live
 * means the first paint matches the server exactly, and the observer corrects it
 * on the next frame if the answer is different.
 *
 * NO OBSERVER, NO PAUSE. Where `IntersectionObserver` is unavailable the hook
 * reports "on screen" forever, which is the pre-existing behaviour — the
 * fallback is the status quo, not a still room.
 */
export function useOnScreen<T extends HTMLElement = HTMLElement>(rootMargin = "160px") {
  const ref = useRef<T | null>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setOnScreen(entry.isIntersecting);
      },
      /* A margin, not a threshold: the room should be running again a moment
         before its first pixel returns, so a scroll never catches it mid-wake. */
      { rootMargin, threshold: 0 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, onScreen };
}
