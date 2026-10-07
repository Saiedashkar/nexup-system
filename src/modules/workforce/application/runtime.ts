import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import { createWorkforcePrismaClient } from "@/modules/ai-workforce/persistence/prisma-client";
import { resolvePersistence } from "@/modules/ai-workforce/policies/persistence-safety";

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
        const application = await createWorkforceApplication(handle);
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
