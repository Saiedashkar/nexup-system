"use client";

import { useLocale } from "@/components/command/i18n/command-locale";
import { LabButton, LabData, LabFrame, Meter, Note, Pill, Section, Split, tone } from "@/components/command/lab/kit";
import { RISK_META, decisionQueue } from "@/components/command/state/demo/selectors";
import type { CommandDataset, SpendGuard, Wallet } from "@/components/command/state/demo/types";

/**
 * FINANCE — product shell only
 * ────────────────────────────
 * Deliberately NOT connected to money. This page exists to show the SHAPE of
 * finance inside the operating system — revenue, spend, wallets, what is held for
 * approval and the guards over AI/tool spend — and it refuses to invent figures.
 *
 * Every number that would require a real ledger reads "—" with the reason beside
 * it. The ONE figure that is real is the held-approval count, because it comes
 * from the decision queue this prototype actually holds.
 *
 * The real books stay where they are: /office/finance and the capital ledger are
 * untouched, and this page links out rather than duplicating them.
 */

const GUARD_TONE: Record<SpendGuard["state"], { tone: string; label: string }> = {
  within: { tone: "--nc-completed", label: "Within limit" },
  near: { tone: "--nc-approval", label: "Near the gate" },
  breached: { tone: "--nc-error", label: "Breached" },
  suspended: { tone: "--nc-text-4", label: "Suspended" },
};

const WALLET_TONE: Record<Wallet["state"], string> = {
  open: "--nc-growth",
  reconciled: "--nc-completed",
  held: "--nc-approval",
  untracked: "--nc-text-4",
};

export default function FinancePage() {
  const { tc } = useLocale();
  return (
    <LabFrame areaId="finance">
      <LabData
        emptyTitle={tc("Finance shell")}
        emptyBody={tc("This shell is data-independent: it shows shape, not the company's money.")}
      >
        {(dataset) => <Finance dataset={dataset} />}
      </LabData>
    </LabFrame>
  );
}

function Finance({ dataset }: { dataset: CommandDataset }) {
  const { t, tc } = useLocale();
  const finance = dataset.finance;
  const held = decisionQueue(dataset);
  const spendDecisions = held.filter((d) => d.policy.toLowerCase().includes("spend") || d.policy.toLowerCase().includes("governance"));

  return (
    <>
      <div className="nl-flags">
        <div className="nl-flag nl-flag__long" style={tone("--nc-approval")}>
          <span className="nl-flag__label">{tc("Product shell")}</span>
          <span className="nl-flag__text">{tc(finance.note)}</span>
        </div>
      </div>

      <div className="nl-figures" role="list">
        {finance.figures.map((figure) => (
          <div
            key={figure.id}
            role="listitem"
            className="nl-figure"
            style={tone(figure.tone === "attention" ? "--nc-approval" : figure.tone === "positive" ? "--nc-completed" : "--nc-text-3")}
          >
            <span className="nl-figure__value">{figure.value}</span>
            <span className="nl-figure__label">{tc(figure.label)}</span>
            <span className="nl-figure__note">{tc(figure.note)}</span>
          </div>
        ))}
      </div>

      <Split
        primary={
          <>
            <Section
              title={tc("Held for approval")}
              count={held.length}
              span={12}
              hint={tc("the only real figure on this page — it comes from the decision queue")}
            >
              {held.length === 0 ? (
                <Note>{tc("Nothing is held. No payment or spend decision is waiting on a human.")}</Note>
              ) : (
                <div className="nl-rows">
                  {held.map((decision) => {
                    const meta = RISK_META[decision.risk];
                    return (
                      <div key={decision.id} className="nl-line" style={tone(meta.tone)}>
                        <span className="nl-line__stack">
                          <span className="nl-line__title">{tc(decision.title)}</span>
                          <span className="nl-line__meta">
                            {tc(decision.policy)} · {t("decisions.raised", { at: decision.createdAt })}
                          </span>
                        </span>
                        <Pill label={t(`status.risk.${decision.risk}`)} tone={meta.tone} />
                      </div>
                    );
                  })}
                </div>
              )}
              <LabButton href="/command/decisions">{tc("Open the Decision Center")}</LabButton>
            </Section>

            <Section
              title={tc("AI & tool spend governance")}
              count={finance.guards.length}
              span={12}
              hint={tc("who may spend, and how much")}
            >
              <div className="nl-guards">
                {finance.guards.map((guard) => {
                  const meta = GUARD_TONE[guard.state];
                  return (
                    <div key={guard.id} className="nl-guard" style={tone(meta.tone)}>
                      <div className="nl-guard__head">
                        <span className="nl-guard__label">{tc(guard.label)}</span>
                        <Pill label={tc(meta.label)} tone={meta.tone} />
                      </div>
                      <span className="nl-guard__meta">
                        {t("finance.scopeLimit", {
                          scope: tc(guard.scope),
                          limit: guard.limit,
                          used: guard.used,
                        })}
                      </span>
                      <Note>{tc(guard.note)}</Note>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section
              title={tc("Model consumption as a financial control")}
              count={spendDecisions.length}
              span={12}
              hint={tc("intelligence is a line item, not a setting")}
            >
              <div className="nl-rows">
                {dataset.models.slice(0, 6).map((model) => (
                  <div key={model.id} className="nl-line">
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{model.name}</span>
                      <span className="nl-line__meta">
                        {t("finance.costClass", {
                          provider: model.provider,
                          costClass: t(`models.cost.${model.costClass}`),
                          entitlement: tc(model.entitlement),
                        })}
                      </span>
                    </span>
                    <Meter
                      value={model.quota.usedPct}
                      tone={model.quota.state === "exhausted" ? "--nc-error" : model.quota.state === "near-limit" ? "--nc-approval" : "--nc-completed"}
                    />
                    <span className="nl-cell__num">{model.quota.usedPct}%</span>
                  </div>
                ))}
              </div>
              <Note>
                {tc(
                  "Allowance percentages are demo values. The registry is a UI shell — no cost is incurred and no request is dispatched in this worktree.",
                )}
              </Note>
            </Section>
          </>
        }
        aside={
          <>
            <Section
              title={tc("Wallets")}
              count={finance.wallets.length}
              span={12}
              hint={tc("the shape of the money, not the money")}
            >
              <div className="nl-rows">
                {finance.wallets.map((wallet) => (
                  <div key={wallet.id} className="nl-wallet" style={tone(WALLET_TONE[wallet.state])}>
                    <span className="nl-line__stack">
                      <span className="nl-line__title">{tc(wallet.name)}</span>
                      <span className="nl-line__meta">
                        {t("finance.walletLine", { kind: tc(wallet.kind), state: tc(wallet.state) })}
                      </span>
                      <span className="nl-line__meta">{tc(wallet.note)}</span>
                    </span>
                    <span className="nl-wallet__balance">{wallet.balance}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={tc("Where the real books live")} span={12}>
              <Note>
                {tc(
                  "This page does not read a ledger, because this worktree has no finance connection. Revenue, expenses, capital and withdrawals are already real and already live — in the existing Office finance surface.",
                )}
              </Note>
              <div className="nl-stack">
                <LabButton href="/office/finance">{tc("Open the real finance surface")}</LabButton>
                <LabButton href="/command/activity">{tc("See the money-related activity")}</LabButton>
              </div>
            </Section>

            <Section title={tc("Controls")} span={12}>
              <Note>
                {tc(
                  "Four gates hold money in this organization: payment approval above the standing limit, new vendor commitments, autonomy that could spend without a human, and the AI/tool ceiling. All four are modelled here; none of them are enforced anywhere in this worktree.",
                )}
              </Note>
            </Section>
          </>
        }
      />
    </>
  );
}
