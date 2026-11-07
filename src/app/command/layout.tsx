import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { CommandShell } from "@/components/command/command-shell";
import { CommandLocaleProvider } from "@/components/command/i18n/command-locale";
import { LOCALE_COOKIE, localeFromCookie } from "@/components/command/i18n/locale";
import { CommandProvider } from "@/components/command/state/command-store";
import { CommandDataProvider } from "@/components/command/state/demo/command-data-store";
import "./command.css";
/* Phase UI-02.1 adds one layer, in one place: the spatial scene (depth, the
   Intelligence Core, department pods, actor presence, the adaptive rail and
   deck). It only *adds* — it redefines no token and overrides no shell rule. */
import "./spatial.css";
/* Phase UI-03 adds one more additive layer: the Department Workspace. Like the
   two above it, it redefines no token and overrides no shell rule. */
import "./workspace.css";
/* Phase UI-04 adds the Actor Workspace layer. Same rule again: it redefines no
   token and overrides no shell rule. */
import "./actor.css";
/* Phase UI-05 adds the SYSTEM layer, imported LAST on purpose: the shared design
   language (glass hierarchy + the connection-network vocabulary) and the mobile
   shell. It redefines no token and overrides no shell rule. */
import "./system.css";
/* Phase UI-05 also adds EXEC's own layer. Same rule again. */
import "./exec.css";
/* Visual-direction correction: retunes the palette (graphite/blue glass,
   restrained lime) and adds the command-center chrome. Imported LAST on
   purpose — it is the one layer allowed to retune tokens, because the palette
   itself was the drift. Visuals only; no runtime or domain code. */
import "./reference.css";
/* The COMMAND PRODUCT LAB layer: the operating surfaces (command center, mission
   control, workforce, decisions, projects, clients, finance, systems, models,
   activity and the executive conversation). Same rule as every layer before it —
   additive, `nl-`-prefixed, redefining no token — imported LAST so it layers on
   top of the approved visual direction rather than competing with it. */
import "./lab.css";
/* Pass 2 adds the locale layer: the ONE place that carries the RTL corrections
   for the shell, the product surfaces and the phone bar. It is additive and
   scoped to `.nc-root[dir="rtl"]`, so it cannot affect the LTR product or the
   legacy Arabic application. It is imported LAST because it is a correction on
   top of every composition above it. */
import "./locale.css";
/* Pass 3 corrects the COMPOSITION: the compact heading, the single action row,
   the three figures, the two priority panels, the balanced department cards, the
   optional organization map, the operating-detail disclosure and the phone shell
   with its sheet. It is imported LAST because it retunes chrome that earlier
   layers already style (the command-center band in `reference.css`, the cards
   and the phone bar in `locale.css`) — still additive: it redefines no token and
   overrides no page's own reading. */
import "./operate.css";
/* THE FOUNDATION — the reusable visual system for EVERY Product-owned Command
   surface: tokens (warm charcoal, smoked glass, champagne edges, ivory text,
   one mint action, blue reserved for EXEC's identity) plus the primitives the
   product composes from (surfaces, buttons, inputs, navigation states, badges,
   cards, sheets, type, space, motion). Imported LAST because it re-points the
   palette every layer beneath it already speaks in, so one edit restyles all of
   them instead of one page at a time.

   It REPLACES the earlier violet slice (`violet.css`), which is deleted rather
   than layered over: two palettes stacked is how a design system rots. */
import "./foundation.css";
/* THE HOME COMPOSITION — the owner-approved company overview: the orbit, the
   EXEC seat, the two summaries and the operating-detail disclosure. Additive to
   the foundation and scoped to the home surface, so it changes no other page. */
import "./orbit.css";
/* THE APPROVED HOME COMPOSITION — greeting header, six-plate orbit order, one
   summary strip, the EXEC composer and the phone's own two-column reading.
   Scoped to `data-surface="home"`, imported LAST so it is the final word on the
   home chrome only; no department page or Agent Studio surface reads it. */
import "./home.css";
/* MISSION CONTROL'S GLASS — the one page that drinks the approved material
   further: dark champagne-glass figures and filters, a deliberately darker
   mission table, and three slow parallax layers behind the whole page. Scoped
   to `.nlm-stage`, which only `/command/missions` renders, and imported LAST
   because it is the final word on THAT page and on nothing else. */
import "./missions-glass.css";
/* MARKETING & SALES — the gateway (`/command/sales`) and the sales room
   (`/command/sales/room`): two smoked-glass doors, an isometric stage of three
   clickable stations, the decisions card, the team strip and the five-step demo
   journey. Same rule again — additive, `nxs-`-prefixed, redefining no token, and
   imported LAST because it is the final word on those two routes and nothing
   else. */
import "./sales.css";

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
 *     COMMAND re-declares `dir`/`lang` on its OWN root element from the locale
 *     store (`i18n/`), so the two coexist and switching COMMAND to Arabic never
 *     flips the legacy application underneath the same session.
 *
 * There is no data fetching, no provider SDK, no job runner and no database
 * access anywhere under this route in Phase UI-01.
 */
export const metadata: Metadata = {
  title: "NEXUP COMMAND",
  description: "Central operating environment for NEXUP — Phase UI-01 visual foundation.",
};

/**
 * VIEWPORT — safe areas, and the browser chrome in the product's own colour
 * ─────────────────────────────────────────────────────────────────────────
 * Two things this fixes, both of them about the phone:
 *
 *   · `viewportFit: "cover"` is what MAKES `env(safe-area-inset-*)` resolve to
 *     anything other than zero. Without it every safe-area rule in this product
 *     (the bottom bar, the sheets, the scroll padding) is decorative: the page
 *     simply stops at the browser's own safe boundary on a notched phone. With
 *     it, the composition owns the whole screen and insets the parts that must
 *     stay clear of the home indicator.
 *   · `themeColor` matches the foundation's own base rather than the legacy
 *     app's blue-slate, so the browser chrome above the sheet is the same
 *     charcoal as the sheet. It is declared HERE, on the Command layout, and
 *     therefore applies to `/command/**` only — the legacy application keeps its
 *     own value in `src/app/layout.tsx`, untouched.
 *   · `interactiveWidget: "resizes-content"` is what makes the PHONE keyboard
 *     shrink the shell instead of covering the bottom bar. Without it the layout
 *     viewport keeps its full height while the keyboard covers the lower third,
 *     and the four-cell navigation bar is simply not there while the reader
 *     types. It is a hint, not a guarantee — Safari ignores it — which is why
 *     `state/use-keyboard-inset.ts` measures the visual viewport as well and
 *     moves the same chrome by the same amount. Both mechanisms agree on the
 *     result, and neither changes anything when no keyboard is open.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0d0e0d",
  interactiveWidget: "resizes-content",
};

export default async function CommandLayout({ children }: { children: React.ReactNode }) {
  /* THE LANGUAGE IS DECIDED HERE, ON THE SERVER, BEFORE ANYTHING PAINTS.
     ─────────────────────────────────────────────────────────────────────────
     The preference is a cookie, so it arrives with the request. Reading it in
     the layout and passing it to the provider means the HTML for an Arabic
     reader is Arabic and RTL in its first byte — not English that flips once
     hydration runs. That is the whole reason this layout is `async`.

     It also makes `/command/**` dynamically rendered. That is the correct trade
     here: a control room whose first paint depends on a per-reader preference
     cannot be a static document. Nothing else about the route changes — no
     auth, no database and no provider call is added by this line.

     An absent or unreadable cookie resolves to `DEFAULT_LOCALE` (English), which
     is the honest first-visit default rather than a guess at the reader's
     language. */
  const cookieStore = await cookies();
  const initialLocale = localeFromCookie(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    /* The locale provider is OUTERMOST and owns nothing but the language. It is
       deliberately not nested inside the state stores: a language switch must
       not be able to reach the route, the focus, or the demo read state, and
       this ordering is what makes that structural. */
    <CommandLocaleProvider initialLocale={initialLocale}>
      <CommandProvider>
        {/* The Product Lab's read store sits INSIDE the shell store so a local
            mutation can reuse the shell's single toast surface. It reads through
            a typed demo adapter — no network, no provider, no database. */}
        <CommandDataProvider>
          <CommandShell>{children}</CommandShell>
        </CommandDataProvider>
      </CommandProvider>
    </CommandLocaleProvider>
  );
}

// ── Dev-mode hygiene ───────────────────────────────────────────────────────
// The Next.js DevTools instrumentation that ships in this repo's app/layout.tsx
// (a <script dangerouslySetInnerHTML> that opens the DevTools overlay) is NOT
// included beneath /command: CommandShell owns its own <html lang>/<head/> block
// for this route, and adding that script here would surface an in-page overlay
// that blocks screenshot capture in review.
//
