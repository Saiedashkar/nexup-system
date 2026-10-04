"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommand } from "./state/command-store";
import { IconCommand, IconControl, IconExec, IconSystems, IconWork, IconWorkforce } from "./ui/icons";

/**
 * MOBILE SHELL NAVIGATION (Phase UI-05)
 * ─────────────────────────────────────
 * On a phone the rail and the context column stand down and this bar takes
 * over: five areas along the thumb line, plus a floating EXEC tab that keeps
 * the executive one tap away from anywhere. Both are inert above 760px —
 * `system.css` only ever displays them on the small screen — so the desktop
 * composition is untouched.
 */
const ITEMS = [
  { id: "command", label: "Command", href: "/command", Icon: IconCommand, ready: true },
  { id: "work", label: "Work", href: null, Icon: IconWork, ready: false },
  { id: "workforce", label: "Workforce", href: null, Icon: IconWorkforce, ready: false },
  { id: "systems", label: "Systems", href: null, Icon: IconSystems, ready: false },
  { id: "control", label: "Control", href: null, Icon: IconControl, ready: false },
] as const;

export function MobileNav() {
  const { notify } = useCommand();
  const pathname = usePathname();

  return (
    <>
      <Link className="nc-exectab" href="/command/exec" aria-label="Open EXEC">
        <IconExec size={24} />
        <span className="nc-exectab__label">EXEC</span>
      </Link>

      <nav className="nc-mobilebar" aria-label="NEXUP COMMAND areas">
        {ITEMS.map(({ id, label, href, Icon, ready }) => {
          const current = ready && pathname === href;
          if (ready && href) {
            return (
              <Link key={id} className="nc-mobilebar__item" href={href} aria-current={current ? "page" : undefined}>
                <Icon size={19} />
                {label}
              </Link>
            );
          }
          return (
            <button
              key={id}
              type="button"
              className="nc-mobilebar__item"
              data-soon="true"
              onClick={() => notify(`${label} is a later phase — Command and EXEC are the areas built so far.`)}
            >
              <Icon size={19} />
              {label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
