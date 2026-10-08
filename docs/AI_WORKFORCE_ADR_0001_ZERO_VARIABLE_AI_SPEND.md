# ADR 0001 — Zero additional variable AI spend by default

- **Status:** Accepted (owner decision, Step 5A)
- **Date:** 2026-10-08
- **Scope:** the AI Workforce execution boundary (`modules/ai-workforce/policies/budget-governor.ts`, `modules/workforce/execution/*`)
- **Supersedes:** nothing
- **Changes policy:** nothing. This records a decision already made; it introduces no new rule.

---

## Context

NEXUP's product invariant is **zero additional variable AI spend by default**. An
invariant is only real if there is a decision point that can refuse an execution
*before* it reaches a provider. Until Step 5A the mission path reached a runtime
with no budget decision of any kind — the freeze audit recorded
`ActorModelPolicy` / `EstimatedCostPolicy` as declared-and-unread (gap #1). "We do
not spend" was therefore a statement about code that did not exist.

The execution path needed a gate whose **default outcome is refusal**, so that no
configuration mistake, retry storm or agent decision could start a paid run.

## Decision

At the execution boundary the spend question is asked as one question — *can this
proposed work incur cost that varies with use?* — and answered as follows.

| Proposed work | Effective cost | Default decision |
|---|---|---|
| Deterministic in-process / tool execution | `NO_VARIABLE_COST` | **may be allowed** |
| Human step | `NO_VARIABLE_COST` | **may be allowed** |
| Real provider / model / agent turn | `VARIABLE_PROVIDER_COST` | **DENIED** |
| Runtime leg whose cost or entitlement is unknown or unattested | treated as `VARIABLE_PROVIDER_COST` | **DENIED** |

Stated as the two rules this ADR exists to fix:

1. **UNKNOWN OR UNATTESTED RUNTIME COST → FAIL CLOSED / DENY VARIABLE AI
   EXECUTION.** An unknown runtime is never assumed free. A runtime is treated as
   non-spending only when it *explicitly* declares `variableCost: false` in its own
   identity metadata; absent or malformed means spending.
2. **ZERO ADDITIONAL VARIABLE AI SPEND BY DEFAULT.**

There is deliberately **no allow-with-audit bypass, no auto-top-up, no
pay-as-you-go, no credit purchase and no silent paid fallback.** The only path by
which a real provider turn may ever start is Step 5C returning
`ALLOWED_ATTESTED_INCLUDED_ROUTE` for an execution that maps onto an attested
included/free route — a value Step 5A cannot produce, because no such attestation
exists yet.

## Consequences

- **Positive.** Variable-cost spend is impossible by construction on this path,
  not merely discouraged. A refusal is a typed, machine-readable decision
  (`BUDGET_DENIED_VARIABLE_AI_EXECUTION`) rather than a free-text excuse, and the
  policy is provider-neutral: the governor never names a runtime, transport or
  provider, so adding a provider cannot tempt a provider-specific exception.
- **Negative / accepted.** Deterministic and human work may proceed while a
  capability that genuinely needs a provider turn will be blocked until Step 5C.
  This is intended: a blocked attempt is a visible, auditable non-event, whereas a
  spent credit is not recoverable.
- **Neutral.** Tests that need a permissive decision compose their **own**
  `BudgetGovernor`. The production default is never weakened to make a test
  convenient.

## Where this is enforced

- `modules/ai-workforce/policies/budget-governor.ts` — the `BudgetGovernor` port
  and `DenyVariableAiSpendBudgetGovernor`, the shipped default.
- `modules/workforce/execution/capability-execution-contracts.ts` —
  `spendClassForBinding`, the single place a leg is translated into the spend
  question, and `runtimeDeclaresNoVariableCost`, the fail-closed runtime check.
- `tests/workforce-step5a-claim.test.ts` — asserts the default denies
  variable-cost work and permits only no-variable-cost work.

## What would change this decision

Only a future ADR, on the basis of Step 5C establishing a **trustworthy**
included/free route attestation. Nothing in Step 5A or Step 5A-2 may relax the
default in the meantime.
