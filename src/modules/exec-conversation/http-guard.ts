import type { NextRequest } from "next/server";

/**
 * Origin/CSRF guard for the single EXEC mutation.
 *
 * The trusted origin is an EXPLICIT, configured value (`EXEC_TRUSTED_ORIGIN`).
 * It is never derived from `Origin` or `Host`, because a guard that derives its
 * own expectation from the attacker-controlled request can always be satisfied.
 * There is no CORS support anywhere: a cross-origin caller gets 403, not a
 * preflight.
 *
 * Decision table (any failure ⇒ 403 CSRF_REJECTED):
 *
 *   trusted origin unset / malformed            → reject
 *   Origin present, not exactly the trusted one → reject (whatever Sec-Fetch-Site says)
 *   Origin "null", empty, multiple, malformed   → reject
 *   Origin exact, Sec-Fetch-Site present ≠ same-origin → reject
 *   Origin absent, Sec-Fetch-Site ≠ same-origin → reject
 *   Origin absent, Sec-Fetch-Site same-origin, request origin ≠ trusted → reject
 *   anything ambiguous                          → reject
 *
 * Server-only, pure: it reads the request and the environment, nothing else.
 */

/** String discriminant: boolean-literal unions do not narrow under `strict: false`. */
export type ExecOriginCheck = { kind: "allow" } | { kind: "reject"; reason: string };

function parseTrustedOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A trusted origin is an origin: no path, query, hash or credentials.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.origin;
}

export function checkExecRequestOrigin(
  request: NextRequest,
  env: NodeJS.ProcessEnv = process.env,
): ExecOriginCheck {
  const trusted = parseTrustedOrigin((env.EXEC_TRUSTED_ORIGIN ?? "").trim());
  if (trusted === null) return { kind: "reject", reason: "trusted_origin_unusable" };

  const originHeader = request.headers.get("origin");
  const fetchSite = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();

  if (originHeader === null) {
    // No Origin at all: only a browser-asserted same-origin navigation may
    // proceed, and only when the request really addressed the trusted origin.
    if (fetchSite !== "same-origin") return { kind: "reject", reason: "origin_missing" };
    let requestOrigin: string;
    try {
      requestOrigin = request.nextUrl.origin;
    } catch {
      return { kind: "reject", reason: "request_origin_unavailable" };
    }
    if (requestOrigin !== trusted) return { kind: "reject", reason: "request_origin_mismatch" };
    return { kind: "allow" };
  }

  const origin = originHeader.trim();
  if (origin.length === 0 || origin.toLowerCase() === "null") {
    return { kind: "reject", reason: "origin_opaque" };
  }
  if (origin.includes(",")) return { kind: "reject", reason: "origin_multiple" };
  if (origin !== trusted) return { kind: "reject", reason: "origin_mismatch" };

  // Exact Origin match is necessary but not sufficient: a browser that says
  // the request is cross-site contradicts the claim, so refuse.
  if (fetchSite.length > 0 && fetchSite !== "same-origin") {
    return { kind: "reject", reason: "sec_fetch_site_mismatch" };
  }

  return { kind: "allow" };
}
