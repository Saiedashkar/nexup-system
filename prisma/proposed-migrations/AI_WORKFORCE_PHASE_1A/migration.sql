-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('CREATED', 'PLANNED', 'WAITING_APPROVAL', 'READY', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AiRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AiReadWriteMode" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "AiTriggerType" AS ENUM ('MANUAL', 'AGENT', 'EVENT', 'SCHEDULE', 'WEBHOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiAutonomyLevel" AS ENUM ('HUMAN', 'AGENT');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'WAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "AiApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiToolInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED', 'WAITING_APPROVAL');

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'CREATED',
    "trigger" "AiTriggerType" NOT NULL DEFAULT 'MANUAL',
    "autonomy" "AiAutonomyLevel" NOT NULL DEFAULT 'HUMAN',
    "capability" TEXT NOT NULL,
    "resolvedToolId" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" TEXT NOT NULL,
    "businessId" TEXT,
    "correlationId" TEXT NOT NULL,
    "approvalId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "toolId" TEXT,
    "status" "AiRunStatus" NOT NULL DEFAULT 'STARTED',
    "runtimeKind" TEXT NOT NULL DEFAULT 'LOCAL',
    "serviceIdentityId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "businessId" TEXT,
    "correlationId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_run_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "runId" TEXT,
    "jobId" TEXT,
    "toolId" TEXT,
    "actorUserId" TEXT,
    "businessId" TEXT,
    "correlationId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_invocations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "jobId" TEXT,
    "toolId" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "riskLevel" "AiRiskLevel" NOT NULL,
    "readWriteMode" "AiReadWriteMode" NOT NULL,
    "status" "AiToolInvocationStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approvals" (
    "id" TEXT NOT NULL,
    "status" "AiApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "toolId" TEXT NOT NULL,
    "jobId" TEXT,
    "runId" TEXT,
    "riskLevel" "AiRiskLevel" NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestReason" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ai_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_jobs_actorUserId_idx" ON "ai_jobs"("actorUserId");

-- CreateIndex
CREATE INDEX "ai_jobs_businessId_idx" ON "ai_jobs"("businessId");

-- CreateIndex
CREATE INDEX "ai_jobs_correlationId_idx" ON "ai_jobs"("correlationId");

-- CreateIndex
CREATE INDEX "ai_jobs_capability_idx" ON "ai_jobs"("capability");

-- CreateIndex
CREATE INDEX "ai_jobs_createdAt_idx" ON "ai_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_jobId_idx" ON "ai_runs"("jobId");

-- CreateIndex
CREATE INDEX "ai_runs_toolId_idx" ON "ai_runs"("toolId");

-- CreateIndex
CREATE INDEX "ai_runs_status_idx" ON "ai_runs"("status");

-- CreateIndex
CREATE INDEX "ai_runs_actorUserId_idx" ON "ai_runs"("actorUserId");

-- CreateIndex
CREATE INDEX "ai_runs_correlationId_idx" ON "ai_runs"("correlationId");

-- CreateIndex
CREATE INDEX "ai_runs_startedAt_idx" ON "ai_runs"("startedAt");

-- CreateIndex
CREATE INDEX "ai_run_events_runId_idx" ON "ai_run_events"("runId");

-- CreateIndex
CREATE INDEX "ai_run_events_jobId_idx" ON "ai_run_events"("jobId");

-- CreateIndex
CREATE INDEX "ai_run_events_type_idx" ON "ai_run_events"("type");

-- CreateIndex
CREATE INDEX "ai_run_events_at_idx" ON "ai_run_events"("at");

-- CreateIndex
CREATE INDEX "ai_run_events_correlationId_idx" ON "ai_run_events"("correlationId");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_runId_idx" ON "ai_tool_invocations"("runId");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_toolId_idx" ON "ai_tool_invocations"("toolId");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_status_idx" ON "ai_tool_invocations"("status");

-- CreateIndex
CREATE INDEX "ai_tool_invocations_createdAt_idx" ON "ai_tool_invocations"("createdAt");

-- CreateIndex
CREATE INDEX "ai_approvals_status_idx" ON "ai_approvals"("status");

-- CreateIndex
CREATE INDEX "ai_approvals_toolId_idx" ON "ai_approvals"("toolId");

-- CreateIndex
CREATE INDEX "ai_approvals_jobId_idx" ON "ai_approvals"("jobId");

-- CreateIndex
CREATE INDEX "ai_approvals_createdAt_idx" ON "ai_approvals"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_events" ADD CONSTRAINT "ai_run_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run_events" ADD CONSTRAINT "ai_run_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tool_invocations" ADD CONSTRAINT "ai_tool_invocations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

