import { CLIENT_LABEL_KEY, EXEC_STATUS_META, TASK_STATUS_META, TEAM_BY_ID } from "./catalog";
import { allCards, choiceIsApproval } from "./engine";
import { formatNumber, t, type Locale, type MessageKey } from "./i18n";
import Image from "next/image";

import { Icon } from "./icons";
import {
  DependenciesPanel,
  TeamPanel,
  TimelinePanel,
} from "./panels";
import { getScenario } from "./scenarios";
import type { Card, Choice, LabelValue, Message, PlanStep, RunState, VerificationItem } from "./types";

/* ═══════════════════════════════════════════════════════
   A message — text first, and only what must be acted on
   ═══════════════════════════════════════════════════════ */

const STEP_LABEL_KEY: Record<PlanStep["state"], MessageKey> = {
  queued: "step.queued",
  running: "step.running",
  done: "step.done",
  blocked: "step.blocked",
};

export function ExecutionSummary({ run, locale, open, onToggle }: {
  run: RunState;
  locale: Locale;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details className="nce-summary" open={open}>
      <summary>
        <button type="button" onClick={() => onToggle(!open)}>
          {t(locale, open ? "summary.close" : "summary.open")}
        </button>
      </summary>
      {open && (
        <div className="nce-panels">
          <TimelinePanel run={run} locale={locale} />
          <TeamPanel run={run} locale={locale} />
          <DependenciesPanel run={run} locale={locale} />
        </div>
      )}
    </details>
  );
}

export function MessageView({ message, locale, approvalChoices, onChoose, avatarSrc, onOpenOutput }: {
  message: Message;
  locale: Locale;
  approvalChoices: Choice[];
  onChoose: (id: string) => void;
  avatarSrc: string;
  onOpenOutput?: () => void;
}) {
  return (
    <div className="nce-msg" data-from={message.from}>
      <span className="nce-msg__avatar">
        {message.from === "exec" ? (
          <span className="nce-face nce-msg__face" data-size="tiny">
            <Image
              className="nce-face__img"
              src={avatarSrc}
              alt={t(locale, "app.portraitAlt")}
              width={28}
              height={28}
              unoptimized
            />
          </span>
        ) : (
          <Icon name="person" />
        )}
      </span>
      <div className="nce-msg__body">
        <p dir="auto">{message.text ?? (message.key ? t(locale, message.key) : "")}</p>
        {approvalChoices.length > 0 && (
          <div className="nce-card__actions">
            {approvalChoices.map((choice) => (
              <button key={choice.id} type="button" onClick={() => onChoose(choice.id)}>
                {t(locale, choice.labelKey)}
              </button>
            ))}
          </div>
        )}
        {message.cards.map((card) => (
          <CardView key={card.id} card={card} locale={locale} onChoose={onChoose} onOpenOutput={onOpenOutput} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Cards — each kind is drawn from its keys, nothing else
   ═══════════════════════════════════════════════════════ */

function KeyValues({ rows, locale }: { rows: LabelValue[]; locale: Locale }) {
  return (
    <dl className="nce-kv">
      {rows.map((row) => (
        <div key={row.labelKey} className="nce-kv__row">
          <dt>{t(locale, row.labelKey)}</dt>
          <dd dir="auto">{t(locale, row.valueKey)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The plan, as one list: each step's owner, its dependencies and its demo state. */
export function PlanView({ steps, locale }: { steps: PlanStep[]; locale: Locale }) {
  return (
    <section id="nce-plan" className="nce-plan" aria-label={t(locale, "card.plan")}>
      <p className="nce-plan__head">
        <span>{t(locale, "card.plan")}</span>
        <span className="nce-summary__progress">
          {t(locale, "card.plan.steps", { count: formatNumber(locale, steps.length) })}
        </span>
      </p>
      <ol className="nce-steps">
        {steps.map((step, index) => {
          const member = TEAM_BY_ID[step.ownerId];
          const refs = step.dependsOn
            .map((id) => steps.findIndex((candidate) => candidate.id === id) + 1)
            .filter((position) => position > 0);
          return (
            <li key={step.id} className="nce-steps__row" data-state={step.state} data-accent={member?.accent}>
              <span className="nce-steps__index">{formatNumber(locale, index + 1)}</span>
              <span className="nce-steps__text">
                <span className="nce-steps__title" dir="auto">{t(locale, step.titleKey)}</span>
                <span className="nce-steps__dep">
                  {refs.length > 0
                    ? t(locale, "card.plan.dependsOn", { refs: refs.map((n) => formatNumber(locale, n)).join(", ") })
                    : t(locale, "card.plan.noDeps")}
                </span>
              </span>
              <span className="nce-steps__owner">
                {member ? t(locale, member.specialtyKey) : ""} · {t(locale, STEP_LABEL_KEY[step.state])}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CardView({ card, locale, onChoose, onOpenOutput }: {
  card: Card;
  locale: Locale;
  onChoose: (id: string) => void;
  onOpenOutput?: () => void;
}) {
  return (
    <div className="nce-card" data-kind={card.kind}>
      {card.kind === "brief" && (
        <>
          <p>{t(locale, "card.brief")}</p>
          <KeyValues rows={card.rows} locale={locale} />
        </>
      )}

      {card.kind === "plan" && <PlanView steps={card.steps} locale={locale} />}

      {card.kind === "delegation" && (
        <>
          <p>{t(locale, "card.delegation")}</p>
          <dl className="nce-kv">
            <div className="nce-kv__row">
              <dt>{t(locale, "card.plan.owner")}</dt>
              <dd>{t(locale, TEAM_BY_ID[card.ownerId].specialtyKey)}</dd>
            </div>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.delegation.deliverable")}</dt>
              <dd dir="auto">{t(locale, card.deliverableKey)}</dd>
            </div>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.delegation.authority")}</dt>
              <dd dir="auto">{t(locale, card.authorityKey)}</dd>
            </div>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.delegation.due")}</dt>
              <dd dir="auto">{t(locale, card.dueKey)}</dd>
            </div>
          </dl>
        </>
      )}

      {card.kind === "gate" && (
        <>
          <p>{t(locale, card.titleKey)}</p>
          <p className="nce-note nce-note--tight">{t(locale, card.bodyKey)}</p>
          <dl className="nce-kv">
            <div className="nce-kv__row">
              <dt>{t(locale, "card.gate.authority")}</dt>
              <dd dir="auto">{t(locale, card.authorityKey)}</dd>
            </div>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.gate.cost")}</dt>
              <dd>{formatNumber(locale, card.cost)}</dd>
            </div>
          </dl>
        </>
      )}

      {card.kind === "evidence" && (
        <>
          <p>{t(locale, "card.evidence")}</p>
          <dl className="nce-kv" data-state={card.state}>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.evidence.claim")}</dt>
              <dd dir="auto">{t(locale, card.claimKey)}</dd>
            </div>
            <div className="nce-kv__row">
              <dt>{t(locale, "card.evidence.source")}</dt>
              <dd dir="auto">{t(locale, card.sourceKey)}</dd>
            </div>
          </dl>
          <p className="nce-note nce-note--tight">
            {t(locale, card.state === "supported" ? "card.evidence.supported" : "card.evidence.unsupported")}
          </p>
        </>
      )}

      {card.kind === "correction" && (
        <>
          <p>{t(locale, "card.correction")}</p>
          <KeyValues
            rows={[
              { labelKey: "card.correction.before", valueKey: card.beforeKey },
              { labelKey: "card.correction.after", valueKey: card.afterKey },
              { labelKey: "card.correction.bound", valueKey: card.boundKey },
            ]}
            locale={locale}
          />
        </>
      )}

      {card.kind === "verification" && (
        <>
          <p>{t(locale, "card.verification")}</p>
          <ul className="nce-verify">
            {card.items.map((item: VerificationItem) => (
              <li key={item.key} data-state={item.state}>
                <span>{t(locale, item.key)}</span>
                <span className="nce-note nce-note--tight">
                  {t(locale, item.state === "supported" ? "card.verification.traceable" : "card.verification.untraceable")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {card.kind === "result" && (
        <section className="nce-result" aria-labelledby={`${card.id}-title`}>
          <div className="nce-result__summary">
            <span className="nce-result__glyph" aria-hidden="true">✓</span>
            <div className="nce-result__copy">
              <h3 id={`${card.id}-title`} className="nce-result__title">
                {t(locale, card.titleKey ?? "card.result.title")}
              </h3>
              <p className="nce-result__description">
                {t(locale, card.descriptionKey ?? "card.result.description")}
              </p>
            </div>
            <span className="nce-result__status">
              <span aria-hidden="true">●</span>
              {t(locale, "card.result.demo")}
            </span>
          </div>

          <div className="nce-card__actions nce-result__actions">
            <button type="button" onClick={onOpenOutput} disabled={!onOpenOutput} aria-describedby={`${card.id}-note`}>
              {t(locale, "card.result.preview")}
            </button>
            <button
              type="button"
              data-variant="primary"
              onClick={onOpenOutput}
              disabled={!onOpenOutput}
              aria-describedby={`${card.id}-note`}
            >
              {t(locale, "card.result.edit")}
            </button>
          </div>

          <details className="nce-result__details">
            <summary>
              <span className="nce-result__marker" aria-hidden="true">▸</span>
              {t(locale, "card.result.details")}
            </summary>
            <div className="nce-result__proof">
              <KeyValues rows={card.rows} locale={locale} />
              <p className="nce-note nce-note--tight">{t(locale, card.noPublishKey)}</p>
              <p id={`${card.id}-note`} className="nce-result__hint">{t(locale, "card.result.preview.note")}</p>
            </div>
          </details>
        </section>
      )}

      {card.kind === "required-inputs" && (
        <>
          <p>{t(locale, "card.inputs")}</p>
          <ul className="nce-verify">
            {card.items.map((item) => (
              <li key={item}>
                <span>{t(locale, item)}</span>
              </li>
            ))}
          </ul>
          <p className="nce-note nce-note--tight">{t(locale, card.blocksKey)}</p>
        </>
      )}

      {card.kind === "attachment" && (
        <>
          <p>
            {card.name ?? t(locale, card.nameKey)}
            {" · "}
            {t(locale, "card.attachment")}
          </p>
          {card.local && <p className="nce-note nce-note--tight">{t(locale, "card.attachment.local")}</p>}
          <div className="nce-card__actions">
            <button key="remove" type="button" onClick={() => onChoose(card.id)}>
              {t(locale, "conv.attachment.remove")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function RunStateLine({ run, locale }: { run: RunState; locale: Locale }) {
  return (
    <div className="nce-runstate">
      <p>{t(locale, "conv.task")}</p>
    </div>
  );
}
