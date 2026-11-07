"use client";

import Link from "next/link";
import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
import { BUSINESS_SCOPES, useScopeIndex } from "../state/business-scope";
import { DEPARTMENT_BY_ID } from "../state/organization-model";
import { companyPulse, currentWork, decisionQueue } from "../state/demo/selectors";
import { missionHref } from "../lab/areas";
import type { CommandDataset, Mission, MissionStatus, RiskLevel } from "../state/demo/types";
import {
  IconActivity,
  IconArrowLeft,
  IconChevronRight,
  IconGraph,
  IconList,
  IconMission,
  IconPanel,
  IconSpark,
} from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * COMMAND CENTER CHROME (visual-direction pass 2)
 * ──────────────────────────────────────────────
 * The reading the direction asks for, in this order and no other:
 *
 *   · a COMPACT page heading with the company scope beside it — no banner, no
 *     globe, no decorative band. The heading is chrome; the work is the page;
 *   · exactly THREE summary figures, ordered by what needs a human first;
 *   · two PRIORITY PANELS — "Needs your decision" and "Current work" — each with
 *     one clear action, because those two answers are why this screen exists;
 *   · the six departments, as a balanced card grid (see `organization-cards-view`).
 *
 * BOTH PANELS AND FIGURES READ THE DEMO DATASET, through the same selectors the
 * pages they link to read. That is deliberate: a home page that counted approvals
 * from the visual scenario while the Decision Center counted them from the
 * dataset would be reporting two organizations. Every number here is the number
 * the destination page will show.
 *
 * Mock-only, like everything else on this screen: the dataset is local typed
 * data behind the demo adapter, and nothing here calls a provider.
 */

/**
 * The home's THREE readings of ONE organization.
 *
 * The spatial composition is the default, and it is a reading — not the product
 * — so it never has to be the only one:
 *   · OVERVIEW — one central entry point, six spaces, one status each;
 *   · CARDS    — the same six spaces as a balanced grid;
 *   · LIST     — the same state as rows, in predictable keyboard order.
 *
 * There were previously two (`overview | map`) and the second one rendered
 * nothing: `living-organization` only ever composed overview, cards and list, so
 * selecting "Organization map" left the middle of the page empty. The placeholder
 * map is gone with it — a reading that shows nothing is worse than no reading.
 */
export type HomeView = "overview" | "cards" | "list";

/* ── Compact heading ────────────────────────────────────────────────────── */

export function CommandHeader({
  view,
  onViewChange,
}: {
  view: HomeView;
  onViewChange: (next: HomeView) => void;
}) {
  const { focus, clearFocus } = useCommand();
  const { t, tc } = useLocale();
  const scopeIndex = useScopeIndex();
  const focused = focus ? DEPARTMENT_BY_ID[focus] : null;
  const scope = scopeIndex === 0 ? tc(BUSINESS_SCOPES[0]) : BUSINESS_SCOPES[scopeIndex];

  return (
    <header className="nc-op-head">
      <div className="nc-op-head__id">
        {/* The company scope belongs to the heading, as CONTEXT — one line, read
            once. It is deliberately NOT a second control here: the command bar
            above already carries the scope switch, and two controls doing one
            thing is a competing accent, not a convenience. */}
        <span className="nc-op-head__kicker">
          {focused ? t("cc.department") : t("shell.brandSub")}{" "}
          {/* Two facts, and they must not run together: without the space (and
              the separator `operate.css` draws) the line rendered as one word —
              "CommandAll Companies" — in both languages. */}
          <span className="nc-op-head__scope" title={t("shell.commandScopeTitle")}>
            {scope}
          </span>
        </span>
        <h1 className="nc-op-head__title">
          {focused ? t(`dept.${focused.id}.name`) : t("cc.title")}
        </h1>
        <p className="nc-op-head__sub">
          {focused ? t(`dept.${focused.id}.brief`) : t("cc.subtitle")}
        </p>
      </div>

      <div className="nc-op-head__side">
        {focused && (
          <button type="button" className="nc-op-back" onClick={clearFocus}>
            <IconArrowLeft size={13} />
            {t("common.organization")}
          </button>
        )}

        {/* Three readings of one organization. The spatial composition is the
            default, not the only one: a card grid and a row list are the same
            state in a shape a reader can scan, and the LIST is the accessible
            twin of the composition. One `role="group"` with three `aria-pressed`
            buttons, so the set announces itself as a single choice. */}
        <div className="nc-op-views" role="group" aria-label={t("cc.viewAria")}>
          <button
            type="button"
            className="nc-op-view"
            data-active={view === "overview"}
            aria-pressed={view === "overview"}
            onClick={() => onViewChange("overview")}
          >
            <IconPanel size={14} />
            {t("cc.viewOverview")}
          </button>
          <button
            type="button"
            className="nc-op-view"
            data-active={view === "cards"}
            aria-pressed={view === "cards"}
            onClick={() => onViewChange("cards")}
          >
            <IconGraph size={14} />
            {t("cc.cards")}
          </button>
          <button
            type="button"
            className="nc-op-view"
            data-active={view === "list"}
            aria-pressed={view === "list"}
            onClick={() => onViewChange("list")}
          >
            <IconList size={14} />
            {t("cc.list")}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ── Three summary metrics ──────────────────────────────────────────────── */

export function CommandKpis({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();

  /* THREE, in priority order, straight from the company pulse: what is moving,
     what is waiting on the founder, and what cannot move at all. The previous
     row carried five tiles, two of which restated the panels beneath them. */
  const figures = companyPulse(dataset).slice(0, 3);

  return (
    <div className="nc-op-metrics" role="list" aria-label={t("cc.figuresAria")}>
      {figures.map((figure) => (
        <Link
          key={figure.id}
          href={figure.href ?? "/command"}
          role="listitem"
          className="nc-op-metric"
          style={cssVars({ "--nc-accent": `var(${figure.tone})` })}
        >
          <span className="nc-op-metric__value">{figure.value}</span>
          <span className="nc-op-metric__label">{tc(figure.label)}</span>
          {/* A note that interpolates a COUNT is a key, not a sentence: `tc()`
              can only translate a string it can match exactly, and no overlay
              can contain every count. Everything else is still demo content and
              goes through the overlay. See `PulseFigure.noteKey`. */}
          <span className="nc-op-metric__note">
            {figure.noteKey ? t(figure.noteKey, figure.noteParams) : tc(figure.note)}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ── The two summaries: the only two answers the home must give ─────────── */

/**
 * THE SUMMARY ROW (champagne-orbit pass)
 * ──────────────────────────────────────
 * The approved company overview closes with two strips: what is waiting on the
 * founder, and what is currently moving. Each strip IS the link to the surface
 * that acts on it, each carries ONE number, and each number is read from the
 * same demo dataset its destination page reads — so the home cannot disagree
 * with the page it opens.
 *
 * This is deliberately not a KPI row. A figure tile abstracts a number away
 * from its rows; this pairs the number with the place the rows live, which is
 * what makes it a summary rather than a dashboard. The row-level panels and the
 * three figures still exist — one disclosure down, where operating detail
 * belongs (see `LivingOrganization`).
 */
export function CommandSummaries({ dataset }: { dataset: CommandDataset }) {
  const { t } = useLocale();

  const approvals = decisionQueue(dataset);
  const work = currentWork(dataset);

  return (
    <div className="nc-sum">
      <Link className="nc-sum__cell" data-tone="attention" href="/command/decisions">
        <span className="nc-sum__disc" aria-hidden="true">
          <IconPanel size={18} />
        </span>
        <span className="nc-sum__stack">
          <span className="nc-sum__label">{t("cc.needsYourDecision")}</span>
          <span className="nc-sum__sub">{t("cc.decisionRequests")}</span>
        </span>
        <span className="nc-sum__count">{approvals.length}</span>
        <span className="nc-sum__chev" aria-hidden="true">
          <IconChevronRight size={18} />
        </span>
      </Link>

      <Link className="nc-sum__cell" href="/command/missions">
        <span className="nc-sum__disc" aria-hidden="true">
          <IconActivity size={18} />
        </span>
        <span className="nc-sum__stack">
          <span className="nc-sum__label">{t("cc.currentWork")}</span>
          <span className="nc-sum__sub">{t("cc.activeMissions")}</span>
        </span>
        <span className="nc-sum__count">{work.length}</span>
        <span className="nc-sum__chev" aria-hidden="true">
          <IconChevronRight size={18} />
        </span>
      </Link>
    </div>
  );
}

/* ── Priority panels: what needs you, and what is moving ────────────────── */

/** Risk tone. The WORD is localized from `status.risk.*`; only the colour lives here. */
function riskTone(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "--nc-thinking";
    case "medium":
      return "--nc-approval";
    default:
      return "--nc-error";
  }
}

/**
 * The label a mission status reads as. The ORDER of the list itself is not set
 * here: `currentWork` owns it (see `state/demo/selectors`), so the phone home and
 * this panel cannot disagree about which mission is most urgent.
 */
function missionStatusKey(status: MissionStatus): { key: "onTrack" | "inProgress" | "atRisk"; tone: string } {
  if (status === "blocked" || status === "failed") return { key: "atRisk", tone: "--nc-blocked" };
  if (status === "review" || status === "waiting") return { key: "inProgress", tone: "--nc-approval" };
  if (status === "completed") return { key: "onTrack", tone: "--nc-completed" };
  return { key: "inProgress", tone: "--nc-thinking" };
}

export function CommandPriorities({ dataset }: { dataset: CommandDataset }) {
  const { notify } = useCommand();
  const { t, tc } = useLocale();

  const approvals = decisionQueue(dataset);
  const work = currentWork(dataset);

  return (
    <div className="nc-op-priority">
      <section className="nc-op-panel nc-op-panel--action" aria-label={t("cc.decisionsAria")}>
        <header className="nc-op-panel__head">
          <span className="nc-op-panel__mark" aria-hidden="true">
            <IconSpark size={15} />
          </span>
          <h2 className="nc-op-panel__title">{t("cc.needsYourDecision")}</h2>
          <span className="nc-op-panel__count">{approvals.length}</span>
          <span className="nc-op-panel__hint">{t("cc.decisionsHint")}</span>
          {/* The panel's ONE action. The rows below are the detail. */}
          <Link
            className="nc-op-panel__action"
            href="/command/decisions"
            onClick={() => notify(t("cc.viewAllDecisionsToast"))}
          >
            {t("common.decide")}
            <IconChevronRight size={13} />
          </Link>
        </header>

        {approvals.length === 0 ? (
          <p className="nc-op-empty">{t("cc.nothingNeedsYou")}</p>
        ) : (
          <div className="nc-op-rows">
            {approvals.slice(0, 4).map((decision) => {
              const department = DEPARTMENT_BY_ID[decision.departmentId];
              return (
                <Link
                  key={decision.id}
                  href="/command/decisions"
                  className="nc-op-row"
                  data-variant="decision"
                  style={cssVars({
                    "--nc-accent": `var(${department?.accentVar ?? "--nc-product"})`,
                  })}
                >
                  <span className="nc-op-row__mark" aria-hidden="true">
                    {department?.short.slice(0, 2) ?? "—"}
                  </span>
                  <span className="nc-op-row__stack">
                    {/* One line by design; Arabic runs longer than English here,
                        so the full wording stays available on hover. */}
                    <span className="nc-op-row__title" title={tc(decision.title)}>
                      {tc(decision.title)}
                    </span>
                    <span className="nc-op-row__meta" title={tc(decision.impact)}>
                      {tc(decision.requestedBy)} · {tc(decision.impact)}
                    </span>
                  </span>
                  <span
                    className="nc-op-tag"
                    style={cssVars({ "--nc-accent": `var(${riskTone(decision.risk)})` })}
                  >
                    {t(`status.risk.${decision.risk}`)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="nc-op-panel" aria-label={t("cc.missionsAria")}>
        <header className="nc-op-panel__head">
          <span className="nc-op-panel__mark" aria-hidden="true">
            <IconMission size={15} />
          </span>
          <h2 className="nc-op-panel__title">{t("cc.currentWork")}</h2>
          {/* Same source as the figure above: every row below IS one mission, so
              the badge can only ever match the list it labels. */}
          <span className="nc-op-panel__count">{work.length}</span>
          <span className="nc-op-panel__hint">{t("cc.currentWorkHint")}</span>
          <Link
            className="nc-op-panel__link"
            href="/command/missions"
            onClick={() => notify(t("cc.viewAllMissionsToast"))}
          >
            {t("cc.openMissionControl")}
            <IconChevronRight size={13} />
          </Link>
        </header>

        {work.length === 0 ? (
          <p className="nc-op-empty">{t("cc.noWorkInProgress")}</p>
        ) : (
          <div className="nc-op-rows">
            {work.slice(0, 4).map((mission) => (
              <MissionRow key={mission.id} mission={mission} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MissionRow({ mission }: { mission: Mission }) {
  const { t, tc } = useLocale();
  const department = DEPARTMENT_BY_ID[mission.departmentId];
  const status = missionStatusKey(mission.status);
  return (
    <Link
      href={missionHref(mission.id)}
      className="nc-op-row"
      data-variant="mission"
      style={cssVars({ "--nc-accent": `var(${department?.accentVar ?? "--nc-product"})` })}
    >
      <span className="nc-op-row__mark" aria-hidden="true">
        {department?.short.slice(0, 2) ?? "—"}
      </span>
      <span className="nc-op-row__stack">
        <span className="nc-op-row__title" title={tc(mission.title)}>
          {tc(mission.title)}
        </span>
        <span className="nc-op-row__meta" title={tc(mission.owner)}>
          {department ? `${t(`dept.${department.id}.name`)} · ` : ""}
          {tc(mission.owner)}
        </span>
      </span>
      <span className="nc-op-row__figures">
        <span className="nc-op-meter" aria-hidden="true">
          <i style={{ width: `${mission.progress}%` }} />
        </span>
        <span className="nc-op-meter__pct">{mission.progress}%</span>
      </span>
      <span className="nc-op-status" style={cssVars({ "--nc-accent": `var(${status.tone})` })}>
        <i aria-hidden="true" />
        {t(`status.intent.${status.key}`)}
      </span>
    </Link>
  );
}

/* ── Recent activity (used by the context rail) ─────────────────────────── */

export function RecentActivity() {
  const { snapshot } = useCommand();
  const { tc } = useLocale();
  return (
    <div className="nc-cc-activity">
      {snapshot.activity.map((entry) => {
        const department = entry.departmentId ? DEPARTMENT_BY_ID[entry.departmentId] : null;
        return (
          <div
            key={entry.id}
            className="nc-cc-activity__row"
            style={cssVars({
              "--nc-accent": department ? `var(${department.accentVar})` : "var(--nc-completed)",
            })}
          >
            <span className="nc-cc-activity__icon" aria-hidden="true">
              {department ? <IconActivity size={14} /> : <IconSpark size={14} />}
            </span>
            <span className="nc-cc-activity__text">{tc(entry.text)}</span>
            <span className="nc-cc-activity__time">{tc(entry.time)}</span>
          </div>
        );
      })}
    </div>
  );
}
