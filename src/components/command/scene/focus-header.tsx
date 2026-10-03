"use client";

import { useCommand } from "../state/command-store";
import type { Department } from "../state/organization-model";
import { cssVars } from "../ui/css-vars";
import { IconArrowLeft } from "../ui/icons";
import { STATUS_LABEL, type VisualNodeState } from "../state/visual-state";

/**
 * FOCUS HEADER — the destination of a spatial focus (Phase UI-02.1)
 * ────────────────────────────────────────────────────────────────
 * UI-01.1 answered "focus a department" with a 400px modal panel pinned over the
 * right half of the stage. It worked, but it covered the organization — the
 * exact thing the focus transition is supposed to keep in view — and it made
 * entering a space feel like opening a dialog.
 *
 * Here, entering a space changes *the scene*: the pod moves forward, the others
 * recede, the Context Rail becomes that department's context, the deck becomes
 * that department's actions. All this element does is name where you are and
 * offer the one obvious way back. Department detail moved to the rail, where
 * context belongs.
 *
 * It is intentionally slim and sits along the lower-left edge, under the pod's
 * own focal area, so the Intelligence Core — the anchor of the whole
 * environment — is never occluded, at any department position.
 */
export function FocusHeader({ department, visual }: { department: Department; visual: VisualNodeState }) {
  const { clearFocus } = useCommand();

  return (
    <div
      className="nc-focusbar"
      style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
      role="status"
    >
      <button type="button" className="nc-focusbar__back" onClick={clearFocus} aria-label="Back to organization overview">
        <IconArrowLeft size={14} />
        Organization
      </button>

      <span className="nc-focusbar__divider" aria-hidden="true" />

      <span className="nc-focusbar__text">
        <span className="nc-focusbar__space">{department.space}</span>
        <span className="nc-focusbar__name">{department.name}</span>
      </span>

      <span className="nc-focusbar__state">
        <span className="nc-focusbar__led" aria-hidden="true" />
        {STATUS_LABEL[visual.status]} · {Math.round(visual.activityLevel * 100)}%
      </span>
    </div>
  );
}
