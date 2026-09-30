"use client";

import { useCommand } from "./state/command-store";
import { ExecutiveDockOrb } from "./executive-dock";
import {
  IconCallTeam,
  IconMore,
  IconProject,
  IconRun,
  IconTool,
  IconWarRoom,
  IconWorkflow,
} from "./ui/icons";

/**
 * The command dock.
 *
 * One integrated bar rather than two stacked toolbars: the Executive sits at
 * its centre, which is exactly where the operating interface belongs, and the
 * contextual actions flank it. Each action states what it will do to the
 * organization and every one of them is honest that it is a mock in this phase.
 *
 * Hover/active/focus states are CSS-driven (`.nc-dock__action`), so depth and
 * press response stay consistent with the rest of the motion vocabulary instead
 * of being hand-tuned per button — and the whole bar is one tab stop per
 * action, keyboard reachable end to end.
 */
type Action = {
  id: string;
  label: string;
  Icon: typeof IconProject;
  intent: string;
};

const LEFT_ACTIONS: Action[] = [
  { id: "project", label: "New Project", Icon: IconProject, intent: "Draft a project brief and assign a department." },
  { id: "war-room", label: "War Room", Icon: IconWarRoom, intent: "Open a temporary mission room with the relevant agents." },
  { id: "run", label: "Run System", Icon: IconRun, intent: "Ask a connected system to execute one of its capabilities." },
  { id: "team", label: "Call Team", Icon: IconCallTeam, intent: "Pull the right specialists into the conversation." },
];

const RIGHT_ACTIONS: Action[] = [
  { id: "tool", label: "Use Tool", Icon: IconTool, intent: "Invoke a registered capability under policy." },
  { id: "workflow", label: "Create Workflow", Icon: IconWorkflow, intent: "Chain capabilities into a repeatable workflow." },
  { id: "more", label: "More", Icon: IconMore, intent: "More actions surface with the Work and Capabilities areas." },
];

export function CommandDock() {
  const { notify } = useCommand();

  const renderAction = ({ id, label, Icon, intent }: Action) => (
    <button
      key={id}
      type="button"
      className="nc-dock__action"
      onClick={() => notify(`${label}: ${intent}`)}
      title={`${intent} (mocked in UI-01)`}
    >
      <Icon size={22} />
      {label}
    </button>
  );

  return (
    <div className="nc-dock" role="toolbar" aria-label="Command actions">
      {LEFT_ACTIONS.map(renderAction)}
      <ExecutiveDockOrb />
      {RIGHT_ACTIONS.map(renderAction)}
    </div>
  );
}
