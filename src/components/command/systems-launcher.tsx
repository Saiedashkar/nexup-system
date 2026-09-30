"use client";

import { useCommand } from "./state/command-store";
import { SYSTEMS } from "./state/organization-model";
import { cssVars } from "./ui/css-vars";
import { IconPlus } from "./ui/icons";

/**
 * Systems Launcher.
 *
 * Visual/mock only — with one deliberate exception: NEXUP System is a real,
 * already-existing surface, so it is allowed to route there. Nothing here
 * invents an integration, and no other system is rebuilt.
 *
 * The capability chips are the point of the launcher: later, COMMAND should be
 * able to use a system's capabilities without opening the original system.
 */
export function SystemsLauncher() {
  const { notify } = useCommand();

  return (
    <div className="nc-systems">
      {SYSTEMS.map((system) => {
        const body = (
          <>
            <span className="nc-system-card__top">
              <span className="nc-system-card__mark">{system.mark}</span>
              <span>
                <span className="nc-system-card__name" style={{ display: "block" }}>
                  {system.name}
                </span>
                <span className="nc-system-card__kind">{system.kind}</span>
              </span>
            </span>
            <span className="nc-system-card__caps">
              {system.capabilities.map((capability) => (
                <span key={capability} className="nc-system-card__cap">
                  {capability}
                </span>
              ))}
            </span>
            <span className="nc-system-card__foot">
              <i aria-hidden="true" />
              {system.status}
              {system.href ? " · opens the existing system" : <span className="nc-system-card__mock"> · mocked</span>}
            </span>
          </>
        );

        const style = cssVars({ "--nc-accent": `var(${system.accentVar})` });

        return system.href ? (
          <a
            key={system.id}
            className="nc-system-card nc-hover-depth"
            data-kind={system.statusKind}
            style={style}
            href={system.href}
          >
            {body}
          </a>
        ) : (
          <button
            key={system.id}
            type="button"
            className="nc-system-card nc-hover-depth"
            data-kind={system.statusKind}
            style={style}
            onClick={() => notify(`${system.name} is a visual placeholder in UI-01 — no integration exists yet.`)}
          >
            {body}
          </button>
        );
      })}

      <button
        type="button"
        className="nc-system-card nc-system-card--connect nc-hover-depth"
        onClick={() => notify("Connecting a real system arrives with the Systems area in a later phase.")}
      >
        <IconPlus size={16} />
        Connect New System
      </button>
    </div>
  );
}
