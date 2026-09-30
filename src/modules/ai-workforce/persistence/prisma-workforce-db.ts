/**
 * Workforce database contract.
 *
 * The Prisma adapters are typed STRUCTURALLY against the four `ai_*` tables
 * instead of importing the generated client for them. Two reasons:
 *
 *   1. The module must compile on a machine that has not run
 *      `prisma generate` against the new models yet — a generate step must
 *      never be the difference between a build and a broken build.
 *   2. It keeps the compile-time dependency one-way: adapters depend on this
 *      contract, never on a specific Prisma version's generated types.
 *
 * The seam is one explicit cast in `createPrismaRepositories`. Everything the
 * workforce module persists is one of these four row shapes — nothing else in
 * the legacy schema is touched.
 */

export type AiJobRow = {
  id: string;
  status: string;
  trigger: string;
  autonomy: string;
  capability: string;
  resolvedToolId: string | null;
  input: unknown;
  actorUserId: string;
  businessId: string | null;
  correlationId: string;
  approvalId: string | null;
  runId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Serialised ExecutionContextSnapshot (permission tokens are re-derived). */
  context: unknown;
  /** Serialised JobTransition[]. */
  history: unknown;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type AiRunRow = {
  id: string;
  jobId: string | null;
  toolId: string | null;
  status: string;
  runtimeKind: string;
  serviceIdentityId: string;
  actorUserId: string;
  businessId: string | null;
  correlationId: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
};

export type AiRunEventRow = {
  id: string;
  type: string;
  runId: string | null;
  jobId: string | null;
  toolId: string | null;
  actorUserId: string | null;
  businessId: string | null;
  correlationId: string | null;
  payload: unknown;
  at: Date;
};

export type AiApprovalRow = {
  id: string;
  status: string;
  toolId: string;
  jobId: string | null;
  runId: string | null;
  riskLevel: string;
  requestedByUserId: string;
  requestedForUserId: string | null;
  requestReason: string;
  correlationId: string | null;
  decidedByUserId: string | null;
  decisionReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/* ── Delegates ──────────────────────────────────────────
   Only the operations the adapters actually use are declared. Declaring less
   is deliberate: it documents the exact database surface the engine has. */

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

export type AiJobDelegate = {
  create(args: { data: Data }): Promise<AiJobRow>;
  findUnique(args: { where: Where }): Promise<AiJobRow | null>;
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number }): Promise<AiJobRow[]>;
  updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
};

export type AiRunDelegate = {
  create(args: { data: Data }): Promise<AiRunRow>;
  findUnique(args: { where: Where }): Promise<AiRunRow | null>;
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number }): Promise<AiRunRow[]>;
  updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
};

export type AiRunEventDelegate = {
  create(args: { data: Data }): Promise<AiRunEventRow>;
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number }): Promise<AiRunEventRow[]>;
};

export type AiApprovalDelegate = {
  create(args: { data: Data }): Promise<AiApprovalRow>;
  findUnique(args: { where: Where }): Promise<AiApprovalRow | null>;
  findMany(args?: { where?: Where; orderBy?: unknown; take?: number }): Promise<AiApprovalRow[]>;
  updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
};

export type WorkforceDatabaseClient = {
  aiJob: AiJobDelegate;
  aiRun: AiRunDelegate;
  aiRunEvent: AiRunEventDelegate;
  aiApproval: AiApprovalDelegate;
};
