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

export type WorkforceRuntimeResolution =
  /** Bind this runtime explicitly. */
  | { kind: "RUNTIME"; runtime: AgentRuntime; reason: string }
  /** Resolve the runtime from the environment, exactly as production does. */
  | { kind: "ENV"; reason: string }
  /** The request is unsafe or unsupported: the application must not boot. */
  | { kind: "REFUSED"; reason: string };

/** @throws never — every refusal is returned, so the caller can report it. */
export function resolveApplicationRuntime(
  env: Record<string, string | undefined>,
  persistence: PersistenceResolution,
  deps: { ids?: IdFactory; now?: Clock } = {},
): WorkforceRuntimeResolution {
  const requested = (env[WORKFORCE_TEST_TRANSPORT_ENV] ?? "").trim().toLowerCase();
  if (requested === "") {
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
        const application = await createWorkforceApplication(
          handle,
          requested.kind === "RUNTIME" ? { runtime: requested.runtime } : {},
        );
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
