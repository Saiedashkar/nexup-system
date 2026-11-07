"use client";

import Link from "next/link";
import { useLocale } from "../i18n/command-locale";
import { DEPARTMENTS } from "../state/organization-model";
import { workspaceHref } from "../state/department-workspace";
import {
  NODE_STATUS_TONE,
  departmentStanding,
  topWork,
} from "../state/demo/selectors";
import type { CommandDataset } from "../state/demo/types";
import { DEPARTMENT_ICONS } from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * THE SIX DEPARTMENTS — balanced cards (Pass 3)
 * ─────────────────────────────────────────────
 * This is the home's department grid: SIX spaces, one card each, and nothing else
 * in the grid — so the reading is a complete three-by-two on a desktop, three rows
 * of two on a tablet and one column on a phone, with no orphan card trailing a
 * full row.
 *
 * The Intelligence Core used to be the seventh card here. It was removed because
 * it was a SECOND entry point to the Executive: the action row above already
 * carries "Talk to EXEC" as the page's one primary action, and a card that opens
 * the same console competed with it for the same decision.
 *
 * WHAT CHANGED, AND WHY
 * The graph is the expressive view of the organization, but a graph is a poor way
 * to ANSWER a question. The card grid answers "which space needs me, how loaded
 * is it, and what is it carrying?" — and it does so without the two things that
 * made the previous revision noisy:
 *
 *   · NO OVERLAPPING LABELS. Status is one line INSIDE the card's own grid, so it
 *     can never sit on top of a name that wrapped to two lines.
 *   · NO SECOND FOOT ROW. Director and bottleneck moved to the department's own
 *     workspace, where they are actionable. What stays is exactly what the card is
 *     for: the space, its state, the work it is carrying, and how far that work
 *     has moved.
 *
 * ONE READ, NOT TWO. The cards render from the SAME dataset the figures and the
 * two priority panels above them read (`LabData`), through the same selectors the
 * destination pages use. The previous revision read a second, hand-kept set of
 * department workspaces, so the grid and the figures could — and did — disagree
 * about how much work a space held. Now a card's state, its held count, its live
 * count and its progress are all consequences of the missions that space owns.
 *
 * The one figure that is deliberately NOT a count: the meter is average progress
 * across the space's live work, so an idle card reads 0% rather than pretending
 * to a measurement nobody made.
 */
export function OrganizationCardsView({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();

  /* Ordered by attention, then by how much live work is moving. The sort is
     derived from the read, never configured — so a space that starts needing a
     human rises to the top of this grid on its own. */
  const cards = DEPARTMENTS.map((department) => ({
    department,
    standing: departmentStanding(dataset, department.id),
    work: topWork(dataset, department.id),
  })).sort((a, b) => {
    if (b.standing.held !== a.standing.held) return b.standing.held - a.standing.held;
    return b.standing.live - a.standing.live;
  });

  return (
    <div className="nc-cards" role="list" aria-label={t("cc.cardsAria")}>
      {cards.map(({ department, standing, work }) => {
        const Icon = DEPARTMENT_ICONS[department.id];
        return (
          <Link
            key={department.id}
            className="nc-card"
            href={workspaceHref(department.id)}
            role="listitem"
            style={cssVars({ "--nc-accent": `var(${department.accentVar})` })}
            data-attention={standing.held > 0}
            title={t("cc.openDepartment", { name: t(`dept.${department.id}.name`) })}
          >
            <span className="nc-card__head">
              <span className="nc-card__mark" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="nc-card__id">
                <span className="nc-card__name">{t(`dept.${department.id}.name`)}</span>
                <span className="nc-card__cap">{t(`dept.${department.id}.capability`)}</span>
              </span>
              {/* One status line, inside the grid. Never over the name. */}
              <span
                className="nc-card__status"
                style={cssVars({ "--nc-accent": `var(${NODE_STATUS_TONE[standing.status]})` })}
              >
                <span className="nc-card__led" aria-hidden="true" />
                {t(`status.node.${standing.status}`)}
              </span>
            </span>

            <span className="nc-card__job">
              {work ? tc(work.title) : t(`dept.${department.id}.insight`)}
            </span>

            <span className="nc-card__figures">
              <span className="nc-card__figure" data-attention={standing.held > 0}>
                <b>{standing.held}</b>
                <span>{t("cc.cardAttention")}</span>
              </span>
              <span className="nc-card__figure">
                <b>{standing.live}</b>
                <span>{t("cc.cardMissions")}</span>
              </span>
              <span className="nc-card__figure">
                <b>{standing.progress}%</b>
                <span>{t("cc.cardProgress")}</span>
              </span>
            </span>

            <span className="nc-card__meter" aria-hidden="true">
              <i style={{ width: `${standing.progress}%` }} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
