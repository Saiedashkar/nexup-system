"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import { workspaceHref } from "../state/department-workspace";
import { DEPARTMENTS, type DepartmentId } from "../state/organization-model";
import { AREA_BY_ID } from "../lab/areas";
import { useOnScreen } from "../state/use-on-screen";
import { cameraFor, cameraTransform, corePlacement, podPlacement } from "../state/spatial-camera";
import { cssVars } from "../ui/css-vars";
import { ConnectionField } from "./connection-field";
import { DepartmentPod } from "./department-pod";
import { ExecCore } from "./exec-core";
import { SystemsLayer } from "./systems-layer";
import { DemoHandoffPill } from "../organization/demo-handoff";

/**
 * THE PEARL ORBITS (champagne-orbit pass)
 * ───────────────────────────────────────
 * Three pearl bands around the centre, each on its own ellipse and each turning
 * at its own slow rate. The angles are configuration, not markup: a pearl is a
 * dot at an angle, and the band it belongs to owns its scale and its speed — so
 * the whole family is three data rows and one CSS rule, and a reviewer can see
 * exactly where a pearl sits by reading a number.
 *
 * ONE pearl per scene is the travelling light (`live: true`): brighter, larger,
 * and on the faster band, which is what makes the rings read as circulating
 * rather than as static drawn ellipses. All of it is decoration: the layer is
 * `aria-hidden`, it carries no text, and nothing here is focusable.
 */
const PEARL_BANDS = [
  { band: "near", angles: [18, 138, 262], live: 138 },
  { band: "outer", angles: [78, 196, 318], live: 318 },
  { band: "far", angles: [4, 104, 214, 332], live: 104 },
] as const;

/**
 * COMMAND SCENE — the organization composition (calm-overview pass)
 * ────────────────────────────────────────────────────────────────
 * ONE composition, read calmly: a modest central entry point (NEXUP/EXEC), six
 * balanced department nodes around it, and thin restrained connections between
 * them. This is the Command home's primary reading, and it is deliberately not a
 * dashboard: every node states a name and one status, and the detail belongs to
 * the contextual panel.
 *
 * WHAT THIS FILE LOST, AND WHY IT IS BETTER FOR IT
 * The previous revision composed five layers around a re-staging camera: a
 * focused pod became a large internal WORKSPACE (a mode rail, a work panel,
 * signals and the systems it reaches), everything else receded, and a focus
 * header overlaid the room. That was a department dashboard living inside the
 * overview, and the direction names the cost explicitly — "do not place full
 * department dashboards inside every node", "details appear on selection in a
 * contextual panel".
 *
 * So:
 *   · the camera no longer re-stages (see `state/spatial-camera.ts`);
 *   · selecting a space SELECTS it — the node highlights, and the contextual
 *     panel becomes that space's own panel, with a deliberate link to the full
 *     workspace route for readers who want the whole surface;
 *   · the focus header is gone: the panel already says which space is open, and
 *     a second, floating title over the room was a competing centre of gravity.
 *
 * WHAT IT STILL OWNS: the architecture (one back wall, one floor grid, one
 * horizon), the ORDER (nodes and wiring share one canvas, so their depth
 * relationship is arithmetic), the wiring, and the hover state — one space lit,
 * the rest quiet. Everything about a department comes from configuration.
 */

/** The room itself: architecture, not content. Purely decorative, never focusable. */
function RoomArchitecture() {
  return (
    <div className="nc-room__shell" aria-hidden="true">
      <span className="nc-room__void" />
      <span className="nc-room__ceiling" />
      <span className="nc-room__wing" data-side="left" />
      <span className="nc-room__wing" data-side="right" />
      <span className="nc-room__beam" data-side="left" />
      <span className="nc-room__beam" data-side="right" />
      <span className="nc-room__floor" />
      <span className="nc-room__horizon" />
    </div>
  );
}

export function CommandScene({ onDemoHandoff }: { onDemoHandoff?: () => void }) {
  const { snapshot, focus, focusDepartment, notify } = useCommand();
  const router = useRouter();
  const [hovered, setHovered] = useState<DepartmentId | null>(null);
  /* MOTION COSTS NOTHING OFF SCREEN. The room turns, travels light and breathes;
     the phone never shows it at all, and a desktop reader can scroll it out of
     view. One observer answers the only question that matters — is anybody
     looking? — and `violet.css` pauses every animated layer on the answer. */
  const { ref: sceneRef, onScreen } = useOnScreen<HTMLDivElement>();

  const { visual } = snapshot;
  const camera = cameraFor();
  const core = corePlacement();

  /* EXEC's destination. Resolved from the ONE area table so the entry point and
     the rail nav cannot disagree about where EXEC lives. */
  const execHref = AREA_BY_ID.exec?.href ?? "/command/exec";

  return (
    <div
      ref={sceneRef}
      className="nc-scene"
      data-level={camera.level}
      data-live={onScreen}
      data-hovered={hovered ?? undefined}
      data-selected={focus ?? undefined}
      /* Escape from a selected space happens in the store (one level at a
         time); the scene only clears transient hover when the pointer leaves. */
      onPointerLeave={() => setHovered(null)}
    >
      <RoomArchitecture />

      <div className="nc-scene__stage">
        <div className="nc-scene__canvas" style={{ transform: cameraTransform(camera) }}>
          {/* The orbit: rings, pearls and the veil that seats the centre. It
              sits UNDER the wiring and the nodes, so a plate always reads on top
              of the ring it crosses. */}
          <div className="nc-orbit" aria-hidden="true">
            <span className="nc-orbit__ring" data-ring="outer" />
            <span className="nc-orbit__ring" data-ring="mid" />
            <span className="nc-orbit__ring" data-ring="inner" />
            <span className="nc-orbit__veil" />
            {PEARL_BANDS.map(({ band, angles, live }) => (
              <span key={band} className="nc-orbit__pearls" data-band={band}>
                {angles.map((angle) => (
                  <i
                    key={angle}
                    style={cssVars({ "--a": angle })}
                    data-live={angle === live ? "true" : undefined}
                  />
                ))}
              </span>
            ))}
          </div>

          <ConnectionField
            visual={visual}
            hovered={hovered}
            selected={focus}
            demoHandoff={{ from: "client", to: "creative" }}
          />

          {/* Infrastructure lives deepest, on the perimeter. */}
          <SystemsLayer focus={focus} onOpen={notify} />

          <ExecCore visual={visual.executive} placement={core} href={execHref} />

          {DEPARTMENTS.map((department) => (
            <DepartmentPod
              key={department.id}
              department={department}
              visual={visual.departments[department.id]}
              placement={podPlacement({
                department,
                isHovered: hovered === department.id,
              })}
              selected={focus === department.id}
              receded={Boolean(focus) && focus !== department.id}
              hovered={hovered === department.id}
              onHover={setHovered}
              /* ONE PLATE IS A DOORWAY. Marketing & Sales is the single space
                 whose work lives behind TWO rooms, so its plate opens the gateway
                 (`/command/sales`) on the first press — the destination comes from
                 `workspaceHref`, the same resolver the rail and the phone overview
                 read, so the plate, the list and the phone cannot disagree. Every
                 other plate keeps SELECTION, NOT NAVIGATION: the reader stays in
                 the room, the contextual panel becomes that space's panel, and
                 going deeper stays a deliberate second step. */
              onSelect={(id) =>
                id === "growth" ? router.push(workspaceHref(id)) : focusDepartment(id)
              }
            />
          ))}
        </div>
      </div>

      {/* The demo's one interactive route. It sits on the composition, below
          the character, where the reference's brief pill sits. */}
      {onDemoHandoff && <DemoHandoffPill onOpen={onDemoHandoff} />}
    </div>
  );
}
