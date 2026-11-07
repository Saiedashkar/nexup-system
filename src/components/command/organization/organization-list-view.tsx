"use client";

import { useRouter } from "next/navigation";
import { useCommand } from "../state/command-store";
import { useLocale } from "../i18n/command-locale";
import { DEPARTMENTS, EXECUTIVE } from "../state/organization-model";
import { departmentAttention, workspaceHref } from "../state/department-workspace";
import { DEPARTMENT_ICONS, IconSpark } from "../ui/icons";
import { cssVars } from "../ui/css-vars";

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
  const { t, tc } = useLocale();
  const router = useRouter();

  const rows = [
    {
      key: EXECUTIVE.id,
      Icon: IconSpark,
      name: t("areas.exec.label"),
      capability: t("cc.execKicker"),
      accentVar: "--nc-lime",
      visual: snapshot.visual.executive,
      attention: snapshot.visual.executive.needsApproval ? 1 : 0,
      onOpen: () => setExecOpen(true),
      action: t("cc.openConsoleAria"),
    },
    ...DEPARTMENTS.map((department) => ({
      key: department.id,
      Icon: DEPARTMENT_ICONS[department.id],
      name: t(`dept.${department.id}.name`),
      capability: t(`dept.${department.id}.capability`),
      accentVar: department.accentVar,
      visual: snapshot.visual.departments[department.id],
      /* Needs-attention is the SAME number the workspace page shows, read from
         one shared source, so the row can never disagree with the space. */
      attention: departmentAttention(department.id),
      /* Phase UI-03: rows open the department's workspace route. */
      onOpen: () => router.push(workspaceHref(department.id)),
      action: t("cc.openDeptAria"),
    })),
  ];

  return (
    <div className="nc-list" aria-label={t("cc.listAria")}>
      <div className="nc-list__headrow" aria-hidden="true">
        <span />
        <span>{t("cc.colNode")}</span>
        <span>{t("cc.colStatus")}</span>
        <span>{t("cc.colCurrentWork")}</span>
        <span>{t("cc.colActivity")}</span>
        <span>{t("cc.colAttention")}</span>
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
              aria-label={`${name} — ${t(`status.node.${visual.status}`)}. ${
                visual.activeJob ? tc(visual.activeJob) : capability
              }. ${t("cc.rowActivity", { percent: Math.round(visual.activityLevel * 100) })}${
                attention > 0 ? ` ${t("cc.rowAttention", { count: attention })}.` : ""
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
                {t(`status.node.${visual.status}`)}
              </span>
              <span className="nc-list__job">{visual.activeJob ? tc(visual.activeJob) : "—"}</span>
              <span className="nc-list__meter" aria-hidden="true">
                <i style={{ width: `${Math.round(visual.activityLevel * 100)}%` }} />
              </span>
              <span>
                {attention > 0 ? (
                  <span className="nc-list__flag">
                    {t("cc.needsYouFlag")} · {attention}
                  </span>
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

/*
 * A "Map" reading used to live here — a placeholder that said the map would
 * arrive in a later phase. It is gone for one reason: the home's reading switch
 * offered it, `living-organization` composed nothing for it, and so choosing it
 * left the middle of the page EMPTY. A reading that renders nothing is worse
 * than a reading that does not exist, and the organization's real network map
 * already exists where a network belongs — as the `map` mode inside a
 * department's workspace. The three readings on the home are now exactly the
 * three it composes: overview, cards, list.
 */
