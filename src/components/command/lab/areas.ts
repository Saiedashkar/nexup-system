/**
 * NEXUP COMMAND — PRODUCT LAB AREAS
 * ─────────────────────────────────
 * The navigable product, in one list. Every route in the Command product, every
 * second-level navigation and every "view all" link resolves against this file,
 * so an area can never exist as a page nobody can reach, and the rail, the phone
 * bar and the area strip cannot disagree about what the product contains.
 *
 * `group` is the rail area a surface belongs to; `href` is where it lives.
 *
 * PASS 2 — TEXT MOVED OUT. This file is now DATA ONLY: ids, hrefs and group
 * membership. Every visible word (label, short form, blurb) is resolved from the
 * typed dictionary at render time, so `areas.<id>.label` is the single place a
 * surface name is written in English and in Arabic. That is what makes a
 * language switch total instead of partial, and it is why nothing here can drift
 * out of step with what a page actually renders.
 */

import { DEPARTMENT_SLUGS } from "../state/department-workspace";
import type { DepartmentId } from "../state/organization-model";

export type AreaGroup = "command" | "work" | "workforce" | "systems" | "capabilities" | "control" | "exec";

export type AreaId =
  | "command-center"
  | "missions"
  | "projects"
  | "clients"
  | "workforce"
  | "decisions"
  | "finance"
  | "activity"
  | "systems"
  | "models"
  | "exec"
  | "talk";

export type Area = {
  id: AreaId;
  href: string;
  group: AreaGroup;
  /** Which rail area lights up while this surface is open. */
  railArea: string;
};

export const AREAS: Area[] = [
  { id: "command-center", href: "/command", group: "command", railArea: "command" },
  { id: "missions", href: "/command/missions", group: "work", railArea: "work" },
  { id: "projects", href: "/command/projects", group: "work", railArea: "work" },
  { id: "clients", href: "/command/clients", group: "work", railArea: "work" },
  { id: "workforce", href: "/command/workforce", group: "workforce", railArea: "workforce" },
  { id: "decisions", href: "/command/decisions", group: "control", railArea: "control" },
  { id: "finance", href: "/command/finance", group: "control", railArea: "control" },
  { id: "activity", href: "/command/activity", group: "control", railArea: "control" },
  { id: "systems", href: "/command/systems", group: "systems", railArea: "systems" },
  { id: "models", href: "/command/models", group: "capabilities", railArea: "capabilities" },
  { id: "exec", href: "/command/exec", group: "exec", railArea: "exec" },
  { id: "talk", href: "/command/exec/talk", group: "exec", railArea: "exec" },
];

export const AREA_BY_ID: Record<string, Area> = AREAS.reduce<Record<string, Area>>((acc, area) => {
  acc[area.id] = area;
  return acc;
}, {});

/** The areas inside one group — the second-level navigation. */
export function areasInGroup(group: AreaGroup): Area[] {
  return AREAS.filter((a) => a.group === group);
}

/**
 * The rail's six areas, in order, each pointing at the first surface it opens.
 * EXEC is mounted above them in the rail (it is the core, not an area among
 * them) but it is part of this model so the phone bar and deep links agree.
 */
export const RAIL_AREAS: Array<{ id: RailAreaId; href: string }> = [
  { id: "command", href: "/command" },
  { id: "work", href: "/command/missions" },
  { id: "workforce", href: "/command/workforce" },
  { id: "systems", href: "/command/systems" },
  { id: "capabilities", href: "/command/models" },
  { id: "control", href: "/command/decisions" },
];

/** The six rail areas. Their labels come from `shell.rail.*` in the dictionary. */
export type RailAreaId =
  | "command"
  | "work"
  | "workforce"
  | "systems"
  | "capabilities"
  | "control";

/**
 * Resolve the area a pathname belongs to. Longest match wins, so
 * `/command/exec/talk` resolves to Talk rather than EXEC.
 */
export function areaForPath(pathname: string): Area | null {
  const exact = AREAS.find((a) => a.href === pathname);
  if (exact) return exact;

  const prefixMatches = AREAS.filter(
    (a) => a.href !== "/command" && (pathname.startsWith(`${a.href}/`) || pathname === a.href),
  ).sort((a, b) => b.href.length - a.href.length);

  return prefixMatches[0] ?? (pathname.startsWith("/command") ? AREA_BY_ID["command-center"] : null);
}

/** Where a mission detail page lives. One resolver, used by every table row. */
export function missionHref(id: string): string {
  return `/command/missions/${id}`;
}

/** Where an agent detail page lives. */
export function agentHref(id: string): string {
  return `/command/workforce/${id}`;
}

/**
 * Where a department's workspace lives (the pre-existing UI-03 route).
 *
 * Delegates to the ONE slug table in `department-workspace.ts` rather than
 * keeping a second copy — the duplicate map is exactly how a sixth department
 * ends up reachable from the graph but 404 from a link.
 */
export function departmentHref(id: DepartmentId | string): string {
  const slug = DEPARTMENT_SLUGS[id as DepartmentId];
  return `/command/departments/${slug ?? id}`;
}

/** Where a project detail lives (the list route anchors on the card id). */
export function projectHref(id: string): string {
  return `/command/projects#${id}`;
}

/** Where a client detail lives (the list route anchors on the card id). */
export function clientHref(id: string): string {
  return `/command/clients#${id}`;
}
