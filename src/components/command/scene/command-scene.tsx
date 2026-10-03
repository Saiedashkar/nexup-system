"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import { DEPARTMENTS, DEPARTMENT_BY_ID, type DepartmentId } from "../state/organization-model";
import { workspaceHref } from "../state/department-workspace";
import { cameraFor, cameraTransform, corePlacement, podPlacement } from "../state/spatial-camera";
import { ConnectionField } from "./connection-field";
import { DepartmentPod } from "./department-pod";
import { ExecCore } from "./exec-core";
import { FocusHeader } from "./focus-header";
import { SystemsLayer } from "./systems-layer";

/**
 * COMMAND SCENE — the room (Phase UI-02.1)
 * ────────────────────────────────────────
 * The reviewer's verdict on the first pass was exact: five rectangles arranged
 * around a glowing orb, inside a bordered box, is a dashboard with perspective
 * applied. This file is the correction. It now composes ONE room, in five
 * layers, and it owns exactly four decisions:
 *
 *   1. the CAMERA — one `CameraState` applied to one canvas. The frame is fixed;
 *      the room re-stages inside it (see `state/spatial-camera.ts`);
 *   2. the ARCHITECTURE — a back wall, two wings, a ceiling line, one floor
 *      plane and a near-field console edge. This is what turns "a dark box with
 *      things in it" into a place with depth you can read from the corners;
 *   3. the ORDER — core, systems, departments and wiring share one 3D canvas, so
 *      their depth relationship (perimeter −240px · core ±20px · entered space
 *      +110px) is arithmetic rather than decoration;
 *   4. the LEVEL — overview or one space, which the rail, the surface and the
 *      overlays all read from the same store, so everything adapts together.
 *
 * What it does NOT own: what a department is called, what colour it is, how many
 * there are, what its surface does, or which systems it reaches. All of that is
 * configuration.
 */

/** The room itself: architecture, not content. Purely decorative, never focusable. */
function RoomArchitecture() {
  return (
    <div className="nc-room__shell" aria-hidden="true">
      <span className="nc-room__void" />
      <span className="nc-room__ceiling" />
      <span className="nc-room__wing" data-side="left" />
      <span className="nc-room__wing" data-side="right" />
      <span className="nc-room__bay" data-side="left">
        <i />
        <i />
        <i />
      </span>
      <span className="nc-room__bay" data-side="right">
        <i />
        <i />
        <i />
      </span>
      <span className="nc-room__beam" data-side="left" />
      <span className="nc-room__beam" data-side="right" />
      <span className="nc-room__floor" />
      <span className="nc-room__horizon" />
      <span className="nc-room__console" />
    </div>
  );
}

export function CommandScene() {
  const { snapshot, focus, setExecOpen, notify } = useCommand();
  const router = useRouter();
  const [hovered, setHovered] = useState<DepartmentId | null>(null);

  const { visual } = snapshot;
  const focusedDepartment = focus ? DEPARTMENT_BY_ID[focus] : null;
  const focusedVisual = focus ? visual.departments[focus] : null;

  /* Camera is a pure function of the level. It no longer moves the frame — it
     decides where the room re-stages its pieces. */
  const camera = cameraFor(focusedDepartment);
  const core = corePlacement(camera);

  /* A space's live signals: missions from configuration, active actors from the
     live worker activity, attention from the visual state. Only three, ever. */
  const signalsFor = (id: DepartmentId) => {
    const department = DEPARTMENT_BY_ID[id];
    const node = visual.departments[id];
    const activeActors = Object.values(node?.workerActivity ?? {}).filter((level) => level >= 0.25).length;
    const attention = node?.needsApproval || node?.status === "BLOCKED" || node?.status === "ERROR" ? 1 : 0;
    return { missions: department?.missions ?? 0, activeActors, attention };
  };

  return (
    <div
      className="nc-scene"
      data-level={camera.level}
      data-hovered={hovered ?? undefined}
      /* Escape from a space happens in the store (one level at a time); the
         scene only clears transient hover when the level changes. */
      onPointerLeave={() => setHovered(null)}
    >
      <RoomArchitecture />

      <div className="nc-scene__stage">
        <div className="nc-scene__canvas" style={{ transform: cameraTransform(camera) }}>
          <ConnectionField visual={visual} hovered={hovered} focused={focus} camera={camera} />

          {/* Infrastructure lives deepest and on the perimeter. */}
          <SystemsLayer focus={focus} onOpen={notify} />

          <ExecCore visual={visual.executive} placement={core} onOpen={() => setExecOpen(true)} />

          {DEPARTMENTS.map((department) => (
            <DepartmentPod
              key={department.id}
              department={department}
              visual={visual.departments[department.id]}
              placement={podPlacement({
                camera,
                department,
                isFocused: focus === department.id,
                isHovered: hovered === department.id,
                hasFocus: Boolean(focus),
              })}
              focused={focus === department.id}
              receded={Boolean(focus) && focus !== department.id}
              hovered={hovered === department.id}
              signals={signalsFor(department.id)}
              onHover={setHovered}
              /* Phase UI-03: a department click now OPENS ITS WORKSPACE ROUTE.
                 Full department work belongs on `/command/departments/<slug>`,
                 not in a large overlay inside the overview. The scene's own
                 focus architecture (hover spotlight, recede, the focused
                 workspace, the focus header) is left intact — it still serves
                 previews and context — it is simply no longer the primary
                 click destination. */
              onOpen={(id) => router.push(workspaceHref(id))}
            />
          ))}
        </div>
      </div>

      {focusedDepartment && focusedVisual && (
        <FocusHeader department={focusedDepartment} visual={focusedVisual} />
      )}
    </div>
  );
}
