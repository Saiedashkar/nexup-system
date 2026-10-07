import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";

/**
 * The Command idempotency ledger.
 *
 * Two retries of the SAME request must produce ONE mission, and a genuinely new
 * request must still produce a new one. That is a decision about identity, so it
 * needs a record that outlives the process making it — otherwise a redeploy
 * between a client's retry and its original request turns one Command into two
 * real executions.
 *
 * The claim is the algorithm, not a step in one:
 *
 *   claimed      this caller won the key; go build the mission
 *   replay       same key, same payload, mission already recorded → return it
 *   in-progress  same key, same payload, mission not recorded YET → retry later
 *   conflict     same key, DIFFERENT payload → refuse; the key is not a wildcard
 *
 * `conflict` is the case that makes this safe: without it, a client reusing a key
 * for different work would silently receive the earlier mission's result and
 * believe its own work was done.
 *
 * The durable implementation leans on a UNIQUE index over (scope, key), so
 * "claimed" is a single INSERT and two concurrent callers cannot both win. The
 * in-memory implementation exists for deterministic unit tests only.
 */

export const COMMAND_INTENT_STATES = ["CLAIMED", "COMPLETED", "FAILED"] as const;
export type CommandIntentState = (typeof COMMAND_INTENT_STATES)[number];

export function isCommandIntentState(value: string): value is CommandIntentState {
  return (COMMAND_INTENT_STATES as readonly string[]).includes(value);
}

export type CommandIntent = {
  id: string;
  scope: string;
  idempotencyKey: string;
  commandHash: string;
  state: CommandIntentState;
  /** The Mission this claim owns. Absent while the claim is CLAIMED. */
  missionId?: string;
  requestedBy: string;
  capabilityId?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CommandIntentClaimInput = {
  scope: string;
  idempotencyKey: string;
  commandHash: string;
  requestedBy: string;
  capabilityId?: string;
};

export type CommandIntentClaim =
  | { kind: "claimed"; intent: CommandIntent }
  | { kind: "replay"; intent: CommandIntent }
  | { kind: "in-progress"; intent: CommandIntent }
  | { kind: "conflict"; intent: CommandIntent };

export type CommandIntentRepository = {
  /** Atomically claims the key, or explains who else already holds it. */
  claim(input: CommandIntentClaimInput): Promise<CommandIntentClaim>;
  /** Records the mission the claim produced. */
  complete(id: string, missionId: string): Promise<CommandIntent>;
  /** Records that the build failed, so the key is honestly resolved. */
  fail(id: string, reason: string): Promise<CommandIntent>;
  get(id: string): Promise<CommandIntent | null>;
  findByKey(scope: string, idempotencyKey: string): Promise<CommandIntent | null>;
};

export type InMemoryCommandIntentRepositoryOptions = {
  ids: IdFactory;
  now: Clock;
};

/**
 * In-memory ledger — for deterministic unit tests.
 *
 * JavaScript runs this to completion without yielding, so a claim here is atomic
 * for the same reason a single-threaded map insert is. It is NOT the production
 * path: the application composition refuses to start on it.
 */
export class InMemoryCommandIntentRepository implements CommandIntentRepository {
  private readonly byId = new Map<string, CommandIntent>();
  private readonly byKeyIndex = new Map<string, string>();

  constructor(private readonly deps: InMemoryCommandIntentRepositoryOptions) {}

  static key(scope: string, idempotencyKey: string): string {
    return `${scope}\u0000${idempotencyKey}`;
  }

  async claim(input: CommandIntentClaimInput): Promise<CommandIntentClaim> {
    const existingId = this.byKeyIndex.get(InMemoryCommandIntentRepository.key(input.scope, input.idempotencyKey));
    if (existingId) return this.adopt(this.byId.get(existingId)!, input.commandHash);

    const at = this.deps.now().toISOString();
    const intent: CommandIntent = {
      id: this.deps.ids.next("intent"),
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      commandHash: input.commandHash,
      state: "CLAIMED",
      requestedBy: input.requestedBy,
      createdAt: at,
      updatedAt: at,
    };
    if (input.capabilityId) intent.capabilityId = input.capabilityId;
    this.byId.set(intent.id, intent);
    this.byKeyIndex.set(InMemoryCommandIntentRepository.key(input.scope, input.idempotencyKey), intent.id);
    return { kind: "claimed", intent };
  }

  async complete(id: string, missionId: string): Promise<CommandIntent> {
    const current = this.require(id);
    if (current.state === "COMPLETED" && current.missionId === missionId) return current;
    if (current.state === "COMPLETED" && current.missionId !== missionId) {
      throw new AiWorkforceError("MISSION_CONFLICT", `Command intent "${id}" already completed into mission "${current.missionId}"`, {
        intentId: id,
        missionId,
      });
    }
    const next: CommandIntent = {
      ...current,
      state: "COMPLETED",
      missionId,
      updatedAt: this.deps.now().toISOString(),
    };
    this.byId.set(id, next);
    return next;
  }

  async fail(id: string, reason: string): Promise<CommandIntent> {
    const current = this.require(id);
    if (current.state === "COMPLETED") return current;
    const next: CommandIntent = {
      ...current,
      state: "FAILED",
      reason,
      updatedAt: this.deps.now().toISOString(),
    };
    this.byId.set(id, next);
    return next;
  }

  async get(id: string): Promise<CommandIntent | null> {
    return this.byId.get(id) ?? null;
  }

  async findByKey(scope: string, idempotencyKey: string): Promise<CommandIntent | null> {
    const id = this.byKeyIndex.get(InMemoryCommandIntentRepository.key(scope, idempotencyKey));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  /**
   * The key already exists. Same payload + a recorded mission is a replay; same
   * payload with no mission yet is either a claim still being built or a claim
   * whose build failed — and a FAILED claim is retryable with the same record
   * rather than a new one.
   */
  private adopt(intent: CommandIntent, commandHash: string): CommandIntentClaim {
    if (intent.commandHash !== commandHash) return { kind: "conflict", intent };
    if (intent.missionId) return { kind: "replay", intent };
    if (intent.state !== "FAILED") return { kind: "in-progress", intent };

    const reclaimed: CommandIntent = { ...intent, state: "CLAIMED", updatedAt: this.deps.now().toISOString() };
    delete reclaimed.reason;
    this.byId.set(reclaimed.id, reclaimed);
    return { kind: "claimed", intent: reclaimed };
  }

  private require(id: string): CommandIntent {
    const intent = this.byId.get(id);
    if (!intent) {
      throw new AiWorkforceError("PERSISTENCE_UNAVAILABLE", `Command intent "${id}" is not in this ledger`, { intentId: id });
    }
    return intent;
  }
}
