import type { Metadata } from "next";
import { CommandShell } from "@/components/command/command-shell";
import { CommandProvider } from "@/components/command/state/command-store";
import "./command.css";
/* Phase UI-02.1 adds one layer, in one place: the spatial scene (depth, the
   Intelligence Core, department pods, actor presence, the adaptive rail and
   deck). It only *adds* — it redefines no token and overrides no shell rule. */
import "./spatial.css";

/**
 * NEXUP COMMAND — route layout (Phase UI-01)
 * ───────────────────────────────────────────
 * ROUTE: `/command`
 *
 * Why this route:
 *   · It is a brand-new top-level segment, so it cannot collide with anything
 *     that already exists (`/office/**`, `/clients`, `/finance`, `/dashboard`).
 *   · It does NOT touch `/` (the existing homepage still redirects users to
 *     `/office` exactly as before) and it does NOT touch `/office/ai-workforce`
 *     (the Phase 1B module page keeps its own URL and behaviour).
 *   · It needs NO middleware change: `src/middleware.ts` already protects every
 *     non-static route with a session check, and `/command` is not in any
 *     business- or finance-restricted prefix list, so any authenticated user
 *     reaches it — the same rule as `/office` itself.
 *
 * Isolation:
 *   · The only imported stylesheet is `./command.css`, whose every rule is
 *     scoped under `.nc-root`. Legacy `globals.css` tokens are neither read nor
 *     written, and Tailwind is not involved (this repo has no Tailwind build).
 *   · The `<html>` element stays `lang="ar" dir="rtl"` for the legacy app;
 *     COMMAND re-declares `dir="ltr"` on its own root element, so the two
 *     coexist without either one changing the other.
 *
 * There is no data fetching, no provider SDK, no job runner and no database
 * access anywhere under this route in Phase UI-01.
 */
export const metadata: Metadata = {
  title: "NEXUP COMMAND",
  description: "Central operating environment for NEXUP — Phase UI-01 visual foundation.",
};

export default function CommandLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandProvider>
      <CommandShell>{children}</CommandShell>
    </CommandProvider>
  );
}

// ── Dev-mode hygiene ───────────────────────────────────────────────────────
// The Next.js DevTools instrumentation that ships in this repo's app/layout.tsx
// (a <script dangerouslySetInnerHTML> that opens the DevTools overlay) is NOT
// included beneath /command: CommandShell owns its own <html lang>/<head/> block
// for this route, and adding that script here would surface an in-page overlay
// that blocks screenshot capture in review.
//
