"use client";

import { useCommand } from "./state/command-store";
import { ExecutiveDockOrb } from "./executive-dock";
import { DEPARTMENT_BY_ID, deckFor, type DeckAction, type DeckIconKey } from "./state/organization-model";
import { DECK_ICONS } from "./ui/icons";
import { cssVars } from "./ui/css-vars";

/**
 * COMMAND SURFACE (Phase UI-02.1)
 * ───────────────────────────────
 * UI-01.1's bottom control was a centred pill: seven round buttons in a floating
 * rounded bar, which is a mobile navigation bar enlarged for desktop. The
 * reviewer called it exactly that, and it was right.
 *
 * The surface is now built the way a console is built:
 *
 *   · it spans the full width and sits FLUSH against the bottom of the shell, so
 *     it reads as the near edge of the room rather than as an object hovering
 *     over it;
 *   · its cells are separated by hairlines and share one material, so it is one
 *     instrument, not five buttons that happen to be adjacent;
 *   · every cell carries a label AND a plain-language hint ("Start Build / Ship a
 *     change from this space"), because a control an operator cannot read at a
 *     glance is decoration;
 *   · the accent is contextual: lime at the organization level, the entered
 *     space's own accent inside it. The whole surface changes identity with the
 *     workspace it belongs to, which is what makes it a surface rather than a
 *     toolbar.
 *
 * Actions remain DATA (see `organization-model.ts`): adding one to a space is a
 * configuration change, and adding a branch to this file would be the bug. The
 * Executive control stays the lead cell, because the surface belongs to the
 * Executive's workspace and its primary affordance is talking to it.
 */
export function AdaptiveCommandDeck() {
  const { notify, focus, clearFocus } = useCommand();

  const department = focus ? DEPARTMENT_BY_ID[focus] : null;
  const actions = deckFor(department?.id ?? null);

  return (
    <div
      className="nc-surface"
      data-level={department ? "department" : "organization"}
      style={cssVars({
        "--nc-surface-accent": department ? `var(${department.accentVar})` : "var(--nc-lime)",
      })}
      role="toolbar"
      aria-label={department ? `${department.name} command surface` : "Organization command surface"}
    >
      <div className="nc-surface__lead">
        <ExecutiveDockOrb />

        <div className="nc-surface__level">
          <span className="nc-surface__level-kicker">{department ? "Inside" : "Workspace"}</span>
          <span className="nc-surface__level-name">{department ? department.name : "Organization"}</span>
          {department && (
            <button
              type="button"
              className="nc-surface__level-back"
              onClick={clearFocus}
              aria-label="Return the surface to organization actions"
            >
              Return to organization
            </button>
          )}
        </div>
      </div>

      <div className="nc-surface__cells">
        {/* PRIMARY cluster: the two main operational controls */}
        <div className="nc-surface__primary">
          {actions.slice(0, 2).map((action: DeckAction, index: number) => {
            const Icon = DECK_ICONS[action.icon as DeckIconKey] ?? DECK_ICONS.mission;
            return (
              <button
                key={action.id}
                type="button"
                className="nc-surface__cell"
                data-primary={true}
                onClick={() => notify(`${action.label}: ${action.intent}`)}
                title={`${action.intent} (mocked in this phase)`}
              >
                <span className="nc-surface__cell-icon" aria-hidden="true">
                  <Icon size={19} />
                </span>
                <span className="nc-surface__cell-text">
                  <span className="nc-surface__cell-label">{action.label}</span>
                  <span className="nc-surface__cell-hint">{action.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* UTILITY cluster: secondary controls */}
        <div className="nc-surface__utility">
          {actions.slice(2).map((action: DeckAction, index: number) => {
            const Icon = DECK_ICONS[action.icon as DeckIconKey] ?? DECK_ICONS.mission;
            return (
              <button
                key={action.id}
                type="button"
                className="nc-surface__cell"
                onClick={() => notify(`${action.label}: ${action.intent}`)}
                title={`${action.intent} (mocked in this phase)`}
              >
                <span className="nc-surface__cell-icon" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="nc-surface__cell-text">
                  <span className="nc-surface__cell-label">{action.label}</span>
                  <span className="nc-surface__cell-hint">{action.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
