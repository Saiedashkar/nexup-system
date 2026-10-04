"use client";

import Link from "next/link";
import { useCommand } from "./state/command-store";
import { FOUNDER } from "./state/organization-model";
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
 */
const AREAS = [
  { id: "command", label: "Command", Icon: IconCommand, ready: true },
  { id: "work", label: "Work", Icon: IconWork, ready: false },
  { id: "workforce", label: "Workforce", Icon: IconWorkforce, ready: false },
  { id: "systems", label: "Systems", Icon: IconSystems, ready: false },
  { id: "capabilities", label: "Capabilities", Icon: IconCapabilities, ready: false },
  { id: "control", label: "Control", Icon: IconControl, ready: false },
] as const;

export function GlobalNav() {
  const { notify } = useCommand();

  return (
    <nav className="nc-rail" aria-label="NEXUP COMMAND areas">
      <div className="nc-rail__brand">
        <span className="nc-rail__wordmark">NEXUP</span>
        <span className="nc-rail__sub">Command</span>
      </div>

      {/* EXEC sits ABOVE the six areas: it is the central intelligence, not one
          area among them. Phase UI-05 gives it its own route. */}
      <Link className="nc-rail__exec" href="/command/exec">
        <span className="nc-rail__exec-glyph">
          <IconExec size={17} />
        </span>
        <span className="nc-rail__exec-label">EXEC</span>
      </Link>

      <div className="nc-rail__nav">
        {AREAS.map(({ id, label, Icon, ready }) => (
          <button
            key={id}
            type="button"
            className="nc-nav-item"
            aria-current={ready ? "page" : undefined}
            onClick={() =>
              ready ? undefined : notify(`${label} is a later phase — Command is the only area built in UI-01.`)
            }
          >
            <span className="nc-nav-item__glyph">
              <Icon size={18} />
            </span>
            <span className="nc-nav-item__label">{label}</span>
            {!ready && <span className="nc-nav-item__soon">soon</span>}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="nc-rail__create"
        onClick={() => notify("Create / Do — the creation surface arrives in a later phase.")}
      >
        <IconCreate size={17} />
        <span className="nc-rail__create-label">Create / Do</span>
      </button>

      <div className="nc-rail__foot">
        <div className="nc-rail__os">
          <span className="nc-rail__os-orb" aria-hidden="true" />
          <span className="nc-rail__os-label">NEXUP OS</span>
          <span className="nc-rail__os-version">v0.1</span>
        </div>

        <div className="nc-rail__user">
          <span className="nc-avatar" style={{ width: 32, height: 32, fontSize: 12 }} aria-hidden="true">
            {FOUNDER.initials}
          </span>
          <span className="nc-rail__user-text">
            <span className="nc-rail__user-name">{FOUNDER.name}</span>
            <span className="nc-rail__user-role">
              <i aria-hidden="true" />
              Founder
            </span>
          </span>
          <button
            type="button"
            className="nc-rail__gear"
            aria-label="Settings"
            onClick={() => notify("Control · settings and authority arrive in a later phase.")}
          >
            <IconGear size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
