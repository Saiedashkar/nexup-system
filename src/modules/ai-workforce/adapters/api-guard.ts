import { NextResponse } from "next/server";
import { getCurrentSession, type Session } from "@/lib/auth";
import type { ActorContext } from "../core/execution-context";
import { actorFromSession, canUseWorkforce } from "./session-actor";

/**
 * API guard for the workforce endpoints.
 *
 * Defence in depth: the middleware already authenticates/authorises the route
 * prefix, and this re-checks the session inside the handler so a workforce
 * capability can never be reached on a request the legacy RBAC would refuse.
 *
 * Server-only.
 */

// String discriminant (see core/schema.ts) — boolean-literal unions do not
// narrow under this project's `strict: false`.
export type GuardResult =
  | { kind: "actor"; session: Session; actor: ActorContext }
  | { kind: "denied"; response: NextResponse };

export async function requireWorkforceActor(): Promise<GuardResult> {
  const session = await getCurrentSession();

  if (!session) {
    return { kind: "denied", response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const actor = actorFromSession(session);

  if (!canUseWorkforce(actor)) {
    return {
      kind: "denied",
      response: NextResponse.json(
        { error: "Access denied", reason: "MODULE_DISABLED", missing: ["aiworkforce.access"] },
        { status: 403 },
      ),
    };
  }

  return { kind: "actor", session, actor };
}
