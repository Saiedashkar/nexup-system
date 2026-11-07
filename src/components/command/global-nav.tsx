"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommand } from "./state/command-store";
import { translateFor, useLocale } from "./i18n/command-locale";
import { LocaleSwitch } from "./i18n/locale-switch";
import { FOUNDER } from "./state/organization-model";
import { RAIL_AREAS } from "./lab/areas";
import {
  IconCapabilities,
  IconCommand,
  IconControl,
  IconCreate,
  IconExec,
  IconGear,
  IconSystems,
  IconWork,
  IconWorkforce,
} from "./ui/icons";

/**
 * The permanent global navigation — six areas, deliberately tiny.
 *
 * Nothing here scales with the business: departments, tools, agents, systems
 * and projects all live in an area's own contextual second-level navigation
 * (the first of which is the Living Organization inside Command). Adding a
 * tenth company never touches this file.
 *
 * PASS 2 — the rail is fully localized too. Every visible word resolves from the
 * dictionary (`shell.rail.*`, `areas.*`, `shell.*`), so a language switch reaches
 * the chrome as well as the content, and the language control itself lives at the
 * bottom of this rail, where it is permanently reachable from every surface.
 */
const AREA_ICONS = {
  command: IconCommand,
  work: IconWork,
  workforce: IconWorkforce,
  systems: IconSystems,
  capabilities: IconCapabilities,
  control: IconControl,
} as const;

export function GlobalNav() {
  const { notify } = useCommand();
  const { t } = useLocale();
  const pathname = usePathname();

  /* Which rail area is open: the longest matching href, then the group's own
     default. `/command/departments/**`, `/command/actors/**` and `/command/exec`
     all belong to areas that already exist in the strip. */
  const activeRail = (() => {
    if (pathname.startsWith("/command/exec")) return "exec";
    if (pathname.startsWith("/command/missions") || pathname.startsWith("/command/projects") || pathname.startsWith("/command/clients")) return "work";
    if (pathname.startsWith("/command/workforce")) return "workforce";
    if (pathname.startsWith("/command/systems")) return "systems";
    if (pathname.startsWith("/command/models")) return "capabilities";
    if (pathname.startsWith("/command/decisions") || pathname.startsWith("/command/finance") || pathname.startsWith("/command/activity")) return "control";
    return "command";
  })();

  return (
    <nav className="nc-rail" aria-label={t("shell.railAria")}>
      <div className="nc-rail__brand">
        <span className="nc-rail__wordmark">{t("shell.brandName")}</span>
        <span className="nc-rail__sub">{t("shell.brandSub")}</span>
      </div>

      {/* EXEC sits ABOVE the six areas: it is the central intelligence, not one
          area among them. Its label is an identifier, so it is the same word in
          both languages. */}
      <Link
        className="nc-rail__exec"
        href="/command/exec"
        aria-label={t("shell.execAria")}
        aria-current={activeRail === "exec" ? "page" : undefined}
      >
        <span className="nc-rail__exec-glyph">
          <IconExec size={17} />
        </span>
        <span className="nc-rail__exec-label">{t("areas.exec.label")}</span>
      </Link>

      <div className="nc-rail__nav">
        {RAIL_AREAS.map(({ id, href }) => {
          const Icon = AREA_ICONS[id];
          const active = activeRail === id;
          return (
            <Link
              key={id}
              className="nc-nav-item"
              href={href}
              aria-current={active ? "page" : undefined}
              data-active={active}
            >
              <span className="nc-nav-item__glyph">
                <Icon size={18} />
              </span>
              <span className="nc-nav-item__label">{t(`shell.rail.${id}`)}</span>
            </Link>
          );
        })}
      </div>

      <Link className="nc-rail__create" href="/command/missions">
        <IconCreate size={17} />
        <span className="nc-rail__create-label">{t("shell.createDo")}</span>
      </Link>

      <div className="nc-rail__foot">
        <div className="nc-rail__os">
          <span className="nc-rail__os-orb" aria-hidden="true" />
          <span className="nc-rail__os-label">{t("shell.osLabel")}</span>
          <span className="nc-rail__os-version">{t("shell.version")}</span>
        </div>

        {/* The language control is permanent rail chrome, not a page setting:
            the language a reader needs must be reachable from every surface,
            including the one they cannot read yet. */}
        <LocaleSwitch
          variant="rail"
          onChanged={(locale, label) =>
            notify(translateFor(locale, "shell.savedToast", { language: label }))
          }
        />

        <div className="nc-rail__user">
          <span className="nc-avatar" style={{ width: 32, height: 32, fontSize: 12 }} aria-hidden="true">
            {FOUNDER.initials}
          </span>
          <span className="nc-rail__user-text">
            <span className="nc-rail__user-name">{t("shell.founderName")}</span>
            <span className="nc-rail__user-role">
              <i aria-hidden="true" />
              {t("shell.founderRole")}
            </span>
          </span>
          <button
            type="button"
            className="nc-rail__gear"
            aria-label={t("common.settings")}
            onClick={() => notify(t("shell.settingsToast"))}
          >
            <IconGear size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
