import type { PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";

import type { ExecutionClaim } from "../execution/execution-claim";
import type { ExecutionRecord } from "../execution/execution-record";
import { executionRow, toExecution } from "./prisma-lifecycle-repositories";
import type { ExecutionClaimPrismaClient } from "./prisma-execution-claim-repository";
import { updateClaimDispatched } from "./prisma-execution-claim-repository";

/**
 * The ATOMIC EXECUTION-ATTEMPT FINALIZER.
 *
 * THE PROBLEM. Two durable facts must both exist, or neither may:
 *
 *   1. the EXECUTION RECORD — the audit-spine entry naming the handle and attempt;
 *   2. the CLAIM'S `DISPATCHED` transition — the ledger saying an attempt is
 *      durably identified, so every later caller ADOPTS it instead of starting a
 *      second run.
 *
 * Written separately, a crash between them leaves one of two states, and both
 * are bad in different ways:
 *
 *   record, no DISPATCHED  → the ledger still reads `DISPATCHING`, so a real,
 *                            recorded execution looks unverified and a human is
 *                            asked about a run we can actually see.
 *   DISPATCHED, no record  → the ledger points at an execution record that does
 *                            not exist, so adoption (`ADOPT`) hands the
 *                            reconciler a dangling id.
 *
 * So they are committed in ONE transaction, and the transaction is SHORT: two
 * statements, no external call. The provider/runtime call has already happened
 * by the time this runs — that is what `DISPATCHING` means.
 *
 * ROLLBACK INVARIANT. The claim CAS is a conditional UPDATE that RETURNS the row
 * it moved. If it returns nothing — the invocation lost its lease, another
 * process already finalised the attempt, the state moved — this throws INSIDE
 * the transaction, so the record insert is rolled back with it. Neither side can
 * commit alone. The caller then reports what it finds (adopt / in-progress /
 * unverified) rather than minting a second identity.
 *
 * WHY THE CLAIM WRITE GOES THROUGH `updateClaimDispatched`. `ai_execution_claims`
 * has exactly ONE approved writer, and a repository-suite test enforces that by
 * scanning `src/` for the table name. Writing the CAS inline here would have made
 * this a second writer and — worse — a second place where the database clock and
 * the lease predicate are spelled. So the SQL stays in the claim repository and
 * this component only decides WHEN it runs, passing it the transaction client.
 */

export type ExecutionAttemptCommitInput = {
  claimId: string;
  /** The invocation that owns the claim. A stale token cannot finalise. */
  invocationToken: string;
  /** The record to insert. Its id, handleId and attempt are already decided. */
  record: ExecutionRecord;
  /** The runtime that hosts it, when it differs from what the claim already holds. */
  runtimeId?: string;
};

export type ExecutionAttemptCommitResult = {
  record: ExecutionRecord;
  claim: ExecutionClaim;
};

export interface ExecutionAttemptCommitter {
  /**
   * Inserts the execution record and moves the claim to `DISPATCHED` in ONE
   * transaction.
   *
   * @throws PERSISTENCE_UNAVAILABLE when the claim CAS lost — the record insert
   *         is rolled back, so nothing was written.
   */
  commitDispatched(input: ExecutionAttemptCommitInput): Promise<ExecutionAttemptCommitResult>;
}

/** The client surface this needs: the record delegate and transactions. */
export type ExecutionAttemptCommitterPrismaClient = Pick<PrismaClient, "aiExecutionRecord" | "$transaction">;

export type PrismaExecutionAttemptCommitterOptions = {
  client: ExecutionAttemptCommitterPrismaClient;
};

export class PrismaExecutionAttemptCommitter implements ExecutionAttemptCommitter {
  constructor(private readonly options: PrismaExecutionAttemptCommitterOptions) {}

  async commitDispatched(input: ExecutionAttemptCommitInput): Promise<ExecutionAttemptCommitResult> {
    const runtimeId = input.runtimeId ?? input.record.runtimeId;

    try {
      return await this.options.client.$transaction(async (tx) => {
        const inserted = await tx.aiExecutionRecord.create({
          data: { id: input.record.id, ...executionRow(input.record) },
        });

        // The CAS, through the ONE approved writer, inside this transaction.
        const claimed = await updateClaimDispatched(tx as unknown as ExecutionClaimPrismaClient, input.claimId, {
          invocationToken: input.invocationToken,
          executionRecordId: input.record.id,
          handleId: input.record.handleId,
          runtimeId,
        });
        if (!claimed) {
          // Throwing INSIDE the transaction is what makes the rollback invariant
          // real: `inserted` disappears with the failed commit.
          throw new AiWorkforceError(
            "PERSISTENCE_UNAVAILABLE",
            `Execution attempt ${input.claimId} could not be finalised: the claim is no longer DISPATCHING under this invocation`,
            { claimId: input.claimId, executionRecordId: input.record.id },
          );
        }

        return { record: toExecution(inserted), claim: claimed };
      });
    } catch (error) {
      if (error instanceof AiWorkforceError) throw error;
      throw new AiWorkforceError(
        "PERSISTENCE_UNAVAILABLE",
        `Execution attempt ${input.claimId} could not be finalised atomically`,
        {
          claimId: input.claimId,
          executionRecordId: input.record.id,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

/** Asserts the database can host the finalizer (and says what is missing). */
export function assertExecutionAttemptCommitterSchema(client: unknown): void {
  const candidate = client as Record<string, unknown>;
  // `aiExecutionRecord` is a DELEGATE (an object); `$transaction` is a function.
  const missing = [
    ...(candidate["aiExecutionRecord"] ? [] : ["aiExecutionRecord"]),
    ...(typeof candidate["$transaction"] === "function" ? [] : ["$transaction"]),
  ];
  if (missing.length > 0) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      `The atomic execution finalizer requires an execution-record delegate and transactions (missing: ${missing.join(", ")})`,
      { missing },
    );
  }
}
