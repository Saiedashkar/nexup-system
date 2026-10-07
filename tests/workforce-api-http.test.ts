import { execFileSync } from "node:child_process";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

/**
 * STEP 5/8 — THE HTTP BOUNDARY.
 *
 * Every other proof in this repository calls the application composition
 * directly. This one does not: it speaks HTTP to a RUNNING Next.js server
 * (`next start`), with a real signed session cookie, against the real route
 * handlers, the real guard, the real middleware and the real serialization.
 *
 * That distinction matters because the routes are where the boundary contracts
 * live: which actor a request is attributed to, which status a refusal gets,
 * what an error body may contain, and whether a retry really returns the same
 * mission. None of that is exercised by calling `commands.issueCommand`.
 *
 * The runtime behind the server is the DETERMINISTIC transport, enabled by
 * `AI_WORKFORCE_TEST_TRANSPORT=deterministic` — which the application refuses to
 * honour unless persistence resolved to a verified loopback database. So this
 * spends no provider turn, and it cannot be pointed at production.
 *
 * Run it through `scripts/run-api-http-proof.sh`, which builds, starts the
 * server, runs this file and stops it.
 */

const BASE_URL = process.env.WORKFORCE_API_BASE_URL;
const AUTH_SECRET = process.env.AUTH_SECRET;
const APP_DATABASE_URL = process.env.WORKFORCE_API_DATABASE_URL;
const PSQL_BIN = process.env.PSQL_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";

const describeIfServer = BASE_URL && AUTH_SECRET ? describe : describe.skip;

/** The stack that may never appear in a response body. */
const FORBIDDEN_IN_BODIES = [
  "postgresql://",
  "postgres://",
  "HERMES_RUNTIME",
  "bridge.invalid",
  "bridgeEndpoint",
  "AI_WORKFORCE_DATABASE_URL",
  "AUTH_SECRET",
  "password",
];

type Auth = { cookie?: string; label: string };

async function mintSession(overrides: Record<string, unknown> = {}): Promise<string> {
  const claims = {
    name: "HTTP Proof Founder",
    role: "SUPER_ADMIN",
    businessId: "all",
    canAccessNexup: true,
    canAccessRebound: true,
    canAccessAbomazen: true,
    canAccessOfficeFinanceFull: true,
    ...overrides,
  };
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(overrides.sub ? String(overrides.sub) : "proof-user-1")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(AUTH_SECRET));
  return `nexup_session=${token}`;
}

type Result = { status: number; body: unknown; text: string };

async function call(
  path: string,
  options: { method?: string; body?: unknown; auth?: Auth; raw?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.raw !== undefined) headers["content-type"] = "application/json";
  if (options.auth?.cookie) headers.cookie = options.auth.cookie;
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.raw !== undefined ? { body: options.raw } : options.body !== undefined ? { body: JSON.stringify(options.body), headers: { ...headers, "content-type": "application/json" } } : {}),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

function psql(sql: string): string {
  if (!APP_DATABASE_URL) throw new Error("WORKFORCE_API_DATABASE_URL must be set for row-level checks");
  const url = new URL(APP_DATABASE_URL);
  return execFileSync(
    PSQL_BIN,
    [
      "-h", url.hostname,
      "-p", url.port || "5432",
      "-U", "postgres",
      "-w",
      "-t",
      "-A",
      "-v", "ON_ERROR_STOP=1",
      "-c", sql,
      "-d", url.pathname.replace(/^\//, ""),
    ],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" },
  ).trim();
}

function commandBody(key: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: key,
    scope: "proof:http",
    title: `HTTP proof ${key}`,
    goal: "prove the HTTP boundary",
    tasks: [{ title: `${key}-task`, objective: "produce a brief", instruction: "Return exactly: NEXUP_HTTP_PROOF_OK" }],
    ...overrides,
  };
}

describeIfServer("STEP 5 — the AI Workforce HTTP routes, against a running server", () => {
  const founder: Auth = { label: "founder" };

  it("refuses an unauthenticated request with 401, and says nothing else", async () => {
    const read = await call("/api/ai-workforce/missions", { auth: { label: "anonymous" } });
    expect(read.status).toBe(401);

    const write = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-unauth"),
      auth: { label: "anonymous" },
    });
    expect(write.status).toBe(401);
    expect(read.text).not.toMatch(/postgres|HERMES|secret/i);
  });

  it("refuses a signed-in user with no workforce access (403), before any lifecycle work", async () => {
    // A real, SIGNED-IN session — but with no business access and no finance
    // role, so it holds no `aiworkforce.access` token. (The session vocabulary
    // is SUPER_ADMIN | ADMIN | EMPLOYEE; anything else is not a session at all,
    // which would be a 401 rather than the 403 this case is about.)
    const cookie = await mintSession({
      sub: "no-access-user",
      role: "EMPLOYEE",
      businessId: "none",
      canAccessNexup: false,
      canAccessRebound: false,
      canAccessAbomazen: false,
      canAccessOfficeFinanceFull: false,
    });
    const before = Number(psql(`select count(*) from "ai_missions"`));
    const response = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-forbidden"),
      auth: { cookie, label: "no-access" },
    });
    expect(response.status).toBe(403);
    // Refused by the route-prefix middleware (defence in depth) or by the
    // handler's own guard — both are 403, and both say the same thing.
    expect(response.text).toMatch(/Access denied|aiworkforce\.access/);
    // Nothing was created by a refused request.
    expect(Number(psql(`select count(*) from "ai_missions"`))).toBe(before);
  });

  it("issues a Command over HTTP, and reports the durable mission it created", async () => {
    founder.cookie = await mintSession();
    const created = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-1"),
      auth: founder,
    });

    expect(created.status).toBe(201);
    const body = created.body as {
      status: string;
      replayed: boolean;
      mission: { id: string; state: string; owner: string };
      tasks: Array<{ state: string; assignedActorId: string | null }>;
      routing: { enabled: boolean; actorId?: string };
    };
    expect(body.status).toBe("ISSUED");
    expect(body.replayed).toBe(false);
    expect(body.routing.enabled).toBe(true);
    expect(body.mission.state).toBe("RUNNING");
    expect(body.tasks[0]!.state).toBe("RUNNING");
    expect(body.tasks[0]!.assignedActorId).toBe(body.routing.actorId);

    // The row exists in the DATABASE, not just in the response.
    expect(psql(`select state from "ai_missions" where id = '${body.mission.id}'`)).toBe("RUNNING");
    const key = await call("/api/ai-workforce/missions?limit=50", { auth: founder });
    expect(key.status).toBe(200);
  }, 60_000);

  it("returns the SAME mission for an idempotent retry, and creates no second execution", async () => {
    const first = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-retry"),
      auth: founder,
    });
    expect(first.status).toBe(201);
    const missionId = (first.body as { mission: { id: string } }).mission.id;
    const executions = psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`);

    const retry = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-retry"),
      auth: founder,
    });
    expect(retry.status).toBe(200);
    const body = retry.body as { status: string; replayed: boolean; mission: { id: string }; tasks: unknown[] };
    expect(body.status).toBe("REPLAYED");
    expect(body.replayed).toBe(true);
    expect(body.mission.id).toBe(missionId);
    expect(body.tasks).toHaveLength(1);

    // The retry did not produce a second attempt, in the rows.
    expect(psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`)).toBe(executions);
    expect(psql(`select count(*) from "ai_missions" where id = '${missionId}'`)).toBe("1");
  }, 60_000);

  it("refuses a reused idempotency key carrying a DIFFERENT command (409)", async () => {
    await call("/api/ai-workforce/missions", { method: "POST", body: commandBody("http-reuse"), auth: founder });
    const conflicting = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-reuse", { goal: "a completely different goal" }),
      auth: founder,
    });
    expect(conflicting.status).toBe(409);
    const body = conflicting.body as { error: string };
    expect(body.error).toBe("COMMAND_KEY_REUSED");
  }, 60_000);

  it("rejects malformed input without touching the lifecycle", async () => {
    const noKey = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: { title: "no key", tasks: [{ title: "t", objective: "o", instruction: "i" }] },
      auth: founder,
    });
    expect(noKey.status).toBe(400);

    const notJson = await call("/api/ai-workforce/missions", {
      method: "POST",
      raw: "{not json",
      auth: founder,
    });
    expect(notJson.status).toBe(400);

    const badDecision = await call("/api/ai-workforce/decisions", {
      method: "POST",
      body: { reviewId: "r1", decision: "MAYBE" },
      auth: founder,
    });
    expect(badDecision.status).toBe(400);

    const missingReview = await call("/api/ai-workforce/decisions", {
      method: "POST",
      body: { decision: "APPROVED" },
      auth: founder,
    });
    expect(missingReview.status).toBe(400);
  }, 60_000);

  it("reads a mission, settles it over HTTP, and completes it with a human decision", async () => {
    const created = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: commandBody("http-lifecycle"),
      auth: founder,
    });
    const missionId = (created.body as { mission: { id: string } }).mission.id;

    // A FRESH GET (new request, no shared state) shows the durable mission.
    const read = await call(`/api/ai-workforce/missions/${missionId}`, { auth: founder });
    expect(read.status).toBe(200);
    const readBody = read.body as { mission: { id: string; state: string }; tasks: Array<{ state: string }> };
    expect(readBody.mission.id).toBe(missionId);
    expect(readBody.tasks[0]!.state).toBe("RUNNING");

    // POST continues the mission: reconcile → settle → advance. The runtime is
    // the deterministic one, so the provider has already finished.
    const advanced = await call(`/api/ai-workforce/missions/${missionId}`, { method: "POST", auth: founder });
    expect(advanced.status).toBe(200);
    const advancedBody = advanced.body as { tasks: Array<{ state: string }>; reviews: Array<{ id: string; state: string }> };
    expect(advancedBody.tasks[0]!.state).toBe("REVIEW");
    const pending = advancedBody.reviews.find((review) => review.state === "PENDING");
    expect(pending).toBeTruthy();

    // The decision queue is reachable over HTTP, and contains it.
    const queue = await call("/api/ai-workforce/decisions", { auth: founder });
    expect(queue.status).toBe(200);
    const queueBody = queue.body as { decisions: Array<{ reviewId: string }> };
    expect(queueBody.decisions.map((row) => row.reviewId)).toContain(pending!.id);

    // The human decision goes through the HTTP boundary too.
    const decided = await call("/api/ai-workforce/decisions", {
      method: "POST",
      body: { reviewId: pending!.id, decision: "APPROVED", note: "approved over HTTP" },
      auth: founder,
    });
    expect(decided.status).toBe(200);
    const decidedBody = decided.body as { mission: { state: string }; reviews: Array<{ state: string }> };
    expect(decidedBody.mission.state).toBe("COMPLETED");
    expect(decidedBody.reviews[0]!.state).toBe("APPROVED");

    // …and the rows agree: the whole chain is persisted, not held in the server.
    expect(psql(`select state from "ai_missions" where id = '${missionId}'`)).toBe("COMPLETED");
    expect(psql(`select state from "ai_tasks" where "missionId" = '${missionId}'`)).toBe("COMPLETED");
    expect(
      psql(`select status from "ai_execution_records" where "missionId" = '${missionId}'`),
    ).toBe("SUCCEEDED");
    expect(
      psql(`select state || '|' || coalesce("decidedBy",'none') from "ai_task_reviews" where "missionId" = '${missionId}'`),
    ).toBe("APPROVED|actor_founder");

    // A SECOND decision on the same review is refused, and the row is unchanged.
    const twice = await call("/api/ai-workforce/decisions", {
      method: "POST",
      body: { reviewId: pending!.id, decision: "REJECTED" },
      auth: founder,
    });
    expect([404, 409]).toContain(twice.status);
    expect(psql(`select state from "ai_task_reviews" where id = '${pending!.id}'`)).toBe("APPROVED");
  }, 90_000);

  it("never leaks a database URL, a bridge endpoint or a secret in an error body", async () => {
    const bodies: string[] = [];
    const requests: Array<Promise<Result>> = [
      call("/api/ai-workforce/missions", { auth: { label: "anon" } }),
      call("/api/ai-workforce/missions", { method: "POST", raw: "{not json", auth: founder }),
      call("/api/ai-workforce/missions/does-not-exist", { auth: founder }),
      call("/api/ai-workforce/missions/does-not-exist", { method: "POST", auth: founder }),
      call("/api/ai-workforce/decisions", { method: "POST", body: { reviewId: "nope", decision: "APPROVED" }, auth: founder }),
    ];
    for (const response of await Promise.all(requests)) bodies.push(response.text);

    const joined = bodies.join("\n");
    for (const needle of FORBIDDEN_IN_BODIES) {
      expect(joined, `error bodies must not contain "${needle}"`).not.toContain(needle);
    }
    // The refusal for an unknown mission is a real 404, not a crash.
    const missing = await call("/api/ai-workforce/missions/does-not-exist", { auth: founder });
    expect([404, 422]).toContain(missing.status);
  }, 60_000);
});
