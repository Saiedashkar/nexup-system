import type { ApprovalPolicy } from "../approvals/approval-policy";
import { DEFAULT_APPROVAL_POLICY } from "../approvals/approval-policy";
import { ApprovalGate } from "../approvals/approval-gate";
import { ApprovalService } from "../approvals/approval-service";
import { InMemoryApprovalRepository, type ApprovalRepository } from "../approvals/approval-repository";
import { InMemoryAuditEventRepository, type AuditEventRepository } from "../audit/audit-event-repository";
import { InMemoryRunRepository, type RunRepository } from "../audit/run-repository";
import { RepositoryRunRecorder } from "../audit/run-recorder";
import { InMemoryJobRepository, type JobRepository } from "../jobs/job-repository";
import { JobRunner, type AgentJobDispatcher } from "../jobs/job-runner";
import { PermissionPolicy } from "../policies/permission-policy";
import { ToolRegistry } from "../registry/tool-registry";
import { LocalRuntimeAdapter } from "../runtime/local-runtime-adapter";
import type { PersistenceKind } from "../runtime/runtime-adapter";
import { workforceToolAdapters } from "../tools";
import type { ToolAdapter } from "../registry/tool-definition";
import { createIdFactory, systemClock } from "./ids";
import type { WorkforcePorts } from "./ports";
import type { Clock, IdFactory } from "./types";

/**
 * Composition root.
 *
 * Pure wiring: no Prisma, no Next.js, no environment access. The running
 * application supplies real ports and repositories through
 * `modules/ai-workforce/index.ts`; tests supply fakes. That is what keeps the
 * control core testable without a database.
 *
 * Phase 1B: the four storage concerns (jobs, runs, audit events, approvals)
 * are INJECTED as repository ports. Passing the same repositories to a second
 * core is exactly what "the process restarted" means to this engine.
 */

export type WorkforceRepositories = {
  jobs: JobRepository;
  runs: RunRepository;
  events: AuditEventRepository;
  approvals: ApprovalRepository;
};

export type CreateControlCoreOptions = {
  ports: WorkforcePorts;
  tools?: readonly ToolAdapter[];
  ids?: IdFactory;
  now?: Clock;
  approvalPolicy?: ApprovalPolicy;
  sleep?: (ms: number) => Promise<void>;
  /** Injected storage. Defaults to a fresh in-memory set. */
  repositories?: Partial<WorkforceRepositories>;
  /** Reported by `runtime.describe()` — never inferred from the storage itself. */
  persistence?: PersistenceKind;
  requireDistinctApprover?: boolean;
  /**
   * Phase 2B — optional agent-runtime dispatch seam. When provided, a job that
   * carries a `runtimeId` is handed to this dispatcher instead of the local
   * tool path. Absent by default, so legacy behaviour is unchanged.
   */
  dispatchAgent?: AgentJobDispatcher;
};

export type ControlCore = {
  registry: ToolRegistry;
  permissions: PermissionPolicy;
  approvals: ApprovalGate;
  approvalService: ApprovalService;
  runtime: LocalRuntimeAdapter;
  recorder: RepositoryRunRecorder;
  jobs: JobRunner;
  repositories: WorkforceRepositories;
  persistence: PersistenceKind;
  ids: IdFactory;
  now: Clock;
  ports: WorkforcePorts;
};

/** A fresh, isolated set of in-memory repositories. */
export function createInMemoryRepositories(deps: { ids: IdFactory; now: Clock }): WorkforceRepositories {
  return {
    jobs: new InMemoryJobRepository(),
    runs: new InMemoryRunRepository(),
    events: new InMemoryAuditEventRepository(),
    approvals: new InMemoryApprovalRepository(deps),
  };
}

export function createControlCore(options: CreateControlCoreOptions): ControlCore {
  const ids = options.ids ?? createIdFactory();
  const now = options.now ?? systemClock();

  const registry = new ToolRegistry();
  registry.registerAll(options.tools ?? workforceToolAdapters);

  const permissions = new PermissionPolicy();

  const defaults = createInMemoryRepositories({ ids, now });
  const repositories: WorkforceRepositories = {
    jobs: options.repositories?.jobs ?? defaults.jobs,
    runs: options.repositories?.runs ?? defaults.runs,
    events: options.repositories?.events ?? defaults.events,
    approvals: options.repositories?.approvals ?? defaults.approvals,
  };

  const approvals = new ApprovalGate(repositories.approvals, options.approvalPolicy ?? DEFAULT_APPROVAL_POLICY, {
    ids,
    now,
  });

  const recorder = new RepositoryRunRecorder({ runs: repositories.runs, events: repositories.events, ids, now });
  const persistence: PersistenceKind = options.persistence ?? "IN_MEMORY";

  const runtime = new LocalRuntimeAdapter({
    registry,
    ports: options.ports,
    permissions,
    approvals,
    recorder,
    ids,
    now,
    sleep: options.sleep,
    persistence,
  });

  const jobs = new JobRunner({
    runtime,
    recorder,
    approvals,
    permissions,
    jobs: repositories.jobs,
    ids,
    now,
    dispatchAgent: options.dispatchAgent,
  });

  const approvalService = new ApprovalService({
    approvals,
    jobs,
    registry,
    recorder,
    ids,
    now,
    requireDistinctApprover: options.requireDistinctApprover,
  });

  return {
    registry,
    permissions,
    approvals,
    approvalService,
    runtime,
    recorder,
    jobs,
    repositories,
    persistence,
    ids,
    now,
    ports: options.ports,
  };
}
