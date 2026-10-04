import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import { assertNoCredentials } from "../core/credentials";
import type { ActorId, ActorSlug } from "../core/refs";
import {
  ACTOR_LIFECYCLE_STATES,
  DEFAULT_MEMORY_SCOPE,
  INHERIT_APPROVAL,
  assertActorRegistration,
  type Actor,
  type ActorFilter,
  type ActorLifecycleState,
  type ActorRegistrationInput,
} from "./actor-contracts";
import { applyActorLifecycle } from "./actor-lifecycle";

/**
 * Actor registry port.
 *
 * The registry is the ONLY authority on workforce actor identity. Two
 * implementations exist conceptually: an in-memory one (tests + the default
 * isolated runtime) and — later — a persisted one. Nothing else in the domain
 * may hold actor state of its own.
 *
 * Registration is where identity rules are enforced once: slug uniqueness,
 * shape validity, and the credential guard (an actor row is identity + policy,
 * never a secret).
 */

export interface ActorRegistry {
  register(input: ActorRegistrationInput): Promise<Actor>;
  get(id: ActorId): Promise<Actor | null>;
  /** @throws ACTOR_NOT_FOUND */
  require(id: ActorId): Promise<Actor>;
  findBySlug(slug: ActorSlug): Promise<Actor | null>;
  /** Resolves by id first, then by slug. @throws ACTOR_NOT_FOUND */
  resolve(idOrSlug: string): Promise<Actor>;
  list(filter?: ActorFilter): Promise<Actor[]>;
  /** @throws INVALID_ACTOR_TRANSITION | ACTOR_NOT_FOUND */
  updateLifecycle(id: ActorId, to: ActorLifecycleState, reason?: string): Promise<Actor>;
  count(): number;
}

function clone(actor: Actor): Actor {
  return JSON.parse(JSON.stringify(actor)) as Actor;
}

export class InMemoryActorRegistry implements ActorRegistry {
  private readonly rows = new Map<ActorId, Actor>();

  constructor(private readonly deps: { ids: IdFactory; now: Clock }) {}

  async register(input: ActorRegistrationInput): Promise<Actor> {
    assertActorRegistration(input);
    assertNoCredentials(input, `Actor "${input.slug}"`);

    if (input.id && this.rows.has(input.id)) {
      throw new AiWorkforceError("ACTOR_SLUG_TAKEN", `Actor id "${input.id}" is already registered`, { id: input.id });
    }
    if ([...this.rows.values()].some((actor) => actor.slug === input.slug)) {
      throw new AiWorkforceError("ACTOR_SLUG_TAKEN", `Actor slug "${input.slug}" is already taken`, { slug: input.slug });
    }

    const at = this.deps.now().toISOString();
    const actor: Actor = {
      id: input.id ?? this.deps.ids.next("actor"),
      slug: input.slug,
      displayName: input.displayName,
      type: input.type,
      role: input.role,
      department: input.department ?? null,
      reportsTo: input.reportsTo ?? null,
      collaborators: input.collaborators ? [...input.collaborators] : [],
      lifecycle: input.lifecycle ?? "DRAFT",
      runtimeBinding: input.runtimeBinding ?? null,
      modelPolicy: input.modelPolicy ?? null,
      autonomyLevel: input.autonomyLevel ?? "MANUAL",
      memoryScope: input.memoryScope ?? { ...DEFAULT_MEMORY_SCOPE },
      permissions: input.permissions ? [...input.permissions] : [],
      approvalPolicy: input.approvalPolicy ?? { ...INHERIT_APPROVAL },
      escalationTarget: input.escalationTarget ?? null,
      metadata: input.metadata ?? {},
      createdAt: at,
      updatedAt: at,
    };

    this.rows.set(actor.id, actor);
    return clone(actor);
  }

  async get(id: ActorId): Promise<Actor | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async require(id: ActorId): Promise<Actor> {
    const actor = await this.get(id);
    if (!actor) {
      throw new AiWorkforceError("ACTOR_NOT_FOUND", `Actor "${id}" does not exist`, { actorId: id });
    }
    return actor;
  }

  async findBySlug(slug: ActorSlug): Promise<Actor | null> {
    const row = [...this.rows.values()].find((actor) => actor.slug === slug);
    return row ? clone(row) : null;
  }

  async resolve(idOrSlug: string): Promise<Actor> {
    const byId = await this.get(idOrSlug);
    if (byId) return byId;
    const bySlug = await this.findBySlug(idOrSlug);
    if (bySlug) return bySlug;
    throw new AiWorkforceError("ACTOR_NOT_FOUND", `No actor matches "${idOrSlug}"`, { ref: idOrSlug });
  }

  async list(filter: ActorFilter = {}): Promise<Actor[]> {
    return [...this.rows.values()]
      .filter((actor) => {
        if (filter.type && actor.type !== filter.type) return false;
        if (filter.lifecycle && actor.lifecycle !== filter.lifecycle) return false;
        if (filter.department && actor.department !== filter.department) return false;
        if (filter.runtimeId && actor.runtimeBinding?.runtimeId !== filter.runtimeId) return false;
        return true;
      })
      .map(clone)
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  async updateLifecycle(id: ActorId, to: ActorLifecycleState, reason?: string): Promise<Actor> {
    if (!(ACTOR_LIFECYCLE_STATES as readonly string[]).includes(to)) {
      throw new AiWorkforceError("INVALID_ACTOR_TRANSITION", `Unknown lifecycle state "${to}"`, { to: to as string });
    }
    const existing = this.rows.get(id);
    if (!existing) {
      throw new AiWorkforceError("ACTOR_NOT_FOUND", `Actor "${id}" does not exist`, { actorId: id });
    }

    const transitioned = applyActorLifecycle(existing, to, this.deps.now().toISOString());
    // The reason is audit context, not identity — it is stashed in metadata
    // (namespaced) so a DISABLED/REVIEW decision is explainable later.
    const next: Actor = reason
      ? { ...transitioned, metadata: { ...transitioned.metadata, lifecycleReason: reason } }
      : transitioned;
    this.rows.set(next.id, next);
    return clone(next);
  }

  count(): number {
    return this.rows.size;
  }
}
