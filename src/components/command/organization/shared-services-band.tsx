"use client";

import Link from "next/link";
import { useLocale } from "../i18n/command-locale";
import { SHARED_SERVICES } from "../state/organization-model";
import { workspaceHref } from "../state/department-workspace";
import { DEPARTMENT_ICONS } from "../ui/icons";
import { cssVars } from "../ui/css-vars";

/**
 * SHARED SERVICES — one band, read in every reading of the home
 * ────────────────────────────────────────────────────────────
 * Knowledge, memory, skills and model information are capability the six
 * departments READ FROM, so they are not a seventh space: putting them in the
 * room would either have made them compete with the departments or implied they
 * had a P&L of their own.
 *
 * That is a placement decision, not a removal. The surface, its route and its
 * eight modes are unchanged, and this band is how a reader still reaches them —
 * it renders in ALL THREE readings (overview, cards, list) and on the phone,
 * because it is composed once, outside the reading switch, rather than being
 * repeated inside each one.
 *
 * `provides` holds display KEYS, not English words: each chip resolves from
 * `shared.provides.<key>`, so the band cannot become the one place Arabic chrome
 * shows English.
 */
export function SharedServicesBand() {
  const { t } = useLocale();

  return (
    <section className="nc-shared" aria-label={t("shared.title")}>
      <header className="nc-shared__head">
        <h2 className="nc-shared__title">{t("shared.title")}</h2>
        <span className="nc-shared__note">{t("shared.note")}</span>
      </header>

      <ul className="nc-shared__list">
        {SHARED_SERVICES.map((service) => {
          const Icon = DEPARTMENT_ICONS[service.id];
          const name = t(`dept.${service.id}.name`);
          return (
            <li key={service.id} className="nc-shared__item">
              <Link
                className="nc-shared__link"
                href={workspaceHref(service.id)}
                style={cssVars({ "--nc-accent": `var(${service.accentVar})` })}
                aria-label={t("shared.open", { name })}
              >
                <span className="nc-shared__mark" aria-hidden="true">
                  <Icon size={16} />
                </span>

                <span className="nc-shared__stack">
                  <span className="nc-shared__name">
                    {name}
                    <span className="nc-shared__kind">{t("shared.label")}</span>
                  </span>
                  <span className="nc-shared__brief">{t(`dept.${service.id}.brief`)}</span>
                </span>

                <span className="nc-shared__chips">
                  {service.provides.map((key) => (
                    <span key={key} className="nc-shared__chip">
                      {t(`shared.provides.${key}`)}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
