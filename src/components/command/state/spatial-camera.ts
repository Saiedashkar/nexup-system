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
 * So the camera is now a fixed frame and the *room* re-stages around it:
 *
 *   · the focused space is re-placed on the workspace anchor, and takes a much
 *     larger physical form (the DepartmentPod changes shape, not just size);
 *   · the Intelligence Core relocates to its own anchor and STAYS VISIBLE, so
 *     the environment still has a centre of gravity;
 *   · every other space drifts outward and falls deeper into the room, which is
 *     how "unrelated work recedes" reads as architecture rather than as a
 *     dimmed card;
 *   · the camera itself holds still. `scale` stays in the contract because a
 *     later phase (mission level, war room) will use it — but the level change
 *     no longer depends on it.
 *
 * Everything here is pure arithmetic on percentages and px. No DOM, no React.
 */

import { EXECUTIVE, type Department } from "./organization-model";

/** Logical levels of the spatial hierarchy. Later phases add team/agent/job. */
export type SceneLevel = "organization" | "department";

export type CameraState = {
  level: SceneLevel;
  /** Uniform scale of the canvas. 1 at both levels: re-staging carries focus. */
  scale: number;
  /** Canvas translation, in percent of the stage (matches the CSS transform). */
  x: number;
  y: number;
  /** How far the focused department travels forward, in px. */
  focusDepth: number;
  /** How far the remaining departments recede, in px (negative). */
  recedeDepth: number;
};

/**
 * Camera constants. Exported so the CSS can be read against them and so a later
 * phase can drive the same numbers from a config rather than a literal.
 */
export const CAMERA_TUNING = {
  /** Overview: the scene sits still and level. */
  overview: { scale: 1, x: 0, y: 0 },
  /** Focus: the frame does not move. The room rearranges inside it. */
  focus: { scale: 1, x: 0, y: 0 },
  /** Where the room re-stages its pieces when a space is entered. */
  placement: {
    /** The workspace anchor — where the entered space is re-placed, in percent. */
    workspace: { x: 64, y: 52 },
    /** Where the core relocates so it stays an anchor without owning the frame. */
    core: { x: 17, y: 32 },
    /**
     * Receded spaces drift outward by this share of their distance from the
     * core. Small on purpose: the room must still read as one place, so the
     * recede is a lean, not an evacuation.
     */
    spread: 0.18,
  },
  /** Depth, in px. Positive is toward the viewer. */
  depth: {
    /** Absolute depth of the entered space, so every workspace is the same size. */
    focus: 110,
    recede: -120,
    hover: 46,
  },
} as const;

/** The camera at rest — organization overview. */
export const OVERVIEW_CAMERA: CameraState = {
  level: "organization",
  scale: CAMERA_TUNING.overview.scale,
  x: CAMERA_TUNING.overview.x,
  y: CAMERA_TUNING.overview.y,
  focusDepth: CAMERA_TUNING.depth.focus,
  recedeDepth: CAMERA_TUNING.depth.recede,
};

/**
 * Solve the camera for the current level. The frame is identical at both
 * levels — see the header — so this returns overview values while still
 * reporting the level, which the room layers read to change their own light.
 */
export function cameraFor(focused: Department | null): CameraState {
  if (!focused) return OVERVIEW_CAMERA;
  const { focus } = CAMERA_TUNING;
  return {
    level: "department",
    scale: focus.scale,
    x: focus.x,
    y: focus.y,
    focusDepth: CAMERA_TUNING.depth.focus,
    recedeDepth: CAMERA_TUNING.depth.recede,
  };
}

/** The canvas transform for a camera state. `transform-origin` is 0 0 in CSS. */
export function cameraTransform(camera: CameraState): string {
  return `translate(${camera.x.toFixed(4)}%, ${camera.y.toFixed(4)}%) scale(${camera.scale})`;
}

/** Percent-of-stage position for any node. */
export type Placement = { x: number; y: number; depth: number };

/** Where the Intelligence Core stands right now. It only ever relocates. */
export function corePlacement(camera: CameraState): Placement {
  if (camera.level === "organization") {
    return { x: EXECUTIVE.x, y: EXECUTIVE.y, depth: EXECUTIVE.depth };
  }
  const { core } = CAMERA_TUNING.placement;
  return { x: core.x, y: core.y, depth: EXECUTIVE.depth };
}

/**
 * Where a space stands right now. This is the single place that decides whether
 * a node is the workspace, receded, hovered or at rest — hover wins over
 * recede, so hovering a background space still feels responsive without
 * breaking the focus hierarchy.
 */
export function podPlacement({
  camera,
  department,
  isFocused,
  isHovered,
  hasFocus,
}: {
  camera: CameraState;
  department: Department;
  isFocused: boolean;
  isHovered: boolean;
  hasFocus: boolean;
}): Placement {
  if (isFocused) {
    const { workspace } = CAMERA_TUNING.placement;
    return { x: workspace.x, y: workspace.y, depth: CAMERA_TUNING.depth.focus };
  }

  if (hasFocus) {
    const { spread } = CAMERA_TUNING.placement;
    return {
      x: department.x + (department.x - EXECUTIVE.x) * spread,
      y: department.y + (department.y - EXECUTIVE.y) * spread,
      depth: department.depth + camera.recedeDepth,
    };
  }

  if (isHovered) {
    return { x: department.x, y: department.y, depth: department.depth + CAMERA_TUNING.depth.hover };
  }

  return { x: department.x, y: department.y, depth: department.depth };
}

/**
 * Reference depth for the SVG wiring layer. Lines are painted in the plane of
 * the pods' *bases*, so a promoted pod's wire stays under it rather than
 * floating in front of the core.
 */
export const WIRE_DEPTH = { near: 8, far: -40 } as const;
