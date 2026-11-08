"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
import { useCommandData } from "../state/demo/command-data-store";
import { DEMO_STATES, type DemoState } from "../state/demo/adapter";
import type { CommandDataset } from "../state/demo/types";
import { cssVars } from "../ui/css-vars";
import {
  IconActivity,
  IconAgent,
  IconChevronRight,
  IconCommand,
  IconControl,
  IconCreate,
  IconExec,
  IconHuman,
  IconMission,
  IconPanel,
  IconProject,
  IconRepeat,
  IconRun,
  IconSpark,
  IconStack,
  IconSystems,
  IconWarRoom,
  IconWorkforce,
  IconWorkflow,
} from "../ui/icons";
import { AREAS, type Area, type AreaId, areaForPath } from "./areas";

/**
 * NEXUP COMMAND — PRODUCT LAB KIT
 * ───────────────────────────────
 * The shared vocabulary every Product Lab surface is built from. It exists so
 * eleven pages read as one product: the same panel, the same figure row, the
 * same status pill, the same empty/loading/error/blocked treatment, the same
 * header rhythm.
 *
 * Everything renders inside the existing `.nc-root` token scope, uses the
 * approved graphite/blue glass palette (never a new colour), and carries the
 * `nl-` prefix so it cannot collide with the earlier `nc-` layers.
 */

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Turn a token name ("--nc-active") into a local accent variable. */
export function tone(token: string) {
  return cssVars({ "--nl-tone": `var(${token})` });
}

export const AREA_ICONS: Record<AreaId, (props: { size?: number; className?: string }) => ReactNode> = {
  "command-center": IconCommand,
  missions: IconMission,
  projects: IconProject,
  clients: IconHuman,
  workforce: IconWorkforce,
  decisions: IconWarRoom,
  finance: IconControl,
  activity: IconActivity,
  systems: IconSystems,
  models: IconStack,
  exec: IconExec,
  talk: IconSpark,
};

/** Icons used by rail-level chrome outside the areas themselves. */
export const EXTRA_ICONS = { IconRun, IconRepeat, IconWorkflow, IconAgent, IconCreate, IconPanel };

/* ── Area navigation ───────────────────────────────────────────────────── */

/**
 * The area strip. One horizontal, keyboard-reachable list of every surface in
 * the product — the "NEXUP OS" switcher. On a phone it scrolls rather than
 * wrapping, because a wrapping nav on a small screen reads as a menu, not a bar.
 */
export function AreaNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const current = areaForPath(pathname);

  return (
    <nav className="nl-areas" aria-label={t("shell.areasAria")}>
      <div className="nl-areas__track">
        {AREAS.map((area) => {
          const Icon = AREA_ICONS[area.id];
          const active = current?.id === area.id;
          return (
            <Link
              key={area.id}
              href={area.href}
              className="nl-areas__item"
              data-active={active}
              aria-current={active ? "page" : undefined}
              title={t(`areas.${area.id}.label`)}
              lang={undefined}
            >
              <Icon size={14} />
              {/* The short form is what fits one row of twelve; the full label is
                  the tooltip and the page's own heading. Both come from the
                  dictionary, so the strip is bilingual like the pages it opens. */}
              <span className="nl-areas__label">{t(`areas.${area.id}.short`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Demo state control ─────────────────────────────────────────────────── */

/**
 * The reviewer's state switcher. Visible on purpose: the four read states are
 * part of the deliverable, and a control that shows them is more honest than a
 * screenshot of each. It is labelled as what it is.
 */
export function DemoStateControl() {
  const { demoState, setDemoState } = useCommandData();
  const { t } = useLocale();

  return (
    <div className="nl-demo" role="group" aria-label={t("kit.demoStateAria")}>
      {/* Labelled as what it is: this is a REVIEWER control over the demo read
          state, not a production setting. */}
      <span className="nl-demo__label">{t("provenance.demoState")}</span>
      <div className="nl-demo__seg">
        {DEMO_STATES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="nl-demo__opt"
            data-active={demoState === option.id}
            aria-pressed={demoState === option.id}
            title={t(`kit.demoState.${option.id}`)}
            onClick={() => setDemoState(option.id as DemoState)}
          >
            {t(`kit.demoState.${option.id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Page chrome ────────────────────────────────────────────────────────── */

export function LabHeader({
  areaId,
  title,
  blurb,
  meta,
  actions,
  hideDemoState,
}: {
  areaId: AreaId;
  title?: string;
  blurb?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A BOUND surface hides the demo-state switch: its data is not demo data. */
  hideDemoState?: boolean;
}) {
  const { t } = useLocale();
  const area = AREAS.find((a) => a.id === areaId) as Area | undefined;
  const Icon = AREA_ICONS[areaId] ?? IconCommand;

  /* The page's own heading resolves from the dictionary unless the page
     overrides it, which is why every lab page's title and blurb are bilingual
     without the page saying so. */
  const areaLabel = area ? t(`areas.${area.id}.label`) : t("areas.command-center.label");

  return (
    <header className="nl-head">
      <div className="nl-head__lead">
        <span className="nl-head__mark" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="nl-head__copy">
          <span className="nl-head__kicker">{areaLabel}</span>
          <h1 className="nl-head__title">{title ?? areaLabel}</h1>
          <p className="nl-head__blurb">{blurb ?? (area ? t(`areas.${area.id}.blurb`) : "")}</p>
        </div>
      </div>

      <div className="nl-head__aside">
        {meta && <div className="nl-head__meta">{meta}</div>}
        {actions && <div className="nl-head__actions">{actions}</div>}
        {!hideDemoState && <DemoStateControl />}
      </div>
    </header>
  );
}

/**
 * The frame every Product Lab page sits in: the area strip, the page header, and
 * the content band. Pages only supply content, which is what keeps the rhythm
 * identical across eleven surfaces.
 */
export function LabFrame({
  areaId,
  title,
  blurb,
  meta,
  actions,
  hideDemoState,
  children,
}: {
  areaId: AreaId;
  title?: string;
  blurb?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Set on a surface whose rows come from the database, not from the demo set. */
  hideDemoState?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="nl-page">
      <AreaNav />
      <LabHeader
        areaId={areaId}
        title={title}
        blurb={blurb}
        meta={meta}
        actions={actions}
        hideDemoState={hideDemoState}
      />
      <div className="nl-body">{children}</div>
    </div>
  );
}

/* ── Data gate ──────────────────────────────────────────────────────────── */

/**
 * One place that decides what a surface looks like when the read is not ready —
 * reading, empty, degraded or failed. Pages inside it only ever handle a real,
 * non-null dataset, so no page contains an `if (!data) return null`.
 */
export function LabData({
  children,
  emptyTitle,
  emptyBody,
}: {
  children: (dataset: CommandDataset) => ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const { state, dataset, error, warning, reload } = useCommandData();
  const { t } = useLocale();

  if (state === "loading" || !dataset) {
    return <LoadingStack />;
  }

  if (state === "error") {
    return <ErrorState message={error ?? t("kit.errorFallback")} onRetry={reload} />;
  }

  return (
    <>
      {state === "degraded" && warning && <StaleBanner message={warning} onRetry={reload} />}
      {state === "empty" ? (
        <EmptyState
          title={emptyTitle ?? t("kit.emptyDefaultTitle")}
          body={emptyBody ?? t("kit.emptyDefaultBody")}
        />
      ) : (
        children(dataset)
      )}
    </>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

export function LoadingStack({ label }: { label?: string }) {
  const { t } = useLocale();
  return (
    <div className="nl-loading" role="status" aria-live="polite">
      <p className="nl-loading__label">
        <span className="nl-loading__dot" aria-hidden="true" />
        {label ?? t("kit.readingOrganization")}…
      </p>
      <div className="nl-loading__grid">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="nl-skel" />
        ))}
      </div>
      <div className="nl-loading__rows">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="nl-skel nl-skel--row" />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="nl-empty">
      <span className="nl-empty__mark" aria-hidden="true">
        <IconSpark size={18} />
      </span>
      <h2 className="nl-empty__title">{title}</h2>
      <p className="nl-empty__body">{body}</p>
      {action && <div className="nl-empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="nl-error" role="alert">
      <h2 className="nl-error__title">{t("kit.errorTitle")}</h2>
      <p className="nl-error__body">{message}</p>
      {onRetry && (
        <button type="button" className="nl-btn" onClick={onRetry}>
          <IconRepeat size={14} />
          {t("common.readAgain")}
        </button>
      )}
    </div>
  );
}

/** A partial read is not a failure — the surface says which region is stale. */
export function StaleBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLocale();
  return (
    <div className="nl-stale" role="status">
      <span className="nl-stale__dot" aria-hidden="true" />
      <span className="nl-stale__text">{message}</span>
      <span className="nl-stale__tag">{t("common.partialRead")}</span>
      {onRetry && (
        <button type="button" className="nl-stale__retry" onClick={onRetry}>
          {t("common.readAgain")}
        </button>
      )}
    </div>
  );
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

export function Section({
  title,
  hint,
  count,
  action,
  span,
  children,
  className,
}: {
  title: string;
  hint?: string;
  count?: number | string;
  action?: ReactNode;
  /** How much of the 12-column band this panel takes. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`nl-panel${className ? ` ${className}` : ""}`} data-span={span ?? 12}>
      <header className="nl-panel__head">
        <h2 className="nl-panel__title">{title}</h2>
        {count !== undefined && <span className="nl-panel__count">{count}</span>}
        {hint && <span className="nl-panel__hint">{hint}</span>}
        {action && <div className="nl-panel__action">{action}</div>}
      </header>
      <div className="nl-panel__body">{children}</div>
    </section>
  );
}

/** Two-column band: a wide primary column and a narrow secondary column. */
export function Split({
  primary,
  aside,
}: {
  primary: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="nl-split">
      <div className="nl-split__main">{primary}</div>
      <div className="nl-split__aside">{aside}</div>
    </div>
  );
}

/* ── Figures ────────────────────────────────────────────────────────────── */

export function FigureRow({
  items,
}: {
  items: Array<{ id: string; label: string; value: string; note: string; tone: string; href?: string }>;
}) {
  const { tc } = useLocale();
  return (
    <div className="nl-figures" role="list">
      {items.map((item) => {
        const body = (
          <>
            <span className="nl-figure__value">{item.value}</span>
            <span className="nl-figure__label">{tc(item.label)}</span>
            <span className="nl-figure__note">{tc(item.note)}</span>
          </>
        );
        return item.href ? (
          <Link key={item.id} href={item.href} role="listitem" className="nl-figure" style={tone(item.tone)}>
            {body}
          </Link>
        ) : (
          <div key={item.id} role="listitem" className="nl-figure" style={tone(item.tone)}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ── Small parts ────────────────────────────────────────────────────────── */

export function Pill({
  label,
  tone: token,
  dot = true,
}: {
  label: string;
  tone: string;
  dot?: boolean;
}) {
  return (
    <span className="nl-pill" style={tone(token)}>
      {dot && <i aria-hidden="true" />}
      {label}
    </span>
  );
}

export function Meter({ value, tone: token }: { value: number; tone: string }) {
  return (
    <span className="nl-meter" style={tone(token)} aria-hidden="true">
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function Avatar({
  initials,
  kind,
  tone: token,
  size = 34,
}: {
  initials: string;
  kind: "human" | "agent";
  tone: string;
  size?: number;
}) {
  return (
    <span
      className="nl-avatar"
      data-kind={kind}
      style={cssVars({ "--nl-tone": `var(${token})`, "--nl-av": `${size}px` })}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="nl-note">{children}</p>;
}

/** The label/value pair used in every detail column. */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  const { tc } = useLocale();
  return (
    <div className="nl-kv">
      <span className="nl-kv__label">{tc(label)}</span>
      <span className="nl-kv__value">{children}</span>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="nl-toolbar">{children}</div>;
}

/** A filter chip group. `options` are plain data; the page owns the state. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const { tc } = useLocale();
  return (
    <div className="nl-chips" role="group" aria-label={tc(label)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="nl-chip"
          data-active={value === option.id}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {tc(option.label)}
          {option.count !== undefined && <span className="nl-chip__count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Table primitives ───────────────────────────────────────────────────── */

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const { tc } = useLocale();
  return (
    <div className="nl-table" data-cols={head.length} role="table">
      <div className="nl-table__head" role="row">
        {head.map((label) => (
          <span key={label} role="columnheader">
            {tc(label)}
          </span>
        ))}
      </div>
      <div className="nl-table__body">{children}</div>
    </div>
  );
}

export function Row({
  href,
  onClick,
  children,
  accent,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  accent?: string;
}) {
  const style = accent ? tone(accent) : undefined;

  if (href) {
    return (
      <Link className="nl-row" href={href} role="row" style={style}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="nl-row" role="row" style={style} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <div className="nl-row" role="row" style={style}>
      {children}
    </div>
  );
}

export function Cell({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: "lead" | "muted" | "right";
}) {
  return (
    <span className="nl-cell" data-variant={variant}>
      {children}
    </span>
  );
}

/** The little leading mark on a table row: initials, a department code, an icon. */
export function Mark({ children, tone: token }: { children: ReactNode; tone?: string }) {
  return (
    <span className="nl-mark" style={token ? tone(token) : undefined} aria-hidden="true">
      {children}
    </span>
  );
}

/* ── Timeline ───────────────────────────────────────────────────────────── */

export function Timeline({
  entries,
}: {
  entries: Array<{ id: string; at: string; actor: string; text: string; tone: string }>;
}) {
  const { tc } = useLocale();
  return (
    <ol className="nl-timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="nl-timeline__item" style={tone(entry.tone)}>
          <span className="nl-timeline__dot" aria-hidden="true" />
          <span className="nl-timeline__body">
            <span className="nl-timeline__meta">
              <span className="nl-timeline__actor">{tc(entry.actor)}</span>
              <span className="nl-timeline__at">{tc(entry.at)}</span>
            </span>
            <span className="nl-timeline__text">{tc(entry.text)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

export function LabButton({
  children,
  href,
  onClick,
  variant = "ghost",
  disabled,
  title,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "quiet";
  disabled?: boolean;
  title?: string;
}) {
  if (href) {
    return (
      <Link className="nl-btn" data-variant={variant} href={href} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="nl-btn"
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function ViewAll({ href, label }: { href: string; label?: string }) {
  const { t } = useLocale();
  return (
    <Link className="nl-viewall" href={href}>
      {label ?? t("common.viewAll")}
      <IconChevronRight size={12} />
    </Link>
  );
}

/** A mocked control: it says what would happen instead of pretending it did. */
export function MockButton({
  children,
  message,
  title,
}: {
  children: ReactNode;
  message: string;
  title?: string;
}) {
  const { notify } = useCommand();
  return (
    <button type="button" className="nl-btn" data-variant="ghost" title={title} onClick={() => notify(message)}>
      {children}
    </button>
  );
}
