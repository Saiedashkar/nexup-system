"use client";

import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import { DEPARTMENTS, EXECUTIVE } from "../state/organization-model";
import { departmentAttention, workspaceHref } from "../state/department-workspace";
import { DEPARTMENT_ICONS, IconMap, IconSpark } from "../ui/icons";
import { cssVars } from "../ui/css-vars";
import { STATUS_LABEL } from "../state/visual-state";

/**
 * The List view.
 *
 * A genuine second view of the *same* live state, not a decorative toggle: the
 * exact snapshot that drives the ring renders here as rows. That buys three
 * things the spatial view cannot give on its own — density for scanning,
 * predictable keyboard order, and a screen-reader-friendly reading of the whole
 * organization. The spatial view is the hero; this one is the accessible twin.
 */
export function OrganizationListView() {
  const { snapshot, setExecOpen, execOpen } = useCommand();
  const router = useRouter();

  const rows = [
    {
      key: EXECUTIVE.id,
      Icon: IconSpark,
      name: EXECUTIVE.label,
      capability: EXECUTIVE.kicker,
      accentVar: "--nc-lime",
      visual: snapshot.visual.executive,
      attention: snapshot.visual.executive.needsApproval ? 1 : 0,
      onOpen: () => setExecOpen(true),
      action: "Open the Executive console",
    },
    ...DEPARTMENTS.map((department) => ({
      key: department.id,
      Icon: DEPARTMENT_ICONS[department.id],
      name: department.name,
      capability: department.capability,
      accentVar: department.accentVar,
      visual: snapshot.visual.departments[department.id],
      /* Needs-attention is the SAME number the workspace page shows, read from
         one shared source, so the row can never disagree with the space. */
      attention: departmentAttention(department.id),
      /* Phase UI-03: rows open the department's workspace route. */
      onOpen: () => router.push(workspaceHref(department.id)),
      action: "Open department workspace",
    })),
  ];

  return (
    <div className="nc-list">
      <div className="nc-list__headrow" aria-hidden="true">
        <span />
        <span>Node</span>
        <span>Status</span>
        <span>Current work</span>
        <span>Activity</span>
        <span>Attention</span>
      </div>

      <ul style={{ display: "contents" }}>
        {rows.map(({ key, Icon, name, capability, accentVar, visual, attention, onOpen, action }) => (
          <li key={key} style={{ display: "contents" }}>
            <button
              type="button"
              className="nc-list__row"
              data-status={visual.status}
              style={cssVars({ "--nc-accent": `var(${accentVar})` })}
              onClick={onOpen}
              aria-current={key === EXECUTIVE.id && execOpen ? true : undefined}
              aria-label={`${name} — ${STATUS_LABEL[visual.status]}. ${
                visual.activeJob ?? capability
              }. Activity ${Math.round(visual.activityLevel * 100)} percent.${
                attention > 0 ? ` Needs attention: ${attention}.` : ""
              } ${action}.`}
            >
              <span className="nc-list__icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="nc-list__name" style={{ display: "block" }}>
                  {name}
                </span>
                <span className="nc-list__cap" style={{ display: "block" }}>
                  {capability}
                </span>
              </span>
              <span className="nc-list__status">
                <span className="nc-list__led" aria-hidden="true" />
                {STATUS_LABEL[visual.status]}
              </span>
              <span className="nc-list__job">{visual.activeJob ?? "—"}</span>
              <span className="nc-list__meter" aria-hidden="true">
                <i style={{ width: `${Math.round(visual.activityLevel * 100)}%` }} />
              </span>
              <span>
                {attention > 0 ? (
                  <span className="nc-list__flag">Needs you · {attention}</span>
                ) : (
                  <span className="nc-list__none">—</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Map view — deliberately a placeholder.
 *
 * Drawing a business geography would mean inventing locations and a real
 * mapping surface, which is not part of this slice. Rather than fake it, it
 * says exactly what it is, consistent with how the rest of UI-01 labels what
 * is mocked.
 */
export function OrganizationMapView() {
  return (
    <div className="nc-list__placeholder">
      <span className="nc-list__placeholder-mark" aria-hidden="true">
        <IconMap size={22} />
      </span>
      <span className="nc-section__title">Map view arrives in a later phase</span>
      <span className="nc-section__note" style={{ maxWidth: 380 }}>
        A real map needs business locations and a mapping surface. Nothing here is faked — the
        organization, its state and its wiring are all readable in the Graph and List views.
      </span>
    </div>
  );
}
