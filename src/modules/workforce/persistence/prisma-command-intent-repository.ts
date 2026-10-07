import type { Prisma, PrismaClient } from "@prisma/client";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";

import type {
  CommandIntent,
  CommandIntentClaim,
  CommandIntentClaimInput,
  CommandIntentRepository,
} from "../application/command-intent";

/**
 * The DURABLE Command idempotency ledger.
 *
 * `ai_command_intents` carries a UNIQUE index over (scope, idempotencyKey), and
 * that index — not a read-then-write check — is the claim:
 *
 *   INSERT …            → won the key             (claimed)
 *   unique violation    → someone else holds it   (replay / in-progress / conflict)
 *
 * Two concurrent requests for the same key therefore cannot both create a
 * mission, in this process or in any other, and a restart between a client's
 * retry and its original request is just another caller hitting the same index.
 *
 * FAILED claims are re-claimable by the same record (the work was never done),
 * so a transient failure does not strand the key forever.
 */

export type CommandIntentPrismaClient = Pick<PrismaClient, "aiCommandIntent">;

/** Fails closed when the connected database has no ledger table. */
export function assertCommandIntentSchema(client: unknown): void {
  const candidate = client as Record<string, unknown>;
  if (!candidate["aiCommandIntent"]) {
    throw new AiWorkforceError(
      "PERSISTENCE_UNAVAILABLE",
      'Command idempotency is not available on the connected database (missing delegate: aiCommandIntent). Run "prisma generate" and apply the proposed AI_WORKFORCE_PHASE_3 migration locally.',
      { missing: ["aiCommandIntent"] },
    );
  }
}

type CommandIntentRow = Prisma.AiCommandIntentGetPayload<Record<string, never>>;

function toIntent(row: CommandIntentRow): CommandIntent {
  const intent: CommandIntent = {
    id: row.id,
    scope: row.scope,
    idempotencyKey: row.idempotencyKey,
    commandHash: row.commandHash,
    state: row.state as CommandIntent["state"],
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.missionId) intent.missionId = row.missionId;
  if (row.capabilityId) intent.capabilityId = row.capabilityId;
  if (row.reason) intent.reason = row.reason;
  return intent;
}

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export type PrismaCommandIntentRepositoryOptions = {
  client: CommandIntentPrismaClient;
  ids: IdFactory;
  now: Clock;
};

export class PrismaCommandIntentRepository implements CommandIntentRepository {
  constructor(private readonly options: PrismaCommandIntentRepositoryOptions) {
    assertCommandIntentSchema(options.client);
  }

  async claim(input: CommandIntentClaimInput): Promise<CommandIntentClaim> {
    const at = this.options.now();
    try {
      const created = await this.options.client.aiCommandIntent.create({
        data: {
          id: this.options.ids.next("intent"),
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          commandHash: input.commandHash,
          state: "CLAIMED",
          missionId: null,
          requestedBy: input.requestedBy,
          capabilityId: input.capabilityId ?? null,
          reason: null,
          createdAt: at,
          updatedAt: at,
        },
      });
      return { kind: "claimed", intent: toIntent(created) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A unique violation is NOT enough on its own to mean "somebody else
      // holds this key": the table also has a primary key on `id`. The row for
      // (scope, key) is the test — if it is not there, this is some other
      // violation and must surface as itself rather than as a replay.
      const held = await this.findByKey(input.scope, input.idempotencyKey);
      if (!held) throw error;
      return this.afterViolation(held, input, at);
    }
  }

  private async afterViolation(
    existing: CommandIntent,
    input: CommandIntentClaimInput,
    at: Date,
  ): Promise<CommandIntentClaim> {
    if (existing.commandHash !== input.commandHash) return { kind: "conflict", intent: existing };
    if (existing.missionId) return { kind: "replay", intent: existing };
    if (existing.state !== "FAILED") return { kind: "in-progress", intent: existing };

    // A previous build failed: the work was never done, so the SAME record may
    // be claimed again. The CAS keeps two concurrent retries from both winning.
    const { count } = await this.options.client.aiCommandIntent.updateMany({
      where: { id: existing.id, state: "FAILED", missionId: null },
      data: { state: "CLAIMED", reason: null, updatedAt: at },
    });
    if (count === 0) {
      const raced = await this.findByKey(input.scope, input.idempotencyKey);
      if (!raced) {
        throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", "The idempotency ledger lost a claim mid-reclaim", {
          intentId: existing.id,
        });
      }
      return raced.missionId ? { kind: "replay", intent: raced } : { kind: "in-progress", intent: raced };
    }
    const reclaimed = await this.get(existing.id);
    if (!reclaimed) {
      throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", `Command intent "${existing.id}" disappeared while being reclaimed`, {
        intentId: existing.id,
      });
    }
    return { kind: "claimed", intent: reclaimed };
  }

  async complete(id: string, missionId: string): Promise<CommandIntent> {
    const at = this.options.now();
    const { count } = await this.options.client.aiCommandIntent.updateMany({
      where: { id, state: "CLAIMED" },
      data: { state: "COMPLETED", missionId, updatedAt: at },
    });
    const current = await this.get(id);
    if (!current) {
      throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", `Command intent "${id}" does not exist`, { intentId: id });
    }
    // Idempotent: recording the same mission twice is not an error.
    if (current.missionId === missionId) return current;
    if (count === 0) {
      throw new AiWorkforceError(
        "MISSION_CONFLICT",
        `Command intent "${id}" was already resolved into mission "${current.missionId ?? "none"}"`,
        { intentId: id, missionId, existing: current.missionId ?? null },
      );
    }
    return current;
  }

  async fail(id: string, reason: string): Promise<CommandIntent> {
    const at = this.options.now();
    await this.options.client.aiCommandIntent.updateMany({
      where: { id, state: "CLAIMED" },
      data: { state: "FAILED", reason, updatedAt: at },
    });
    const current = await this.get(id);
    if (!current) {
      throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", `Command intent "${id}" does not exist`, { intentId: id });
    }
    return current;
  }

  async get(id: string): Promise<CommandIntent | null> {
    const row = await this.options.client.aiCommandIntent.findUnique({ where: { id } });
    return row ? toIntent(row) : null;
  }

  async findByKey(scope: string, idempotencyKey: string): Promise<CommandIntent | null> {
    const row = await this.options.client.aiCommandIntent.findUnique({
      where: { scope_idempotencyKey: { scope, idempotencyKey } },
    });
    return row ? toIntent(row) : null;
  }
}
