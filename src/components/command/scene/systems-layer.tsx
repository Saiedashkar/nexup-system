"use client";

import { SYSTEMS, type DepartmentId } from "../state/organization-model";
import { cssVars } from "../ui/css-vars";
import { IconChevronRight } from "../ui/icons";

/**
 * CONNECTED SYSTEMS LAYER — infrastructure, not cards (Phase UI-02.1)
 * ───────────────────────────────────────────────────────────────────
 * UI-01.1 ended the page with a four-card "Systems" section: NEXUP System,
 * X Publisher, REBOUND, Real Estate, each an equal rounded tile with a status
 * dot. That is an admin dashboard pattern, and it was rejected as one.
 *
 * Systems are not content on a page. They are the endpoints this organization
 * reaches, so they are mounted on the PERIMETER of the room — the walls — and
 * they are drawn at the deepest depth in the scene, which is what makes them
 * read as infrastructure around the work rather than as another section under
 * it.
 *
 * They are also quiet until they matter. Each system declares which spaces reach
 * it (`linkedDepartments` in the configuration, mock data), and:
 *
 *   · at rest   — the layer is present but cold: it is the room's edge;
 *   · entered   — the systems the entered space actually reaches light up, and
 *     the rest fall back. This is the whole point of the layer: Growth reaches
 *     X Publisher, Finance reaches NEXUP System, Operations reaches REBOUND.
 *
 * Nothing is integrated. `href` exists only on NEXUP System, which routes to a
 * surface that already exists in production.
 */

/** Infrastructure sits at the deepest plane of the room. */
export const SYSTEM_DEPTH = -240;

export function SystemsLayer({ focus, onOpen }: { focus: DepartmentId | null; onOpen: (message: string) => void }) {
  return (
    <div className="nc-systems-layer" role="group" aria-label="Connected systems">
      {SYSTEMS.map((system) => {
        const relevant = focus ? system.linkedDepartments.includes(focus) : false;
        const state = focus ? (relevant ? "relevant" : "fallback") : "rest";

        const style = cssVars({
          "--nc-node-x": `${system.perimeter.x}%`,
          "--nc-node-y": `${system.perimeter.y}%`,
          "--nc-node-z": `${SYSTEM_DEPTH}px`,
          "--nc-accent": `var(${system.accentVar})`,
        });

        const body = (
          <>
            {/* The hatch: a mounting plate on the room's wall. */}
            <span className="nc-sysnode__hatch" aria-hidden="true">
              <i />
              <i />
            </span>

            <span className="nc-sysnode__body">
              <span className="nc-sysnode__mark" aria-hidden="true">
                {system.mark}
              </span>
              <span className="nc-sysnode__text">
                <span className="nc-sysnode__name">{system.name}</span>
                <span className="nc-sysnode__meta">
                  <span className="nc-sysnode__dot" aria-hidden="true" />
                  {system.status}
                  <span className="nc-sysnode__kind">{system.kind}</span>
                </span>
              </span>
              <span className="nc-sysnode__go" aria-hidden="true">
                <IconChevronRight size={13} />
              </span>
            </span>
          </>
        );

        return system.href ? (
          <a
            key={system.id}
            className="nc-sysnode"
            data-state={state}
            data-role={system.role ?? "endpoint"}
            style={style}
            href={system.href}
            title={`${system.name} — opens the existing system. Capabilities: ${system.capabilities.join(", ")}.`}
          >
            {body}
          </a>
        ) : (
          <button
            key={system.id}
            type="button"
            className="nc-sysnode"
            data-state={state}
            data-role={system.role ?? "endpoint"}
            style={style}
            title={`${system.name} — capabilities: ${system.capabilities.join(", ")}.`}
            onClick={() =>
              onOpen(
                relevant
                  ? `${system.name} is reached by this space in the model — visual only, nothing is connected.`
                  : `${system.name} is a perimeter endpoint in the model — no integration exists yet.`,
              )
            }
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
