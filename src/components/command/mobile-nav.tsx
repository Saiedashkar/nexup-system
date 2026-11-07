"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCommand } from "./state/command-store";
import { translateFor, useLocale } from "./i18n/command-locale";
import { LocaleSwitch } from "./i18n/locale-switch";
import { areasInGroup, type AreaGroup } from "./lab/areas";
import { IconCommand, IconExec, IconMore, IconWork, IconClose } from "./ui/icons";

/**
 * MOBILE SHELL NAVIGATION (Phase UI-05, reduced in Pass 3)
 * ───────────────────────────────────────────────────────
 * On a phone the rail and the context column stand down and this bar takes over.
 * Pass 3 reduces it to the four destinations the direction asks for —
 *
 *     HOME · WORK · EXEC · MORE
 *
 * — and removes the floating EXEC tab that used to hover over the content. EXEC
 * is one of the four destinations now, so it is still reachable from anywhere
 * without a second affordance sitting on top of the page.
 *
 * MORE opens an accessible bottom sheet listing every other surface, grouped the
 * way the rail groups them. It is a real dialog, and it BEHAVES like one:
 *
 *   · labelled, modal, and it takes focus on open (so a keyboard reader starts
 *     inside it rather than behind it);
 *   · Escape closes it from ANYWHERE, not only from a control inside it — the
 *     listener is on the document, because a reader who has not yet reached a
 *     control inside the sheet still expects Escape to work;
 *   · closing returns focus to the button that opened it.
 *
 * Focus is moved and restored, but deliberately NOT trapped: the sheet is short,
 * it is the last thing on the page, and a trap would add a keyboard loop with no
 * content in it.
 *
 * Both the bar and the sheet are inert above 760px — `system.css` and the
 * `operate.css` mobile block only ever display them on the small screen — so the
 * desktop composition is untouched.
 */

/**
 * The three destinations that are pages; the fourth is the More sheet. Each
 * carries its own dictionary key rather than composing one from its id, so the
 * bar cannot ask for a label that does not exist.
 */
const ITEMS = [
  { id: "home", href: "/command", Icon: IconCommand, labelKey: "mobile.home" },
  /* EXEC sits before Work, as it does in the approved phone reference. The bar
     reads HOME · EXEC · WORK · MORE in both directions. */
  { id: "exec", href: "/command/exec", Icon: IconExec, labelKey: "areas.exec.label" },
  { id: "work", href: "/command/missions", Icon: IconWork, labelKey: "mobile.tasks" },
] as const;

/** The sheet's groups, in the rail's order. */
const SHEET_GROUPS: Array<{ id: AreaGroup; key: "work" | "workforce" | "systems" | "capabilities" | "control" }> = [
  { id: "work", key: "work" },
  { id: "workforce", key: "workforce" },
  { id: "systems", key: "systems" },
  { id: "capabilities", key: "capabilities" },
  { id: "control", key: "control" },
];

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useLocale();
  const { notify } = useCommand();
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* Closing is one operation, not three: the state goes down and focus goes back
     to the control that opened the sheet, so the reader is never left on a node
     that no longer exists. */
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    moreRef.current?.focus();
  }, []);

  /* The phone header's menu opens the SAME sheet as the bar's fourth cell. A
     small explicit event keeps that one owner: the header does not grow a second
     navigation sheet of its own. */
  useEffect(() => {
    const open = () => setSheetOpen(true);
    window.addEventListener("nc:open-more", open);
    return () => window.removeEventListener("nc:open-more", open);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen, closeSheet]);

  return (
    <>
      <nav className="nc-mobilebar" aria-label={t("shell.mobileAria")}>
        {ITEMS.map(({ id, href, Icon, labelKey }) => {
          const current = pathname === href || (href !== "/command" && pathname.startsWith(`${href}/`));
          return (
            <Link
              key={id}
              className="nc-mobilebar__item"
              href={href}
              aria-current={current ? "page" : undefined}
              data-active={current}
            >
              <Icon size={19} />
              {t(labelKey)}
            </Link>
          );
        })}

        <button
          type="button"
          ref={moreRef}
          className="nc-mobilebar__item"
          data-active={sheetOpen}
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          aria-controls="nc-mobile-sheet"
          onClick={() => setSheetOpen(true)}
        >
          <IconMore size={19} />
          {t("mobile.more")}
        </button>
      </nav>

      {sheetOpen && (
        <div className="nc-sheet" role="presentation">
          <button
            type="button"
            className="nc-sheet__scrim"
            aria-label={t("common.close")}
            onClick={closeSheet}
          />
          <div
            id="nc-mobile-sheet"
            ref={panelRef}
            className="nc-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("mobile.sheetAria")}
          >
            <header className="nc-sheet__head">
              <span className="nc-sheet__title">{t("mobile.sheetAria")}</span>
              <button
                type="button"
                className="nc-sheet__close"
                aria-label={t("common.close")}
                onClick={closeSheet}
              >
                <IconClose size={16} />
              </button>
            </header>

            <div className="nc-sheet__body">
              {/* EXEC leads the sheet too: it is the core, not one area among the
                  rest — the same ordering the rail uses. */}
              <Link
                className="nc-sheet__exec"
                href="/command/exec/talk"
                onClick={closeSheet}
              >
                <IconExec size={17} />
                {t("areas.talk.label")}
              </Link>

              {SHEET_GROUPS.map(({ id, key }) => (
                <div key={id} className="nc-sheet__group">
                  <span className="nc-eyebrow">{t(`shell.rail.${key}`)}</span>
                  <div className="nc-sheet__links">
                    {areasInGroup(id).map((area) => (
                      <Link
                        key={area.id}
                        className="nc-sheet__link"
                        href={area.href}
                        aria-current={pathname === area.href ? "page" : undefined}
                        onClick={closeSheet}
                      >
                        {t(`areas.${area.id}.label`)}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}

              <div className="nc-sheet__group">
                <span className="nc-eyebrow">{t("shell.language")}</span>
                <LocaleSwitch
                  variant="bar"
                  onChanged={(locale, label) =>
                    notify(translateFor(locale, "shell.savedToast", { language: label }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
