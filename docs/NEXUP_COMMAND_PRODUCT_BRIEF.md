# NEXUP COMMAND — product brief

## Authority and direction

Saied is the founder and product decision owner. NEXUP COMMAND is the system we
are already building; continue it incrementally with the approved visual
identity. Do not start a replacement product or redesign the home experience
from scratch.

The near-term goal is a bilingual operating system from which Saied can run his
companies fully from an iPhone. After it proves itself in real company work, it
can be prepared for customers as a SaaS product. A plan, mock, or visible
control does not make a capability ready: readiness must be supported by the
implementation, permissions, tests, and deployed state.

## Product model

The home experience revolves around **EXEC** and contains its conversation,
sessions, and tools, together with current work and decisions that need the
founder. Six company departments surround EXEC:

1. Management and Operations
2. Marketing and Sales
3. Clients and Projects
4. Creative and Production
5. Technology and Systems
6. Finance and Control

These are company departments, not navigation groups. Knowledge is a shared
service across them.

Each department is an operating room with a team, work states, tools, metrics,
and an explicit handoff to the next department. Every agent has a name, title,
skills, and permissions. The interface must show who owns the current step and
what that owner handed over.

Arabic and English are first-class. Mobile is a complete operating experience,
not a reduced display. Preserve the approved visual identity and the existing
EXEC-centered home composition while improving it.

## Companies, data, and permissions

The same core serves NexUp and REBOUND. Each company has isolated data, team,
tools, and permissions. Every capability added inside COMMAND must name the
system that owns its data. Existing systems remain the source of truth where
specified; integrations should not create competing records.

Company scope and user permissions must be established before showing data.
Cross-company reads, links, writes, updates, deletes, background work, and
cleanup are forbidden unless an explicit product rule authorizes them.

## Department operation

### Marketing and Sales

The department has two rooms.

- Marketing covers strategy, campaigns, content, review, scheduling, and
  analytics. A performance summary is visible at the department entrance.
- NEXPUBLISH remains an independent publishing system. COMMAND surfaces its
  capabilities through an explicit integration constrained by company and
  permission. Platforms and research or analysis tools follow the same model.
- Sales operates opportunities, qualification, follow-up, proposals, and the
  handoff after acceptance.

Marketing and sales are currently experimental; their visible flows must not be
reported as production-ready without implementation and verification evidence.

### Clients and Projects → Creative and Production

Clients and Projects owns the brief, agreement, project stages, and client
approvals. An accepted proposal must continue into the same client and project,
preserving the brief and history instead of recreating them.

Creative and Production receives the agreed scope, produces the work, and
performs quality review before delivery.

Converting an accepted deal to a project remains required. The write must be
idempotent so a lost response cannot create a duplicate client, project, or
handoff.

### Management, Technology, and Finance

- Management and Operations tracks priorities, ownership, delays, and pending
  decisions.
- Technology and Systems owns integrations, tool health, and the truthful
  description of what each connected tool can do.
- Finance and Control reviews proposal cost and margin, invoicing, and
  collection. The existing accounting system remains the source of its data;
  COMMAND integrates with it rather than duplicating its records.

## EXEC execution boundary

An agent may reason, propose, and plan. An action is executed only through a
permissioned task and tool path with an audit record, and the result is stored.
Chat never executes external actions directly.

Hermes provides reasoning. External actions such as publishing or sending a
proposal require explicit approval. A representative target flow is:

> From mobile, request a store review and a development proposal; research
> supplies evidence, sales qualifies it, production scopes it, finance reviews
> margin, and the founder receives one clear decision.

The action boundary must remain visible throughout the handoffs: requester,
current owner, evidence, approval, tool invocation, result, and next owner.

## Current verified state

- Canonical repository: `https://github.com/Saiedashkar/nexup-system`
- Working branch: `feature/data-binding-clients-projects-20261107`
- Live release: `afdca18-deployfix1` at
  `https://command.rebound-agency.tech`
- PostgreSQL 18 and Prisma packaging fixes are carried back in commit
  `f59e63cf17a469bcd4db8214b49377400e51b795`.
- Live clients and projects read from the release database.
- The live release is read-only. EXEC and external execution are disabled.
- Marketing and Sales remain experimental.
- Codex Cloud independence from the laptop is not yet proven.

Deployment identifiers, update gates, verification, and rollback are maintained
only in [`NEXUP_COMMAND_OPERATIONS.md`](NEXUP_COMMAND_OPERATIONS.md).

## Delivery discipline

- Read this brief and the files directly related to the task before changing
  behavior.
- Work in small batches and test the affected surface. Expand verification only
  when a shared or sensitive boundary changes.
- Separate test success from product, visual, architectural, or release
  approval.
- Keep long logs in files and report the outcome, evidence, and actionable
  blocker succinctly.
- Preserve Hermes, NEXPUBLISH, shared infrastructure, and external systems
  unless the task explicitly includes them.
- Extract genuinely reusable procedures into `skills/`, including when to use
  them, inputs, steps or scripts, permissions, and an observable success
  measure. Never store secrets or customer data there.

The first reusable procedure is
[`skills/container-release-rollback/SKILL.md`](../skills/container-release-rollback/SKILL.md).
Future candidates include Arabic mobile experience verification and sales
opportunity qualification and handoff; add them when the corresponding real
workflow is implemented and verified rather than documenting speculative
behavior.
