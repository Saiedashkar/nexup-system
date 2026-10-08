import { prismaWorkforcePorts } from "./adapters/prisma-read-ports";
import { createControlCore, type ControlCore, type WorkforceRepositories } from "./core/create-core";
import { createIdFactory, systemClock } from "./core/ids";
import { createPrismaRepositories } from "./persistence/prisma-repositories";
import { createWorkforcePrismaClient } from "./persistence/prisma-client";
import { resolvePersistence } from "./policies/persistence-safety";
import type { PersistenceKind } from "./runtime/runtime-adapter";
import { controlPlaneToolAdapters } from "./tools";

/**
 * NEXUP COMMAND → AI WORKFORCE — module surface.
 *
 * The workforce engine owns four tables (`ai_jobs`, `ai_runs`, `ai_run_events`,
 * `ai_approvals`) and reaches business data only through read ports.
 *
 * Where state lives is decided ONCE, here, and it is fail-closed:
 *
 *   AI_WORKFORCE_PERSISTENCE != "database"     → in-memory (default)
 *   AI_WORKFORCE_DATABASE_URL not loopback     → in-memory, with the reason
 *                                                surfaced in the UI/status API
 *   verified isolated loopback database        → database-backed repositories
 *
 * The legacy `DATABASE_URL` is never consulted for workforce state, so this
 * module cannot write to production even if someone sets the persistence flag
 * on a deployment that shares the production database.
 */

export type WorkforceBootstrap = {
  persistence: PersistenceKind;
  reason: string;
  database?: string;
  externalCalls: false;
  aiProvider: "NONE";
};

type WorkforceRuntime = {
  core: ControlCore;
  bootstrap: WorkforceBootstrap;
  /** Present only for database-backed persistence. */
  client?: { $disconnect: () => Promise<void> };
};

const CORE_KEY = "__nexupAiWorkforceCore";

type CoreHolder = { [CORE_KEY]?: WorkforceRuntime };

function buildRepositories(
  persistence: PersistenceKind,
  deps: { ids: ReturnType<typeof createIdFactory>; now: ReturnType<typeof systemClock> },
  database?: string,
): {
  repositories: Partial<WorkforceRepositories>;
  client?: { $disconnect: () => Promise<void> };
} {
  if (persistence !== "DATABASE" || !database) return { repositories: {} };

  try {
    const handle = createWorkforcePrismaClient(database);
    return {
      repositories: createPrismaRepositories(handle.client, deps),
      client: { $disconnect: handle.disconnect },
    };
  } catch (error) {
    // Fail closed: a database we cannot use must never block the module.
    const reason = error instanceof Error ? error.message : "workforce database is unavailable";
    console.error("[ai-workforce] persistence unavailable, staying in memory:", reason);
    return { repositories: {} };
  }
}

function compose(): WorkforceRuntime {
  const resolution = resolvePersistence();
  const persistence: PersistenceKind = resolution.kind === "DATABASE" ? "DATABASE" : "IN_MEMORY";

  // One id factory / clock for the whole process, shared by the repositories
  // and the control core so identifiers are identical in memory and in a DB.
  const ids = createIdFactory();
  const now = systemClock();

  const { repositories, client } = buildRepositories(
    persistence,
    { ids, now },
    resolution.kind === "DATABASE" ? resolution.info.url : undefined,
  );

  // A rejected database request downgrades to memory — reported, never silent.
  const effective: PersistenceKind = persistence === "DATABASE" && Object.keys(repositories).length === 0 ? "IN_MEMORY" : persistence;

  const core = createControlCore({
    ports: prismaWorkforcePorts,
    // Phase 1A read capabilities + the Phase 1B approval fixture.
    tools: controlPlaneToolAdapters,
    ids,
    now,
    repositories,
    persistence: effective,
  });

  const bootstrap: WorkforceBootstrap = {
    persistence: effective,
    reason: persistence === effective ? resolution.reason : `${resolution.reason} — downgraded to memory after the connection check failed`,
    externalCalls: false,
    aiProvider: "NONE",
  };
  if (resolution.kind === "DATABASE") bootstrap.database = resolution.info.database;

  return { core, bootstrap, client };
}

export function getWorkforceRuntime(): WorkforceRuntime {
  const holder = globalThis as unknown as CoreHolder;
  if (!holder[CORE_KEY]) {
    holder[CORE_KEY] = compose();
  }
  return holder[CORE_KEY];
}

export function getControlCore(): ControlCore {
  return getWorkforceRuntime().core;
}

export function getWorkforceBootstrap(): WorkforceBootstrap {
  return getWorkforceRuntime().bootstrap;
}

/** Test/dev helper — drops the singleton so the next call rebuilds it. */
export function resetControlCore(): void {
  const holder = globalThis as unknown as CoreHolder;
  const existing = holder[CORE_KEY];
  if (existing?.client) {
    void existing.client.$disconnect().catch(() => {});
  }
  delete holder[CORE_KEY];
}

export { createControlCore, createInMemoryRepositories } from "./core/create-core";
export type { ControlCore, CreateControlCoreOptions, WorkforceRepositories } from "./core/create-core";
export { prismaWorkforcePorts, resolveBusinessScope } from "./adapters/prisma-read-ports";
export { actorFromSession, canUseWorkforce } from "./adapters/session-actor";
export { resolvePersistence, assertIsolatedDatabaseUrl } from "./policies/persistence-safety";
/* Step 5A — the fail-closed budget gate. The PORT and the DENY default only; the
   ModelRouter and the real Governor are Step 5C. Exported so an application
   composes a governor deliberately rather than inheriting an absent one. */
export {
  BUDGET_DECISION_REASONS,
  BUDGET_SPEND_CLASSES,
  DEFAULT_BUDGET_GOVERNOR_POLICY_REF,
  DENY_VARIABLE_AI_SPEND_POLICY_REF,
  DenyVariableAiSpendBudgetGovernor,
  denyVariableAiSpendBudgetGovernor,
  isBudgetSpendClass,
  summarizeBudgetDecision,
} from "./policies/budget-governor";
export type {
  BudgetDecision,
  BudgetDecisionReason,
  BudgetEvaluationInput,
  BudgetGovernor,
  BudgetSpendClass,
} from "./policies/budget-governor";
export { controlPlaneToolAdapters, workforceToolAdapters } from "./tools";
