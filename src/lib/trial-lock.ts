/**
 * TRIAL WRITE LOCK — the runtime half
 * ───────────────────────────────────
 * `TRIAL_READ_ONLY=1` makes a private trial a read surface. It is enforced in TWO
 * places on purpose, because they see different environments:
 *
 *   · `src/middleware.ts` runs as EDGE middleware, whose `process.env` is resolved
 *     at BUILD time (Next inlines it). A trial image is therefore built with
 *     `--build-arg TRIAL_READ_ONLY=1`, and that layer closes every API family,
 *     including the ones with no shared handler.
 *   · this module is imported by the Node route handlers, where `process.env` is
 *     read at REQUEST time. A deployment that forgot the build arg still cannot
 *     write through the directory routes — measured: the build without the arg
 *     answered 201 before this module existed, and 403 after.
 *
 * Neither layer touches reads, and with the variable unset every behaviour is
 * exactly what it was before.
 */

export const TRIAL_READ_ONLY_ERROR = "This trial is read-only.";

export function trialWriteDenial(): { status: 403; error: string } | null {
  if (process.env.TRIAL_READ_ONLY !== "1") return null;
  return { status: 403, error: TRIAL_READ_ONLY_ERROR };
}
