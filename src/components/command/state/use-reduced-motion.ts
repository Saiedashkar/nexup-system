"use client";

import { useEffect, useState } from "react";

/**
 * Reports the OS-level `prefers-reduced-motion` setting.
 *
 * The CSS already honours the media query (see command.css), so nothing here is
 * load-bearing for correctness — this only lets the UI *tell the truth* about
 * which motion mode is active, and lets the dev Motion Lab surface it.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return reduced;
}
