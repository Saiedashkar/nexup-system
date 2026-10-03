"use client";

import { DEPARTMENTS, SYSTEMS, nodeAnchor, type DepartmentId } from "../state/organization-model";
import { corePlacement, podPlacement, type CameraState, type Placement } from "../state/spatial-camera";
import { isWorkingStatus, needsHumanStatus, type OrganizationVisualState } from "../state/visual-state";
import { cssVars } from "../ui/css-vars";

/**
 * CONNECTION FIELD — the room's wiring (Phase UI-02.1)
 * ────────────────────────────────────────────────────
 * UI-01.1 drew every link all the time at the same weight, which made the scene
 * busy at rest and made hover meaningless. The field now respects one rule: **at
 * rest there is almost no wiring; the wiring appears when you ask about a
 * space.**
 *
 * It carries three kinds of line, and they are deliberately different weights:
 *
 *   · SPINE   — every system on the perimeter holds one faint feed to the
 *     Intelligence Core. This is the room's infrastructure, always present,
 *     never loud. It is also what makes the Connected Systems Layer read as
 *     *connected* instead of merely parked at the edges;
 *   · FEEDS   — the systems a space actually reaches. Silent at rest, bright
 *     when that space is entered or hovered: the "systems become relevant when
 *     a department uses them" behaviour, expressed as wiring;
 *   · WIRES   — the organization's own links, core to each space, plus the
 *     travelling signal of a live handoff.
 *
 * Geometry comes from the same resolvers the nodes render from — the camera is a
 * prop, `corePlacement`/`podPlacement` are the scene's own functions — so a wire
 * can never drift from the pod it belongs to, whatever the level is. The whole
 * layer also lives inside the transformed canvas, so it moves with the room.
 */

export function ConnectionField({
  visual,
  hovered,
  focused,
  camera,
}: {
  visual: OrganizationVisualState;
  hovered: DepartmentId | null;
  focused: DepartmentId | null;
  camera: CameraState;
}) {
  const core = corePlacement(camera);

  const placementFor = (id: DepartmentId): Placement =>
    podPlacement({
      camera,
      department: DEPARTMENTS.find((department) => department.id === id)!,
      isFocused: focused === id,
      isHovered: hovered === id,
      hasFocus: Boolean(focused),
    });

  /* A space is "lit" when it is doing something a human should know about. */
  const lit = (id: DepartmentId) => {
    const node = visual.departments[id];
    if (!node) return false;
    return isWorkingStatus(node.status) || needsHumanStatus(node.status) || node.needsApproval === true;
  };

  const quiet = Boolean(hovered || focused);
  /* The open space: what is entered wins, otherwise what is hovered. */
  const open = focused ?? hovered;

  return (
    <>
      <svg
        className="nc-field"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-quiet={quiet}
      >
        {/* SPINE — infrastructure feeds. Always drawn, never loud. */}
        {SYSTEMS.map((system) => (
          <line
            key={`spine-${system.id}`}
            className="nc-wire nc-wire--spine"
            data-live={open ? system.linkedDepartments.includes(open) : false}
            x1={system.perimeter.x}
            y1={system.perimeter.y}
            x2={core.x}
            y2={core.y}
            style={cssVars({ "--nc-wire-accent": `var(${system.accentVar})` })}
          />
        ))}

        {/* FEEDS — the systems the open space actually reaches. */}
        {open &&
          SYSTEMS.filter((system) => system.linkedDepartments.includes(open)).map((system) => {
            const place = placementFor(open);
            return (
              <line
                key={`feed-${system.id}`}
                className="nc-wire nc-wire--feed"
                x1={place.x}
                y1={place.y}
                x2={system.perimeter.x}
                y2={system.perimeter.y}
                style={cssVars({ "--nc-wire-accent": `var(${system.accentVar})` })}
              />
            );
          })}

        {/* WIRES — the organization's own links. */}
        {DEPARTMENTS.map((department) => {
          const isLit = lit(department.id);
          const isHovered = hovered === department.id;
          const isFocused = focused === department.id;
          const isReceded = quiet && !isHovered && !isFocused && !isLit;
          const place = placementFor(department.id);

          return (
            <line
              key={department.id}
              className="nc-wire"
              data-live={isLit}
              data-focus={isHovered || isFocused}
              data-receded={isReceded}
              x1={core.x}
              y1={core.y}
              x2={place.x}
              y2={place.y}
              style={cssVars({ "--nc-wire-accent": `var(${department.accentVar})` })}
            />
          );
        })}

        {visual.handoffs.map((handoff) => {
          const from = nodeAnchor(handoff.from);
          const to = nodeAnchor(handoff.to);
          if (!from || !to) return null;
          return (
            <line
              key={handoff.id}
              className="nc-wire nc-wire--handoff"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
      </svg>

      {/* Energy travelling along the connection — the actual "data signal". */}
      {visual.handoffs.map((handoff) => {
        const from = nodeAnchor(handoff.from);
        const to = nodeAnchor(handoff.to);
        if (!from || !to) return null;
        return (
          <span
            key={handoff.id}
            className="nc-pulse"
            style={cssVars({
              "--nc-from-x": `${from.x}%`,
              "--nc-from-y": `${from.y}%`,
              "--nc-to-x": `${to.x}%`,
              "--nc-to-y": `${to.y}%`,
            })}
          />
        );
      })}
    </>
  );
}
