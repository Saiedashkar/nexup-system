# ADR 0002 — The engineering plane is not the operations plane, and unknown spend stays blocked

- **Status:** Accepted (owner decision)
- **Date:** 2026-10-12
- **Scope:** the boundary between the NEXUP **operations plane** (the business
  agents, EXEC, Hermes) and the **engineering plane** (FreeBuff and any
  future engineering tool); the budget/entitlement posture on the execution path;
  the local demo posture.
- **Supersedes:** nothing.
- **Extends:** [ADR 0001](AI_WORKFORCE_ADR_0001_ZERO_VARIABLE_AI_SPEND.md), which
  fixes the spend question at the execution boundary. This ADR fixes *who may be
  asked that question at all*, and what an unknown answer means.
- **Changes behaviour:** nothing. This records a decision already made; the guard
  test below exists to keep it true.

---

## Context

FreeBuff is the engineering tool this repository is built inside. It is used
through sessions the owner starts deliberately, and it is **engineering-only**.

Nothing about that relationship makes FreeBuff a NEXUP runtime. But "nothing
makes it a runtime" is only a fact about code that exists; the moment a future
integration wants a cheap way to run agent work, the nearest available tool is
the one already sitting in the developer's terminal. That is the failure mode
this ADR closes.

The second half of the problem is entitlement. ADR 0001 already refuses
`VARIABLE_PROVIDER_COST` work by default, but "this subscription includes it" is
a *claim*, not a measurement. A subscription that is unverified, exhausted,
mis-scoped or simply misremembered would look identical to a free one at the
moment a governor was asked. An assumption of free access is therefore the same
class of error as a silent paid fallback.

## Decision

1. **The engineering plane is a separate credential and tool domain, and the
   dependency direction is one-way.** No NEXUP business agent, EXEC, or Hermes
   path may invoke FreeBuff (or any other engineering agent) automatically,
   delegate runtime work to it, or use it as a fallback. FreeBuff is never a
   runtime, a transport, a tool adapter, or a degraded-mode responder behind
   `AgentRuntime`.

   Stated as structure rather than as a list of names: the operations plane must
   not **import, name or otherwise reach** engineering execution. An engineering
   plane may legitimately exist — with an `EngineeringController`, an
   `EngineeringRuntime` port and a `FreeBuffAdapter` behind it — and this ADR does
   not forbid those names or that software. What it forbids is a business file
   depending on it, because that single edge is what would turn the engineering
   tool into a business runtime.
2. **Two current Step-5 `AgentRuntime` implementations exist in the workforce
   runtime directory:** the deterministic adapter (which honestly declares
   `variableCost: false`) and the Hermes adapter
   (`modules/workforce/runtimes/deterministic-runtime-adapter.ts` and
   `modules/workforce/runtimes/hermes/hermes-runtime-adapter.ts`). The **retained
   Phase-1 `LocalRuntimeAdapter`** implements the earlier `RuntimeAdapter` port in
   `modules/ai-workforce/runtime/`, and is accounted for separately rather than
   counted in that pair.

   That count **describes the current state; it is not a permanent cap.** A future
   runtime is a legitimate, reviewed change — it arrives by adding the adapter
   *and* updating this ADR and the guard tripwire in the same change, never as an
   implicit third adapter chosen at runtime because another one failed.
3. **Unknown billing or entitlement blocks execution.** An unattested
   subscription is not evidence of a free route; it is treated as
   `VARIABLE_PROVIDER_COST` and refused, exactly as an unknown runtime is. The
   fail-closed direction of ADR 0001's rule 1 is extended from *cost* to
   *entitlement*.
4. **No paid-fallback surfaces exist.** No automatic paid fallback, no credit
   purchase, no top-up, no prepaid balance, no overdraft, no provider switching,
   no allow-with-audit bypass. A refusal is the only outcome the shipped policy
   can produce for spend-capable work, and it is a typed refusal
   (`BUDGET_DENIED_VARIABLE_AI_EXECUTION`), not an exception and not a
   free-text excuse.
5. **Local demos stay local, with zero model calls.** Every demo path in this
   repository is loopback-only and runs the deterministic transport, so it spends
   no provider credits and contacts nothing outside `127.0.0.1`.
6. **A future runtime integration must preserve these boundaries.** It arrives as
   a new `BudgetGovernor` implementation or a new `AgentRuntime` adapter *plus* a
   deliberate change to the guard tripwire — never as a relaxation of the default
   governor, and never by weakening an existing assertion.

## Consequences

- **Positive.** "The business agents cannot reach the engineering tool" and "an
  unverified subscription cannot spend money" are both mechanical properties of
  this repository rather than working agreements. A regression fails the guard
  tripwire with a named file, not in production.
- **Negative / accepted.** A capability that genuinely needs a provider turn stays
  blocked until an attested included route exists. This is intended and is the
  same trade-off ADR 0001 already accepted: a blocked attempt is a visible,
  auditable non-event; a spent credit is not recoverable.
- **Neutral.** The Hermes adapter remains the only external runtime. It is already
  the only one the composition can build, and its transports remain the only
  place a provider is addressed.
- **Limits of the tripwire.** The dependency-direction checks are STATIC: they read
  imports, names and the manifest. They cannot follow a specifier assembled at
  runtime, a `require` of a computed name, or code reached through a re-exporting
  package. They are regression tripwires against the ordinary way this boundary is
  crossed — an import, a dependency, a URL, a wiring — and the durable guarantee
  is that any future integration is a deliberate, reviewed change.

## Where this is enforced

- `modules/ai-workforce/policies/budget-governor.ts` — the `BudgetGovernor` port,
  the shipped `DenyVariableAiSpendBudgetGovernor`, and the closed decision
  vocabulary that names `ALLOWED_ATTESTED_INCLUDED_ROUTE` without any code able to
  produce it.
- `modules/workforce/execution/capability-execution-contracts.ts` —
  `runtimeDeclaresNoVariableCost` (explicit `false` or fail closed) and
  `spendClassForBinding` (the single place a leg becomes the spend question).
- `modules/workforce/application/composition.ts` — composes the DENY governor when
  nothing is supplied, and refuses to start an application with no usable runtime.
- `modules/workforce/runtimes/*` — the two current Step-5 adapters
  (`deterministic-runtime-adapter.ts`, `hermes/hermes-runtime-adapter.ts`), the
  Hermes transports, and the retained Phase-1 `RuntimeAdapter` implementation
  (`modules/ai-workforce/runtime/local-runtime-adapter.ts`), which is counted
  separately from those two.
- `scripts/demo-*.mjs`, `scripts/demo-run.sh` — the loopback-only, deterministic
  demo path.
- **`tests/workforce-boundary-budget-guard.test.ts`** — the machine-checkable form
  of every numbered decision above: dependency direction (imports, names, the
  manifest), the adapter inventory, the spend vocabulary, the shipped governor and
  the demo posture. It is a set of static regression tripwires, with the limits
  recorded under Consequences.

## What would change this decision

Only a future ADR, on the basis of an attested included/free route **and** a
separate engineering-plane integration decision. Until then, no work in this
repository may relax items 1–6 — a blocked attempt is the intended outcome. Adding
an engineering plane does not change any of them: the plane may exist, and the
operations plane still may not reach it.
