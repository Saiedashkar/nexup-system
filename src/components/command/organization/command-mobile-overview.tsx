"use client";

import Link from "next/link";
import { useCommand } from "../state/command-store";
import { DEPARTMENTS, FOUNDER, type DepartmentId } from "../state/organization-model";
import { departmentAttention, totalAttention, workspaceHref } from "../state/department-workspace";
import { DEPARTMENT_ICONS, IconExec, IconMission, IconRun, IconWarRoom } from "../ui/icons";

/**
 * MOBILE COMMAND OVERVIEW (Phase UI-05)
 * ─────────────────────────────────────
 * The desktop Command is a room you look INTO. A phone cannot hold that room,
 * so rather than shrink it, mobile gets its own deliberate composition: EXEC
 * first, then the things you actually reach for with a thumb — start a mission,
 * see what needs you, open a department, call the team. `system.css` shows this
 * only at ≤760px and stands the room down, so neither composition is a
 * compromise of the other.
 */
const STATUS_TONE: Record<string, string> = {
  ACTIVE: "var(--nc-active)",
  THINKING: "var(--nc-thinking)",
  WAITING: "var(--nc-waiting)",
  APPROVAL_REQUIRED: "var(--nc-approval)",
  HANDOFF: "var(--nc-handoff)",
  BLOCKED: "var(--nc-error)",
  IDLE: "var(--nc-idle)",
};

export function CommandMobileOverview() {
  const { snapshot, setExecOpen, notify } = useCommand();
  const { visual } = snapshot;

  /* Read from the same shared source as the graph nodes and the List rows, so
     the mobile summary cannot disagree with a department's own workspace. */
  const needsYou = DEPARTMENTS.filter((d) => departmentAttention(d.id) > 0);
  const needsYouItems = totalAttention();

  const actions = [
    { id: "mission", label: "New mission", Icon: IconMission, run: () => notify("New mission opens in a later phase — mock only.") },
    { id: "exec", label: "Talk to EXEC", Icon: IconExec, run: () => setExecOpen(true) },
    { id: "needs", label: "Needs you", Icon: IconWarRoom, run: () => notify(`${needsYouItems} item(s) need you — mock only.`) },
    { id: "work", label: "Active work", Icon: IconRun, run: () => notify("Active work opens in a later phase — mock only.") },
  ];

  return (
    <section className="nc-mobile-command" aria-label="Command overview">
      <header className="nc-mobile-command__head">
        <span className="nc-avatar" style={{ width: 34, height: 34, fontSize: 12 }} aria-hidden="true">
          {FOUNDER.initials}
        </span>
        <span className="nc-mobile-command__id">
          <span className="nc-mobile-command__hi">Good morning, {FOUNDER.name}</span>
          <span className="nc-mobile-command__meta">Founder · Human authority</span>
        </span>
      </header>

      <button
        type="button"
        className="nc-mobile-command__exec"
        onClick={() => setExecOpen(true)}
      >
        <span className="nc-mobile-command__exec-orb" aria-hidden="true">
          <IconExec size={22} />
        </span>
        <span className="nc-mobile-command__exec-text">
          <span className="nc-mobile-command__exec-title">Talk to EXEC</span>
          {/* Counted, never written down: this line reads the same attention source
              the "Needs you" list below is built from. */}
          <span className="nc-mobile-command__exec-hint">
            {needsYouItems === 0
              ? "Nothing needs you right now"
              : `${needsYouItems} item${needsYouItems === 1 ? "" : "s"} need you`}
          </span>
        </span>
      </button>

      <div className="nc-mobile-command__actions">
        {actions.map(({ id, label, Icon, run }) => (
          <button key={id} type="button" className="nc-mobile-command__action" onClick={run}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      {needsYou.length > 0 && (
        <div className="nc-mobile-command__section">
          <span className="nc-eyebrow">Needs you</span>
          <div className="nc-mobile-command__needs">
            {needsYou.map((d) => (
              <Link key={d.id} className="nc-mobile-command__need" href={workspaceHref(d.id)}>
                <span className="nc-mobile-command__need-dot" style={{ background: "var(--nc-approval)" }} aria-hidden="true" />
                <span>{d.name}</span>
                <span className="nc-mobile-command__need-meta">needs attention</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="nc-mobile-command__section">
        <span className="nc-eyebrow">Departments</span>
        <div className="nc-mobile-command__depts">
          {DEPARTMENTS.map((d) => {
            const Icon = DEPARTMENT_ICONS[d.id as keyof typeof DEPARTMENT_ICONS];
            const status = visual.departments[d.id as DepartmentId]?.status ?? "IDLE";
            return (
              <Link key={d.id} className="nc-mobile-command__dept" href={workspaceHref(d.id)}>
                <span className="nc-mobile-command__dept-icon" style={{ color: `var(${d.accentVar})` }} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="nc-mobile-command__dept-text">
                  <span className="nc-mobile-command__dept-name">{d.name}</span>
                  <span className="nc-mobile-command__dept-cap">{d.capability}</span>
                </span>
                <span className="nc-mobile-command__dept-status" style={{ color: STATUS_TONE[status] ?? "var(--nc-idle)" }}>
                  <i style={{ background: STATUS_TONE[status] ?? "var(--nc-idle)" }} aria-hidden="true" />
                  {status.replace(/_/g, " ")}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
