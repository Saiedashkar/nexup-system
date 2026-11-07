"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../i18n/command-locale";
import { IconChevronRight, IconClose, IconDeptClient, IconDeptCreative } from "../ui/icons";

/**
 * THE HOME'S ONE DEMO COLLABORATION
 * ────────────────────────────────
 * The approved reference carries a quiet pulse on the route between Clients &
 * Projects and Creative & Production. This is that pulse, made explicit and
 * reviewable:
 *
 *   · the route is drawn by `ConnectionField` from the SAME placement maths as
 *     the two plates, so it cannot drift from them;
 *   · the pulse is a single slow signal, never random motion, and it is omitted
 *     entirely when the reader prefers reduced motion;
 *   · the trigger is a real button with a label, not a glowing decoration, and
 *     it opens a dialog that says exactly what the scenario is: a project brief
 *     moving from the client space to the studio, with the same client, project
 *     and task identity on both sides;
 *   · the dialog states, in words, that nothing is sent, assigned or executed.
 *
 * No provider, no API and no write path is touched. This is a composition demo.
 */
export function DemoHandoffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, dir } = useLocale();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  /* The dialog is portalled to the Command root: on a phone the composition
     lives inside a scrolling, stacked main column, and a fixed overlay inside
     that column would still sit under the fixed bottom bar. The portal keeps the
     token scope (the root owns every `--nc-*` variable) while moving the sheet
     above the shell's own stacking context. `open` is false during SSR, so the
     document is never touched on the server. */

  useEffect(() => {
    if (!open) return;
    /* Remember the trigger before focus moves into the dialog, so closing puts
       the keyboard reader back on the control they used — not on `<body>`. */
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="nc-handoff-dialog" role="presentation" dir={dir}>
      <button
        type="button"
        className="nc-handoff-dialog__scrim"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="nc-handoff-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nc-handoff-title"
      >
        <header className="nc-handoff-dialog__head">
          <span className="nc-handoff-dialog__kicker">
            <i aria-hidden="true" />
            {t("home.handoffKicker")}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="nc-handoff-dialog__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconClose size={16} />
          </button>
        </header>

        <h2 className="nc-handoff-dialog__title" id="nc-handoff-title">
          {t("home.handoffTitle")}
        </h2>

        <div className="nc-handoff-dialog__route" aria-hidden="true">
          <span className="nc-handoff-dialog__place">
            <IconDeptClient size={17} />
            {t("dept.client.name")}
          </span>
          <span className="nc-handoff-dialog__arrow">
            <IconChevronRight size={15} />
          </span>
          <span className="nc-handoff-dialog__place">
            <IconDeptCreative size={17} />
            {t("dept.creative.name")}
          </span>
        </div>

        <p className="nc-handoff-dialog__body">{t("home.handoffBody")}</p>

        <dl className="nc-handoff-dialog__facts">
          <div>
            <dt>{t("home.handoffTaskLabel")}</dt>
            <dd>{t("home.handoffTask")}</dd>
          </div>
          <div>
            <dt>{t("home.handoffStateLabel")}</dt>
            <dd>{t("home.handoffState")}</dd>
          </div>
        </dl>

        <p className="nc-handoff-dialog__note">{t("home.handoffNote")}</p>

        <footer className="nc-handoff-dialog__foot">
          <Link className="nc-handoff-dialog__open" href="/command/projects" onClick={onClose}>
            {t("home.handoffOpen")}
            <IconChevronRight size={14} />
          </Link>
          <button type="button" className="nc-handoff-dialog__dismiss" onClick={onClose}>
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>,
    document.querySelector(".nc-root") ?? document.body,
  );
}

/**
 * The visible trigger. Two compositions use it — on the stage it sits under the
 * orbit; on the phone it sits inside the hero, between the two rows it connects.
 * The pulse dot is CSS only and stops under `prefers-reduced-motion`.
 */
export function DemoHandoffPill({
  onOpen,
  variant = "stage",
}: {
  onOpen: () => void;
  variant?: "stage" | "phone";
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="nc-handoff-pill"
      data-variant={variant}
      onClick={onOpen}
      aria-label={t("home.handoffAria")}
    >
      <span className="nc-handoff-pill__pulse" aria-hidden="true">
        <i />
      </span>
      <span className="nc-handoff-pill__label">{t("home.handoffPill")}</span>
      <span className="nc-handoff-pill__tag">{t("home.demoTag")}</span>
      <IconChevronRight size={13} className="nc-handoff-pill__chev" />
    </button>
  );
}
