"use client";

import { useEffect, useRef, useState } from "react";
import { DEPARTMENTS, type DepartmentId } from "../state/organization-model";
import { corePlacement, podPlacement, type CameraState, type Placement } from "../state/spatial-camera";
import { isWorkingStatus, needsHumanStatus, type OrganizationVisualState } from "../state/visual-state";
import { cssVars } from "../ui/css-vars";

/**
 * CONNECTION FIELD — the intelligent network (Phase UI-02.2)
 * ──────────────────────────────────────────────────────────
 * UI-02.1 drew the room's wiring as straight `<line>` elements inside one
 * `<svg viewBox="0 0 100 100" preserveAspectRatio="none">`. Geometry was
 * percentages, endpoints were node *centres*, and every link was a chord. The
 * result read as a node diagram: correct, and completely inert.
 *
 * This file keeps the behaviour contract exactly (at rest almost nothing is
 * wired; asking about a space lights it) and rebuilds the drawing:
 *
 *   · CURVES. Every route is a cubic bezier that bows consistently away from
 *     its chord, with one shared handedness, so the field swirls around the
 *     core instead of zig-zagging between points.
 *   · REAL PIXELS. The layer now measures the stage and the nodes (via a
 *     ResizeObserver) and draws in the stage's own pixel space. A percentage
 *     viewBox stretched by `preserveAspectRatio="none"` made curvature and dash
 *     rhythm depend on the window's aspect ratio; in pixel space a 12px bow is
 *     12px on every screen.
 *   · LAYERED STROKE. Each route is two strokes: a soft, blurred outer glow
 *     (`feGaussianBlur`, one shared filter) and a crisp inner line. Colour comes
 *     from the department's own accent, so active routes read cyan / amber /
 *     green / violet without any new palette.
 *   · ATTACHMENT. Routes leave the globe on its rim and land on the edge of the
 *     card facing the core, with a small port marker at the joint. Lines no
 *     longer run to the middle of a node and vanish under it.
 *   · DIRECTION. Only live / focused / handoff routes animate, and only along
 *     the route — a travelling dash and a faint flow line. Idle routes are
 *     hairline quiet.
 *
 * Geometry still comes from the same resolvers the nodes render from
 * (`corePlacement` / `podPlacement`), so a route can never drift from the card
 * it belongs to. Nothing here knows what a department is.
 */

type Point = { x: number; y: number };
type Box = { w: number; h: number };
type Metrics = {
  w: number;
  h: number;
  coreSize: number;
  pods: Partial<Record<DepartmentId, Box>>;
};

/** Pre-measurement defaults: plausible stage-sized values, replaced on mount. */
const DEFAULT_METRICS: Metrics = { w: 1000, h: 440, coreSize: 220, pods: {} };
const FALLBACK_POD: Box = { w: 252, h: 142 };

/**
 * A cubic bezier that bows away from the straight chord. The perpendicular is
 * always taken with the same handedness, which is what makes a radial network
 * swirl in one direction rather than fan out symmetrically.
 */
function arcPath(a: Point, b: Point, bow: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const off = len * bow;
  const c1x = a.x + dx * 0.32 + px * off;
  const c1y = a.y + dy * 0.32 + py * off;
  const c2x = a.x + dx * 0.68 + px * off;
  const c2y = a.y + dy * 0.68 + py * off;
  return [
    `M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`,
    `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}`,
    `${c2x.toFixed(2)} ${c2y.toFixed(2)}`,
    `${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
  ].join(" ");
}

/**
 * Where a route should meet a card: on the rectangle's border, on the side
 * facing `toward`, pushed out by a small gap so the stroke visibly docks rather
 * than disappearing under the node.
 */
function rectEdge(center: Point, toward: Point, box: Box, gap = 5): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const tx = Math.abs(dx) > 0.001 ? box.w / 2 / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 0.001 ? box.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy) || 1;
  return { x: center.x + dx * t + (dx / len) * gap, y: center.y + dy * t + (dy / len) * gap };
}

/** Where a route leaves the globe: on its rim, on the side facing `toward`. */
function rimPoint(center: Point, toward: Point, radius: number, gap = 6): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: center.x + (dx / len) * (radius + gap), y: center.y + (dy / len) * (radius + gap) };
}

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
  const ref = useRef<SVGSVGElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(DEFAULT_METRICS);

  /* Measure the stage and its nodes. The SVG is the stage in miniature, and the
     pods/core are siblings in the same canvas, so one observer keeps the whole
     field in the stage's own pixel space. `offsetWidth/Height` are read because
     they are layout sizes — unaffected by the pods' 3D transform — which is
     exactly the footprint a route should dock against. */
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const host = svg.parentElement;

    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pods: Partial<Record<DepartmentId, Box>> = {};
      host?.querySelectorAll<HTMLElement>(".nc-pod").forEach((el) => {
        const id = el.dataset.department as DepartmentId | undefined;
        if (!id) return;
        pods[id] = { w: el.offsetWidth || FALLBACK_POD.w, h: el.offsetHeight || FALLBACK_POD.h };
      });
      const coreEl = host?.querySelector<HTMLElement>(".nc-core");
      setMetrics({
        w: rect.width,
        h: rect.height,
        coreSize: coreEl?.offsetWidth || DEFAULT_METRICS.coreSize,
        pods,
      });
    };

    measure();
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ro && host) ro.observe(host);
    window.addEventListener("resize", schedule);
    /* Re-measure once the focus transition has settled: the entered space takes
       a different physical form, so its edge moves. */
    const settle = window.setTimeout(measure, 720);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [focused]);

  const { w, h, coreSize, pods } = metrics;
  const toPx = (place: Placement): Point => ({ x: (place.x / 100) * w, y: (place.y / 100) * h });
  const placementFor = (id: DepartmentId): Placement =>
    podPlacement({
      camera,
      department: DEPARTMENTS.find((department) => department.id === id)!,
      isFocused: focused === id,
      isHovered: hovered === id,
      hasFocus: Boolean(focused),
    });

  const corePx = toPx(corePlacement(camera));
  const coreRadius = Math.max(26, coreSize * 0.47);

  /* A space is "lit" when it is doing something a human should know about. */
  const lit = (id: DepartmentId) => {
    const node = visual.departments[id];
    if (!node) return false;
    return isWorkingStatus(node.status) || needsHumanStatus(node.status) || node.needsApproval === true;
  };

  const quiet = Boolean(hovered || focused);
  /* The open space: what is entered wins, otherwise what is hovered. */
  const open = focused ?? hovered;

  const routes = DEPARTMENTS.map((department) => {
    const place = placementFor(department.id);
    const center = toPx(place);
    const box = pods[department.id] ?? FALLBACK_POD;
    const isLit = lit(department.id);
    const isHovered = hovered === department.id;
    const isFocused = focused === department.id;
    const isReceded = quiet && !isHovered && !isFocused && !isLit;
    const state = isFocused ? "focus" : isHovered ? "hover" : isLit ? "live" : "idle";
    const start = rimPoint(corePx, center, coreRadius);
    const end = rectEdge(center, corePx, box);
    const bow = state === "idle" ? 0.1 : 0.16;
    return {
      department,
      state,
      isReceded,
      accent: department.accentVar,
      end,
      d: arcPath(start, end, bow),
    };
  });

  type Segment = { id: string; from: Placement; to: Placement; d: string };
  const handoffs: Segment[] = visual.handoffs.map((handoff) => {
    /* Handoff signals carry department ids as plain strings. */
    const fromId = handoff.from as DepartmentId;
    const toId = handoff.to as DepartmentId;
    const fromPlace = placementFor(fromId);
    const toPlace = placementFor(toId);
    const fromBox = pods[fromId] ?? FALLBACK_POD;
    const toBox = pods[toId] ?? FALLBACK_POD;
    /* Handoffs bow the other way, so a handoff between two spaces is legibly a
       different kind of route from the core's own fan of links. */
    const d = arcPath(
      rectEdge(toPx(fromPlace), toPx(toPlace), fromBox, 4),
      rectEdge(toPx(toPlace), toPx(fromPlace), toBox, 4),
      -0.18,
    );
    return { id: handoff.id, from: fromPlace, to: toPlace, d };
  });

  return (
    <>
      <svg
        ref={ref}
        className="nc-field"
        viewBox={`0 0 ${w.toFixed(1)} ${h.toFixed(1)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        data-quiet={quiet}
        data-open={open ?? undefined}
      >
        <defs>
          {/* One shared blur: a wide, translucent stroke plus this reads as a
              luminous halo without stacking blur filters per route. */}
          <filter id="nc-route-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.4" />
          </filter>
        </defs>

        {/* The organization's own links: core → each space, plus handoffs. */}
        <g className="nc-routes" data-quiet={quiet}>
          {routes.map((route) => (
            <g
              key={route.department.id}
              className="nc-route"
              data-state={route.state}
              data-receded={route.isReceded}
              style={cssVars({ "--nc-wire-accent": `var(${route.accent})` })}
            >
              <path className="nc-route__glow" d={route.d} filter="url(#nc-route-glow)" />
              <path className="nc-route__line" d={route.d} />
              <path className="nc-route__flow" d={route.d} />
              <circle className="nc-route__port" cx={route.end.x} cy={route.end.y} r={2.4} />
            </g>
          ))}

          {handoffs.map((handoff) => (
            <g key={handoff.id} className="nc-route nc-route--handoff" data-state="handoff">
              <path className="nc-route__glow" d={handoff.d} filter="url(#nc-route-glow)" />
              <path className="nc-route__line" d={handoff.d} />
              <path className="nc-route__flow" d={handoff.d} />
            </g>
          ))}
        </g>
      </svg>

      {/* Energy travelling along the connection — the actual "data signal". */}
      {handoffs.map((handoff) => (
        <span
          key={handoff.id}
          className="nc-pulse"
          style={cssVars({
            "--nc-from-x": `${handoff.from.x}%`,
            "--nc-from-y": `${handoff.from.y}%`,
            "--nc-to-x": `${handoff.to.x}%`,
            "--nc-to-y": `${handoff.to.y}%`,
          })}
        />
      ))}
    </>
  );
}
