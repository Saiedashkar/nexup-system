/**
 * NEXUP COMMAND — SPATIAL CAMERA (Phase UI-02.1)
 * ───────────────────────────────────────────────
 * One logical camera owns where the scene is looking. Components never invent
 * their own transform arithmetic: the CommandScene asks this module for a
 * `CameraState` and applies it to the canvas, and every node asks the same
 * module where it should stand.
 *
 * WHY THE CAMERA NO LONGER ZOOMS
 * UI-02.1's first pass focused a department by scaling the whole canvas 1.06×
 * and pushing one pod forward. The reviewer read that — correctly — as "an
 * enlarged card". Scaling a canvas cannot communicate entering a place, because
 * everything else on screen stays exactly where it was, only smaller.
 *
 * So the camera is now a fixed frame and the *room* re-stages around it.
 *
 * THE CALM-OVERVIEW PASS TAKES THE RE-STAGING OUT
 * Re-staging existed to serve "entering a space" — the focused pod became a
 * large internal workspace (a mode rail and three panels) and everything else
 * drifted outward and fell back. The direction removed that: nodes carry an
 * icon, a name and one status, and DETAILS APPEAR IN A CONTEXTUAL PANEL instead
 * of inside the node. With no in-node workspace to make room for, relocating
 * seven objects to say "selected" would be motion with no meaning.
 *
 * So selecting a space is now a HIGHLIGHT, not a move: every node keeps the
 * position the organization configuration gave it, the camera never leaves the
 * overview frame, and `podPlacement` varies only by hover depth. The contract
 * (`CameraState`, `Placement`) is unchanged, so nothing downstream needed a
 * different shape — and `scale` stays because a later phase (mission level, war
 * room) will use it.
 *
 * Everything here is pure arithmetic on percentages and px. No DOM, no React.
 */

import { EXECUTIVE, type Department } from "./organization-model";

/** Logical levels of the spatial hierarchy. Later phases add team/agent/job. */
export type SceneLevel = "organization" | "department";

export type CameraState = {
  level: SceneLevel;
  /** Uniform scale of the canvas. 1 at the organization level. */
  scale: number;
  /** Canvas translation, in percent of the stage (matches the CSS transform). */
  x: number;
  y: number;
};

/**
 * Camera constants. Exported so the CSS can be read against them and so a later
 * phase can drive the same numbers from a config rather than a literal.
 */
export const CAMERA_TUNING = {
  /** Overview: the scene sits still and level. */
  overview: { scale: 1, x: 0, y: 0 },
  /** Selected: the frame does not move either — selection is a highlight. */
  selected: { scale: 1, x: 0, y: 0 },
  /** Depth, in px. Positive is toward the viewer. */
  depth: {
    /** How far a hovered space leans toward the reader. The only motion left. */
    hover: 46,
  },
} as const;

/** The camera at rest — organization overview. */
export const OVERVIEW_CAMERA: CameraState = {
  level: "organization",
  scale: CAMERA_TUNING.overview.scale,
  x: CAMERA_TUNING.overview.x,
  y: CAMERA_TUNING.overview.y,
};

/**
 * The camera at rest. Kept as a function because every scene layer already calls
 * it, and because a later phase (mission level, war room) will genuinely change
 * the frame — at which point this is the one place that decides how.
 */
export function cameraFor(): CameraState {
  return OVERVIEW_CAMERA;
}

/** The canvas transform for a camera state. `transform-origin` is 0 0 in CSS. */
export function cameraTransform(camera: CameraState): string {
  return `translate(${camera.x.toFixed(4)}%, ${camera.y.toFixed(4)}%) scale(${camera.scale})`;
}

/** Percent-of-stage position for any node. */
export type Placement = { x: number; y: number; depth: number };

/** Where the Intelligence Core stands. Fixed — the entry point is the centre. */
export function corePlacement(): Placement {
  return { x: EXECUTIVE.x, y: EXECUTIVE.y, depth: EXECUTIVE.depth };
}

/**
 * Where a space stands. The configuration's own coordinates, plus the one piece
 * of motion the calm overview keeps: a hovered space leans toward the reader.
 *
 * SELECTION DELIBERATELY DOES NOT MOVE A NODE. It used to — the selected pod
 * became a large internal workspace and the rest of the room drifted outward to
 * make room for it. Details now live in the contextual panel, so there is no
 * workspace inside the node to make room for, and moving seven objects to say
 * "selected" would be motion without meaning. The rail reads the selection.
 */
export function podPlacement({
  department,
  isHovered,
}: {
  department: Department;
  isHovered: boolean;
}): Placement {
  const depth = department.depth + (isHovered ? CAMERA_TUNING.depth.hover : 0);
  return { x: department.x, y: department.y, depth };
}

/**
 * Reference depth for the SVG wiring layer. Lines are painted in the plane of
 * the pods' *bases*, so a promoted pod's wire stays under it rather than
 * floating in front of the core.
 */
export const WIRE_DEPTH = { near: 8, far: -40 } as const;
