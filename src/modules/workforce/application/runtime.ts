import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { Clock, IdFactory } from "@/modules/ai-workforce/core/types";
import { createWorkforcePrismaClient } from "@/modules/ai-workforce/persistence/prisma-client";
import {
  resolvePersistence,
  type PersistenceResolution,
} from "@/modules/ai-workforce/policies/persistence-safety";
import type { AgentRuntime } from "../runtimes/agent-runtime";
import {
  createHermesRuntime,
  NEXUP_HERMES_PROFILE,
  type HermesRuntimeConfig,
} from "../runtimes/hermes";
import { DeterministicHermesTransport } from "../runtimes/hermes/testing/deterministic-transport";
import { prismaBusinessScopeResolver } from "../persistence/prisma-business-scope";

import { createWorkforceApplication, type WorkforceApplication } from "./composition";

/**
 * The workforce application the running NEXUP uses.
 *
 * This is the module an API route imports. It resolves persistence ONCE per
 * process, and it is deliberately stricter than the Phase-1 engine:
 *
 *   AI_WORKFORCE_PERSISTENCE != "database"   → refuse (503), do not downgrade
 *   AI_WORKFORCE_DATABASE_URL not loopback   → refuse (503), do not downgrade
 *   verified isolated loopback database      → durable application
 *
 * The Phase-1 engine downgrades to memory and says so, because a job list on a
 * dashboard can be in-memory. A mission CANNOT: it would report success for work
 * that has no record, and the client's retry would create a second one. So the
 * mission lifecycle is durable or it is unavailable, and the reason the operator
 * sees is the reason the environment gave.
 *
 * The singleton is a Promise, so concurrent requests share one boot rather than
 * each opening its own pool.
 */

const APPLICATION_KEY = "__nexupWorkforceApplication";

/**
 * Explicit, guarded opt-in to a deterministic runtime for HTTP-level proofs.
 *
 * The API routes are only reachable through `getWorkforceApplication()`, so an
 * HTTP proof needs the RUNNING application to use a runtime that spends no real
 * provider turn. This is how that is allowed — and how it is kept from becoming
 * a way to run production on canned output:
 *
 *   - it is off unless the variable names the one supported value;
 *   - it is REFUSED unless persistence resolved to a verified LOCAL (loopback)
 *     database, so it can never be enabled against a production host;
 *   - the transport it binds declares `provenance: "TEST"`, and the adapter's
 *     own provenance gate is passed EXPLICITLY (`allowTestTransport: true`) —
 *     the same gate the production factory never opens.
 */
export const WORKFORCE_TEST_TRANSPORT_ENV = "AI_WORKFORCE_TEST_TRANSPORT";
/** Optional bounded hold, so an HTTP proof can observe an IN-FLIGHT run. */
export const WORKFORCE_TEST_TRANSPORT_HOLD_ENV = "AI_WORKFORCE_TEST_TRANSPORT_HOLD_MS";
/**
 * The config-seeded `userId → actorId` roster for authenticated human authority.
 *
 * JSON object whose values are an actor id or an ARRAY of actor ids:
 *
 *   AI_WORKFORCE_USER_ACTOR_MAP='{"user_1":"actor_founder"}'
 *
 * It exists because the workforce actor roster is a documented architecture gap
 * (there is no durable `ai_actors` table yet), so until it lands the operator
 * names the mapping explicitly. It is DELIBERATELY not a fallback: an unmapped
 * user fails closed at the decision boundary rather than becoming the Founder.
 */
export const WORKFORCE_USER_ACTOR_MAP_ENV = "AI_WORKFORCE_USER_ACTOR_MAP";

/**
 * PROOF-ONLY additional HUMAN authorities, so an HTTP proof can attribute a
 * decision to a NAMED person rather than the Founder channel.
 *
 *   AI_WORKFORCE_PROOF_HUMAN_ACTORS='[{"id":"actor_ada","slug":"ada","displayName":"Ada"}]'
 *
 * It is read ONLY in proof mode — the same `requested.kind === "RUNTIME"` branch
 * that binds the deterministic TEST transport, which itself requires BOTH
 * `AI_WORKFORCE_TEST_TRANSPORT=deterministic` AND a verified 127.0.0.1
 * workforce database.
 *
 * The fence is enforced at the posture decision, not in the parser below: with
 * the variable set but the proof posture NOT established, the application
 * REFUSES to boot (`RUNTIME_UNSUPPORTED`), exactly as an unsupported
 * `AI_WORKFORCE_TEST_TRANSPORT` value does. It is refused rather than silently
 * ignored because an operator who sets it believes named HUMAN authorities are
 * registered, and a normal runtime must never appear to honour it.
 *
 * So this adds NO production surface, and it is NOT the durable actor roster
 * (that remains a later architecture gap).
 */
export const WORKFORCE_PROOF_HUMAN_ACTORS_ENV = "AI_WORKFORCE_PROOF_HUMAN_ACTORS";

/** Parses the proof human-actor seeds. A malformed value is an ERROR, never ignored. */
export function parseProofHumanActors(
  value: string | undefined,
): Array<{ id: string; slug: string; displayName: string; role?: string }> {
  const raw = (value ?? "").trim();
  if (raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiWorkforceError("INVALID_INPUT", `${WORKFORCE_PROOF_HUMAN_ACTORS_ENV} is not valid JSON`, {
      variable: WORKFORCE_PROOF_HUMAN_ACTORS_ENV,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new AiWorkforceError("INVALID_INPUT", `${WORKFORCE_PROOF_HUMAN_ACTORS_ENV} must be a JSON array`, {
      variable: WORKFORCE_PROOF_HUMAN_ACTORS_ENV,
    });
  }
  return parsed.map((entry, index) => {
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
    const slug = typeof candidate?.slug === "string" ? candidate.slug.trim() : "";
    const displayName =
      typeof candidate?.displayName === "string" ? candidate.displayName.trim() : slug;
    if (!id || !slug) {
      throw new AiWorkforceError(
        "INVALID_INPUT",
        `${WORKFORCE_PROOF_HUMAN_ACTORS_ENV}[${index}] requires non-empty "id" and "slug"`,
        { variable: WORKFORCE_PROOF_HUMAN_ACTORS_ENV, index },
      );
    }
    return typeof candidate?.role === "string" && candidate.role.trim()
      ? { id, slug, displayName, role: candidate.role.trim() }
      : { id, slug, displayName };
  });
}

/**
 * Parses the mapping. A malformed value is an ERROR, never an empty map: an
 * operator who set the variable and typo'd it must not silently lose the roster.
 */
export function parseUserActorMap(value: string | undefined): Record<string, string[]> {
  const raw = (value ?? "").trim();
  if (raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiWorkforceError("INVALID_INPUT", `${WORKFORCE_USER_ACTOR_MAP_ENV} is not valid JSON`, {
      variable: WORKFORCE_USER_ACTOR_MAP_ENV,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AiWorkforceError("INVALID_INPUT", `${WORKFORCE_USER_ACTOR_MAP_ENV} must be a JSON object`, {
      variable: WORKFORCE_USER_ACTOR_MAP_ENV,
    });
  }
  const mapping: Record<string, string[]> = {};
  for (const [userId, target] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof target === "string") mapping[userId] = [target];
    else if (Array.isArray(target) && target.every((entry) => typeof entry === "string")) {
      mapping[userId] = [...(target as string[])];
    } else {
      throw new AiWorkforceError(
        "INVALID_INPUT",
        `${WORKFORCE_USER_ACTOR_MAP_ENV} values must be a string or an array of strings`,
        { variable: WORKFORCE_USER_ACTOR_MAP_ENV, userId },
      );
    }
  }
  return mapping;
}

export type WorkforceRuntimeResolution =
  /** Bind this runtime explicitly. */
  | { kind: "RUNTIME"; runtime: AgentRuntime; reason: string }
  /** Resolve the runtime from the environment, exactly as production does. */
  | { kind: "ENV"; reason: string }
  /** The request is unsafe or unsupported: the application must not boot. */
  | { kind: "REFUSED"; reason: string };

/**
 * Whether proof-only HUMAN actor seeds were supplied — i.e. the operator asked
 * for the proof posture. A presence check only: parsing and validation stay in
 * `parseProofHumanActors`, which a verified proof posture is the only path to.
 */
function proofHumanActorSeedsRequested(env: Record<string, string | undefined>): boolean {
  return (env[WORKFORCE_PROOF_HUMAN_ACTORS_ENV] ?? "").trim() !== "";
}

/** @throws never — every refusal is returned, so the caller can report it. */
export function resolveApplicationRuntime(
  env: Record<string, string | undefined>,
  persistence: PersistenceResolution,
  deps: { ids?: IdFactory; now?: Clock } = {},
): WorkforceRuntimeResolution {
  const requested = (env[WORKFORCE_TEST_TRANSPORT_ENV] ?? "").trim().toLowerCase();
  if (requested === "") {
    // Proof-only HUMAN actors carry the SAME two conditions as the proof
    // transport, and a normal runtime must never look as though it honoured
    // them. Present without the proof posture → refuse to boot, loudly.
    if (proofHumanActorSeedsRequested(env)) {
      return {
        kind: "REFUSED",
        reason: `${WORKFORCE_PROOF_HUMAN_ACTORS_ENV} is proof-only and requires ${WORKFORCE_TEST_TRANSPORT_ENV}=deterministic against a verified 127.0.0.1 workforce database; refusing to boot a normal runtime with proof actors configured`,
      };
    }
    return { kind: "ENV", reason: "no runtime override requested; resolving Hermes from the environment" };
  }
  if (requested !== "deterministic") {
    return { kind: "REFUSED", reason: `${WORKFORCE_TEST_TRANSPORT_ENV}="${requested}" is not a supported value` };
  }

  const local =
    persistence.kind === "DATABASE" && persistence.info.target === "local" && persistence.info.host === "127.0.0.1";
  if (!local) {
    return {
      kind: "REFUSED",
      reason: `${WORKFORCE_TEST_TRANSPORT_ENV}=deterministic requires a verified 127.0.0.1 workforce database; refusing to bind a TEST transport to anything else`,
    };
  }

  const hold = Number.parseInt(env[WORKFORCE_TEST_TRANSPORT_HOLD_ENV] ?? "0", 10);
  const holdCompletionMs = Number.isFinite(hold) && hold > 0 ? hold : 0;
  const transport = new DeterministicHermesTransport(
    holdCompletionMs > 0 ? { holdCompletionMs } : {},
  );

  const config: HermesRuntimeConfig = {
    runtimeId: "runtime_hermes_deterministic_proof",
    displayName: "Hermes Agent Runtime (deterministic proof transport)",
    transport: "BRIDGE",
    profile: NEXUP_HERMES_PROFILE,
    bridgeEndpoint: "http://127.0.0.1/unused-deterministic-proof",
    bridgeKeyId: "deterministic-proof",
    bridgeSecretPresent: false,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  };

  const runtime = createHermesRuntime(config, {
    transport,
    allowTestTransport: true,
    ...(deps.ids ? { ids: deps.ids } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  return {
    kind: "RUNTIME",
    runtime,
    reason: "deterministic TEST transport bound against a verified loopback database (proof mode)",
  };
}

type ApplicationHolder = { [APPLICATION_KEY]?: Promise<WorkforceApplication> };

/** The reason the durable application is not available, without throwing. */
export function workforceApplicationStatus(): { available: boolean; reason: string; database?: string } {
  const resolution = resolvePersistence();
  if (resolution.kind !== "DATABASE") {
    return { available: false, reason: resolution.reason };
  }
  return { available: true, reason: resolution.reason, database: resolution.info.database };
}

/**
 * @throws PERSISTENCE_UNAVAILABLE when this process is not configured with a
 *         verified isolated database. It never falls back to memory.
 */
export function getWorkforceApplication(): Promise<WorkforceApplication> {
  const holder = globalThis as unknown as ApplicationHolder;
  if (!holder[APPLICATION_KEY]) {
    const boot = (async (): Promise<WorkforceApplication> => {
      const resolution = resolvePersistence();
      if (resolution.kind !== "DATABASE") {
        throw new AiWorkforceError(
          "PERSISTENCE_UNAVAILABLE",
          `The mission lifecycle requires a durable database (${resolution.reason}). Set AI_WORKFORCE_PERSISTENCE=database and a loopback AI_WORKFORCE_DATABASE_URL, or apply the proposed migration.`,
          { reason: resolution.reason },
        );
      }

      const handle = createWorkforcePrismaClient(resolution.info.url);
      try {
        const requested = resolveApplicationRuntime(process.env, resolution);
        if (requested.kind === "REFUSED") {
          throw new AiWorkforceError("RUNTIME_UNSUPPORTED", `Workforce application cannot start: ${requested.reason}`, {
            reason: requested.reason,
          });
        }
        // Proof mode is the ONLY posture that both binds the deterministic TEST
        // transport AND may seed extra HUMAN authorities. Both are gated by the
        // same branch, so neither can reach a production database.
        const proofMode = requested.kind === "RUNTIME";
        const application = await createWorkforceApplication(handle, {
          ...(proofMode ? { runtime: requested.runtime } : {}),
          humanActorMap: parseUserActorMap(process.env[WORKFORCE_USER_ACTOR_MAP_ENV]),
          ...(proofMode
            ? { humanActorSeeds: parseProofHumanActors(process.env[WORKFORCE_PROOF_HUMAN_ACTORS_ENV]) }
            : {}),
          businessScope: prismaBusinessScopeResolver,
        });
        return { ...application, disconnect: handle.disconnect };
      } catch (error) {
        // Never leave a half-open pool behind when the boot refuses.
        await handle.disconnect().catch(() => undefined);
        throw error;
      }
    })();

    holder[APPLICATION_KEY] = boot;
    // Do not cache a failed boot forever: the next request may follow a fix.
    boot.catch(() => {
      if (holder[APPLICATION_KEY] === boot) delete holder[APPLICATION_KEY];
    });
  }
  return holder[APPLICATION_KEY];
}
