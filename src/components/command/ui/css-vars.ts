import type { CSSProperties } from "react";

/**
 * Typed escape hatch for CSS custom properties.
 *
 * The whole Command visual layer is driven by custom properties
 * (`--nc-accent`, `--nc-status-color`, ...), which React's `CSSProperties`
 * type deliberately does not describe. This keeps those declarations in one
 * obvious place instead of scattering casts through components.
 */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as unknown as CSSProperties;
}
