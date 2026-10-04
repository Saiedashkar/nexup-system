import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { requiresRuntime, type Actor } from "../actors/actor-contracts";
import type { RuntimeId } from "../core/refs";
import type { AgentRuntime, RuntimeIdentity, RuntimeType } from "./agent-runtime";

/**
 * Runtime registry.
 *
 * Holds the available execution runtimes by id. It answers "which runtime may
 * host this actor's work?" and — crucially — the answer may legitimately be
 * `null` for a human or service actor. Only AI agents are required to have a
 * runtime; the registry never invents one to satisfy a type.
 */

export interface RuntimeRegistry {
  register(runtime: AgentRuntime): void;
  get(id: RuntimeId): AgentRuntime | undefined;
  /** @throws RUNTIME_NOT_FOUND */
  require(id: RuntimeId): AgentRuntime;
  list(): RuntimeIdentity[];
  findByType(type: RuntimeType): RuntimeIdentity[];
  /**
   * The runtime bound to an actor, or `null` for humans/services.
   * @throws RUNTIME_NOT_FOUND when a binding points at an unregistered runtime
   * @throws RUNTIME_UNSUPPORTED when an AI agent has no usable runtime
   */
  runtimeForActor(actor: Actor): AgentRuntime | null;
  count(): number;
}

export class InMemoryRuntimeRegistry implements RuntimeRegistry {
  private readonly runtimes = new Map<RuntimeId, AgentRuntime>();

  register(runtime: AgentRuntime): void {
    const identity = runtime.identity;
    if (!identity?.id || !identity.type) {
      throw new AiWorkforceError("RUNTIME_UNSUPPORTED", "Runtime identity requires an id and a type");
    }
    if (this.runtimes.has(identity.id)) {
      throw new AiWorkforceError("RUNTIME_UNSUPPORTED", `Runtime "${identity.id}" is already registered`, {
        runtimeId: identity.id,
      });
    }
    this.runtimes.set(identity.id, runtime);
  }

  get(id: RuntimeId): AgentRuntime | undefined {
    return this.runtimes.get(id);
  }

  require(id: RuntimeId): AgentRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      throw new AiWorkforceError("RUNTIME_NOT_FOUND", `No runtime registered with id "${id}"`, { runtimeId: id });
    }
    return runtime;
  }

  list(): RuntimeIdentity[] {
    return [...this.runtimes.values()].map((runtime) => ({ ...runtime.identity })).sort((a, b) => a.id.localeCompare(b.id));
  }

  findByType(type: RuntimeType): RuntimeIdentity[] {
    return this.list().filter((identity) => identity.type === type);
  }

  runtimeForActor(actor: Actor): AgentRuntime | null {
    const binding = actor.runtimeBinding;
    if (binding) {
      return this.require(binding.runtimeId);
    }
    if (requiresRuntime(actor.type)) {
      throw new AiWorkforceError(
        "RUNTIME_UNSUPPORTED",
        `Actor "${actor.slug}" (${actor.type}) requires a runtime but has no runtime binding`,
        { actorId: actor.id, type: actor.type },
      );
    }
    // Humans and service/system identities execute without an AgentRuntime.
    return null;
  }

  count(): number {
    return this.runtimes.size;
  }
}
