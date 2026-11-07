"use client";

import Link from "next/link";
import { useLocale } from "../i18n/command-locale";
import { AreaNav } from "../lab/kit";
import { IconArrowLeft, IconChevronRight, IconDeptGrowth, IconSystems, IconWorkforce } from "../ui/icons";
import { JOURNEY_ORDER } from "./journey";
import { useSalesCopy } from "./use-sales-copy";
import type { RoleId } from "./copy";

/**
 * MARKETING & SALES GATEWAY — two glass doors over the home's own stage
 * ──────────────────────────────────────────────────────────────────────
 * ROUTE: `/command/sales` (the home's Marketing & Sales plate points here)
 *
 * WHAT THIS IS. One picture, the way the reference composes it: the same planet,
 * the same calm orbit, and TWO transparent glass doors standing on it, the light
 * of the background passing through them. Under each door sits ONE summary of
 * that department and nothing else. So this file draws:
 *
 *   1. the stage — planet, orbit rings, horizon haze. Pure decoration, all of it
 *      `aria-hidden`, none of it focusable;
 *   2. the two doors — real links, each a pane of smoked glass with an edge
 *      highlight, a glass icon, the room's name, one sentence, and a pill that
 *      says "ادخل القسم";
 *   3. under each door, that department's summary ONLY: two facts about the room
 *      and the line of roles that runs it. The sales figures are derived from the
 *      room's own configuration (`JOURNEY_ORDER`, the station list, the role
 *      list), never invented business numbers;
 *   4. one hero footline, and one quiet footer row that also carries the
 *      pre-existing department-workspace link, so nothing the plate used to reach
 *      became unreachable when it started opening this gateway.
 *
 * WHAT MOVED OUT, AND WHY. The stations card, the team card and the five-step
 * journey map used to sit here. They are the SALES ROOM's instruments, and the
 * room already draws every one of them itself — the stage stations, the team
 * strip and the journey rail with its step panel. Two copies meant two places to
 * read the same five steps and two places they could disagree, so they live in
 * the room, once, and the gateway keeps only the choice and the summary.
 *
 * The marketing room arrived from the product tree (`/command/marketing`, its own
 * model and stylesheet), so the second door links to it. Nothing here fetches,
 * writes or calls a provider, and both hrefs resolve to routes in this tree.
 */
export function SalesGateway() {
  const copy = useSalesCopy();
  const { t } = useLocale();

  /* The summary reads the room's OWN configuration: a journey that grew or shrank
     moves the figure under the door with it, so the door can never advertise a
     path the room does not run. */
  const salesFacts = [
    { label: copy.gateway.summary.stations, value: String(Object.keys(copy.stations).length) },
    { label: copy.gateway.summary.steps, value: String(JOURNEY_ORDER.length) },
  ];
  const marketingFacts = [
    { label: copy.gateway.summary.stations, value: "3" },
    { label: copy.gateway.summary.roles, value: "4" },
  ];
  const salesTeam = (Object.keys(copy.roles) as RoleId[]).map((role) => copy.roles[role]).join(" · ");

  return (
    <div className="nxs-page">
      <AreaNav />

      <header className="nxs-head">
        <div className="nxs-head__lead">
          <span className="nxs-head__mark" aria-hidden="true">
            <IconDeptGrowth size={18} />
          </span>
          <div className="nxs-head__copy">
            <span className="nxs-head__kicker">{copy.kicker}</span>
            <h1 className="nxs-head__title">{copy.gateway.title}</h1>
            <p className="nxs-head__blurb">{copy.gateway.blurb}</p>
          </div>
        </div>

        <div className="nxs-head__side">
          <span className="nxs-badge" data-tone="demo">
            <i aria-hidden="true" />
            {copy.badge}
          </span>
          <Link className="nxs-back" href="/command">
            <IconArrowLeft size={13} />
            {copy.gateway.homeCta}
          </Link>
        </div>
      </header>

      {/* ── THE STAGE: the home's planet and orbit, with the two doors on it ── */}
      <section className="nxs-hero" aria-label={copy.gateway.doorsTitle}>
        <span className="nxs-hero__sky" aria-hidden="true" />
        <span className="nxs-hero__limb" aria-hidden="true" />
        <span className="nxs-hero__ring" data-ring="outer" aria-hidden="true" />
        <span className="nxs-hero__ring" data-ring="mid" aria-hidden="true" />
        <span className="nxs-hero__ring" data-ring="inner" aria-hidden="true" />
        <span className="nxs-hero__horizon" aria-hidden="true" />

        <div className="nxs-hero__doors">
          {/* SALES ─────────────────────────────────────────────────────── */}
          <div className="nxs-hero__col" data-dept="sales" data-tint="mint">
            <Link className="nxs-door" href="/command/sales/room">
              <span className="nxs-door__glow" aria-hidden="true" />
              <span className="nxs-door__mark" aria-hidden="true">
                <GateMarkSales />
              </span>
              <span className="nxs-door__title">{copy.gateway.room.title}</span>
              <span className="nxs-door__body">{copy.gateway.room.body}</span>
              <span className="nxs-door__cta">
                {copy.gateway.room.cta}
                <IconChevronRight size={13} />
              </span>
            </Link>

            {/* Under the door: this department's summary ONLY. */}
            <div
              className="nxs-sum"
              aria-label={`${copy.gateway.room.title} — ${copy.gateway.summaryLabel}`}
            >
              <ul className="nxs-sum__facts">
                {salesFacts.map((fact) => (
                  <li key={fact.label} className="nxs-sum__fact">
                    <span className="nxs-sum__value">{fact.value}</span>
                    <span className="nxs-sum__label">{fact.label}</span>
                  </li>
                ))}
              </ul>
              <p className="nxs-sum__team">
                <span className="nxs-sum__team-mark" aria-hidden="true">
                  <IconWorkforce size={14} />
                </span>
                {copy.gateway.summary.team} · {salesTeam}
              </p>
            </div>
          </div>

          {/* MARKETING ─────────────────────────────────────────────────── */}
          <div className="nxs-hero__col" data-dept="marketing" data-tint="champagne">
            <Link className="nxs-door" href="/command/marketing">
              <span className="nxs-door__glow" aria-hidden="true" />
              <span className="nxs-door__mark" aria-hidden="true">
                <GateMarkMarketing />
              </span>
              <span className="nxs-door__title">{copy.gateway.marketing.title}</span>
              <span className="nxs-door__body">{copy.gateway.marketing.body}</span>
              <span className="nxs-door__cta">
                {copy.gateway.marketing.cta}
                <IconChevronRight size={13} />
              </span>
            </Link>

            <div
              className="nxs-sum"
              aria-label={`${copy.gateway.marketing.title} — ${copy.gateway.summaryLabel}`}
            >
              <ul className="nxs-sum__facts">
                {marketingFacts.map((fact) => (
                  <li key={fact.label} className="nxs-sum__fact">
                    <span className="nxs-sum__value">{fact.value}</span>
                    <span className="nxs-sum__label">{fact.label}</span>
                  </li>
                ))}
              </ul>
              <p className="nxs-sum__team">
                <span className="nxs-sum__team-mark" aria-hidden="true">
                  <IconWorkforce size={14} />
                </span>
                {copy.gateway.summary.team} · {copy.gateway.marketing.team}
              </p>
            </div>
          </div>
        </div>

        <p className="nxs-hero__foot">
          <span className="nxs-hero__line" aria-hidden="true" />
          {copy.gateway.footLine}
          <span className="nxs-hero__pill">{copy.gateway.footPill}</span>
          <span className="nxs-hero__line" aria-hidden="true" />
        </p>
      </section>

      {/* One quiet row: the pre-existing workspace and the systems reference.
          Both are real routes today; neither is a second dashboard. */}
      <section className="nxs-footer">
        <Link className="nxs-btn" data-variant="quiet" href="/command/departments/growth-revenue">
          {copy.gateway.department.cta}
          <IconChevronRight size={12} />
        </Link>
        <Link className="nxs-btn" data-variant="quiet" href="/command/systems">
          <IconSystems size={13} />
          {copy.gateway.refCta}
        </Link>
        <span className="nxs-footer__note">{copy.common.notTransferable}</span>
      </section>

      <p className="nxs-foot">
        {copy.common.demoOnly} <span>·</span> {t("provenance.demoState")}
      </p>
    </div>
  );
}

/**
 * THE TWO DEPARTMENT MARKS, drawn at door scale.
 * ─────────────────────────────────────────────
 * The kit's icons are 13–18px chrome marks, and at 30px on a 300px glass pane
 * they read as decoration, not as the department. The reference gives each door
 * ONE large instrument instead — a chart on an orbit for sales, a horn for
 * marketing — so these two are drawn here, at 64 units, and sized by CSS.
 *
 * They are gradient strokes over a faint fill, which is what makes them read as
 * lit glass rather than as flat glyphs, and the id of each gradient is unique so
 * the two doors can never steal each other's colour. Decorative only: both are
 * `aria-hidden` and `focusable="false"`, because the door's own link text names
 * the department.
 */
function GateMarkSales() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nxs-gate-sales-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c8ffe6" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#57d6a8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#1d6b52" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="nxs-gate-sales-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4fffa" stopOpacity="0.95" />
          <stop offset="1" stopColor="#37b98a" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="nxs-gate-sales-podium" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8ef0c9" stopOpacity="0.5" />
          <stop offset="1" stopColor="#8ef0c9" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The podium the instrument stands on: a lit ellipse with a dark disc in
          it, so the bars sit ON something instead of floating. */}
      <ellipse cx="32" cy="54" rx="26" ry="6.5" fill="url(#nxs-gate-sales-podium)" />
      <ellipse
        cx="32"
        cy="54"
        rx="20"
        ry="4.4"
        fill="#0b1411"
        fillOpacity="0.55"
        stroke="url(#nxs-gate-sales-edge)"
        strokeOpacity="0.5"
        strokeWidth="0.9"
      />
      {/* Hollow-ish glass bars: gradient face, lit edge, one specular strip. */}
      <g stroke="url(#nxs-gate-sales-edge)" strokeWidth="1.1">
        <rect x="11" y="30" width="10" height="22" rx="3" fill="url(#nxs-gate-sales-face)" />
        <rect x="26" y="21" width="10" height="31" rx="3" fill="url(#nxs-gate-sales-face)" />
        <rect x="41" y="12" width="10" height="40" rx="3" fill="url(#nxs-gate-sales-face)" />
      </g>
      <g fill="#ffffff" fillOpacity="0.38">
        <rect x="13.5" y="32.5" width="2" height="16" rx="1" />
        <rect x="28.5" y="23.5" width="2" height="25" rx="1" />
        <rect x="43.5" y="14.5" width="2" height="34" rx="1" />
      </g>
      <ellipse
        cx="32"
        cy="40"
        rx="27"
        ry="9"
        transform="rotate(-15 32 40)"
        fill="none"
        stroke="url(#nxs-gate-sales-edge)"
        strokeWidth="1.6"
        strokeOpacity="0.9"
      />
    </svg>
  );
}

function GateMarkMarketing() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nxs-gate-mkt-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3dc" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#f3ad49" stopOpacity="0.9" />
          <stop offset="1" stopColor="#8a5418" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="nxs-gate-mkt-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#e09a3a" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="nxs-gate-mkt-podium" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd79a" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffd79a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="nxs-gate-mkt-mouth" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2a1a09" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffcf85" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="54" rx="26" ry="6.5" fill="url(#nxs-gate-mkt-podium)" />
      <ellipse
        cx="32"
        cy="54"
        rx="20"
        ry="4.4"
        fill="#140e05"
        fillOpacity="0.55"
        stroke="url(#nxs-gate-mkt-edge)"
        strokeOpacity="0.5"
        strokeWidth="0.9"
      />
      {/* The horn: gradient body, a lit top facet, and the dark throat of the
          mouth so the cone reads as a volume and not as a triangle. */}
      {/* The horn, tilted the way the reference holds it: a cone that is narrow
          at the grip and wide at the mouth, the mouth itself an open ellipse with
          a dark inside and a lit rim, a grip below, and two rings of sound. The
          ellipse is what makes it a megaphone instead of a folded shape. */}
      <g transform="rotate(-14 30 32)">
        <path
          d="M14 24 42 12v40L14 40V24Z"
          fill="url(#nxs-gate-mkt-face)"
          stroke="url(#nxs-gate-mkt-edge)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path d="M14 24 42 12v7L14 31v-7Z" fill="#fff6e2" fillOpacity="0.2" />
        <ellipse
          cx="42"
          cy="32"
          rx="4"
          ry="20"
          fill="url(#nxs-gate-mkt-mouth)"
          stroke="url(#nxs-gate-mkt-edge)"
          strokeOpacity="0.78"
          strokeWidth="1"
        />
        <path
          d="M19 38 22 55l8-2.5L27 35Z"
          fill="url(#nxs-gate-mkt-face)"
          stroke="url(#nxs-gate-mkt-edge)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <g fill="none" stroke="url(#nxs-gate-mkt-edge)" strokeLinecap="round">
          <path d="M49 24a8 8 0 0 1 0 16" strokeWidth="1.7" strokeOpacity="0.95" />
          <path d="M53 21a10 10 0 0 1 0 22" strokeWidth="1.4" strokeOpacity="0.55" />
        </g>
      </g>
    </svg>
  );
}
