"use client";

import { useCommand } from "./state/command-store";
import { useLocale } from "./i18n/command-locale";
import { ExecutiveDockOrb } from "./executive-dock";
import {
  DEPARTMENT_BY_ID,
  deckFor,
  type DeckActionId,
  type DeckIconKey,
} from "./state/organization-model";
import { DECK_ICONS, IconArrowLeft } from "./ui/icons";
import { cssVars } from "./ui/css-vars";

/**
 * COMMAND ACTIONS — one primary, then what this space can actually do
 * ──────────────────────────────────────────────────────────────────
 * This replaces the fixed bottom bar (`adaptive-command-deck.tsx`). That surface
 * was a permanent, screen-covering toolbar that repeated its controls on every
 * route; the correction is a small row that belongs to the PAGE, scrolls with it,
 * and therefore can never cover the content above or below it.
 *
 *   · ONE PRIMARY ACTION. The Executive control is the single lead: an orb and a
 *     two-line label, not one of six equal cells.
 *   · CONTEXTUAL SECONDARIES. The row after it is `deckFor(level)` — the actions
 *     the CURRENT space can take. It is the same data the old surface used, so a
 *     department's own verbs still appear when that department is the open level,
 *     and the organization's verbs appear when it is not.
 *   · ONE EXEC ENTRY POINT PER LAYOUT. Desktop reaches EXEC through this control
 *     (and the rail item); the phone reaches it through the bottom bar's EXEC
 *     destination. The old floating EXEC tab — a third affordance hovering over
 *     the content — is gone.
 *
 * Every word resolves from the dictionary (`deck.*`, `execDock.*`), and each cell
 * still reports through the shell's single toast surface, so a control here does
 * not invent a second feedback channel.
 */
export function CommandActionBar() {
  const { notify, focus, clearFocus } = useCommand();
  const { t } = useLocale();

  const department = focus ? DEPARTMENT_BY_ID[focus] : null;
  const actions = deckFor(department?.id ?? null);
  const levelName = department ? t(`dept.${department.id}.name`) : t("common.organization");

  const renderCell = (id: DeckActionId, icon: DeckIconKey) => {
    const Icon = DECK_ICONS[icon] ?? DECK_ICONS.mission;
    const label = t(`deck.${id}.label`);
    const hint = t(`deck.${id}.hint`);
    return (
      <button
        key={id}
        type="button"
        className="nc-actions__cell"
        onClick={() => notify(`${label}: ${hint}`)}
        title={`${hint} — ${t("common.mockOnly")}`}
      >
        <Icon size={16} />
        <span className="nc-actions__cell-label">{label}</span>
      </button>
    );
  };

  return (
    <div
      className="nc-actions"
      data-level={department ? "department" : "organization"}
      style={cssVars({
        "--nc-accent": department ? `var(${department.accentVar})` : "var(--nc-lime)",
      })}
      role="group"
      aria-label={`${levelName} — ${t("shell.deckAria")}`}
    >
      <div className="nc-actions__primary">
        <ExecutiveDockOrb />
        {department && (
          <button
            type="button"
            className="nc-actions__back"
            onClick={clearFocus}
            aria-label={t("shell.returnToOrganization")}
          >
            <IconArrowLeft size={12} />
            {t("common.organization")}
          </button>
        )}
      </div>

      <div className="nc-actions__context">
        {actions.map((action) => renderCell(action.id, action.icon))}
      </div>
    </div>
  );
}
