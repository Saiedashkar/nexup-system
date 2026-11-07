import { execFileSync } from "node:child_process";

import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

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
// The canonical Business ids the proof seeded, and the second HUMAN actor it
// registered — supplied by scripts/run-api-http-proof.sh.
const NEXUP_BUSINESS_ID = process.env.WORKFORCE_PROOF_NEXUP_BUSINESS_ID;
const REBOUND_BUSINESS_ID = process.env.WORKFORCE_PROOF_REBOUND_BUSINESS_ID;
const PROOF_HUMAN_ACTOR_ID = process.env.WORKFORCE_PROOF_HUMAN_ACTOR_ID;

const describeIfServer = BASE_URL && AUTH_SECRET ? describe : describe.skip;
/** The cross-business proof additionally needs the seeded registry + actor. */
const describeIfBusiness =
  BASE_URL && AUTH_SECRET && NEXUP_BUSINESS_ID && REBOUND_BUSINESS_ID && PROOF_HUMAN_ACTOR_ID
    ? describe
    : describe.skip;

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

/**
 * A command whose ONE task names a READ-ONLY DETERMINISTIC capability.
 *
 * WHY THIS IS THE DEFAULT FOR ANYTHING THAT MUST ACTUALLY RUN (Step 5A-4
 * correction, P1-7). The shipped budget governor DENIES every
 * `VARIABLE_PROVIDER_COST` leg, and the default routing targets the Strategy
 * Analyst's RUNTIME-bound skill — so an unrouted command is now refused by
 * budget, by design. The runnable path is the deterministic read-only leg, and
 * `capital.summary` is the cleanest of the three: `businessScoped:false` and no
 * input schema, so the case is about the boundary rather than about seeding
 * client or project rows.
 */
function deterministicBody(key: string, overrides: Record<string, unknown> = {}) {
  return commandBody(key, {
    tasks: [
      {
        title: `${key}-task`,
        objective: "read the office capital summary",
        instruction: "Return the capital summary",
        requiredCapabilityId: "capital.summary",
        requiredCapabilityVersion: "1.0.0",
      },
    ],
    ...overrides,
  });
}

/** How many Phase-1 job-engine rows exist. A mission attempt may create none. */
function jobEngineCounts(): { jobs: string; runs: string; runEvents: string } {
  return {
    jobs: psql(`select count(*) from "ai_jobs"`),
    runs: psql(`select count(*) from "ai_runs"`),
    runEvents: psql(`select count(*) from "ai_run_events"`),
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

  /**
   * CASE A — the default runtime leg is REFUSED BY BUDGET, and no provider
   * execution is ever attempted (Step 5A-4 correction, P1-7/P1-8).
   *
   * This is the product invariant expressed at the HTTP boundary: an unrouted
   * command routes to the Strategy Analyst's `SKILL`, which requires a runtime
   * and is therefore `VARIABLE_PROVIDER_COST`; the shipped budget governor
   * refuses that outright. The assertion is not merely "it says no" — it is that
   * the refusal happens with ZERO provider execution: the task never starts, no
   * execution record exists, and the Phase-1 job engine gains no row.
   */
  it("CASE A — refuses an unrouted runtime attempt by BUDGET, with zero provider execution", async () => {
    founder.cookie = await mintSession();
    const before = jobEngineCounts();

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
      changes: string[];
    };
    expect(body.status).toBe("ISSUED");
    expect(body.replayed).toBe(false);
    expect(body.routing.enabled).toBe(true);
    // The command is durable and routed — but the attempt is BLOCKED, not started.
    expect(body.tasks[0]!.assignedActorId).toBe(body.routing.actorId);
    expect(body.tasks[0]!.state).not.toBe("RUNNING");
    expect(body.tasks[0]!.state).not.toBe("COMPLETED");
    // The refusal is READABLE from the same result that reported no progress.
    expect(body.changes.join("\n")).toMatch(/BUDGET_POLICY_DENIED/);

    // The row exists in the DATABASE, not just in the response.
    const missionId = body.mission.id;
    expect(psql(`select count(*) from "ai_missions" where id = '${missionId}'`)).toBe("1");
    expect(psql(`select state from "ai_tasks" where "missionId" = '${missionId}'`)).not.toBe("RUNNING");

    // ZERO provider execution: no execution record, and no Phase-1 job-engine row.
    expect(psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`)).toBe("0");
    // The refusal is DURABLY ACCOUNTED FOR (Step 5A-4 correction, P1-3): a policy
    // refusal is recorded on the claim and RELEASED, so dispatch was never
    // entered — `DISPATCHING`/`DISPATCHED` would mean the provider may know about
    // the attempt, and NEITHER may appear here. (An identity refusal short-circuits
    // before the claim, so it would leave NO row; a budget refusal is a policy
    // refusal, decided after the claim, and therefore leaves exactly one RELEASED
    // row — never a dispatched one.)
    expect(
      psql(
        `select coalesce(string_agg(state, ',' order by attempt), 'NONE') from "ai_execution_claims" where "missionId" = '${missionId}'`,
      ),
    ).toBe("RELEASED");
    const after = jobEngineCounts();
    expect(after).toEqual(before);

    const key = await call("/api/ai-workforce/missions?limit=50", { auth: founder });
    expect(key.status).toBe(200);
  }, 60_000);

  /**
   * CASE B — the deterministic READ-ONLY leg executes for real: the output is
   * persisted and the task settles, with no `AiJob`/`AiRun` row anywhere.
   *
   * `capital.summary` is `NO_VARIABLE_COST`, so the default DENY governor permits
   * it. Execution goes through the Capability Execution Service's own governed
   * deterministic invoker — NOT the Phase-1 LocalRuntimeAdapter — which is why the
   * mission's audit spine is the execution record alone.
   */
  it("CASE B — executes a read-only deterministic capability, persists its output, and creates no AiJob/AiRun", async () => {
    founder.cookie = await mintSession();
    const before = jobEngineCounts();

    const created = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: deterministicBody("http-det"),
      auth: founder,
    });
    expect(created.status).toBe(201);
    const body = created.body as {
      mission: { id: string; state: string };
      tasks: Array<{ state: string; requiredCapabilityId: string | null; executionRecordId: string | null }>;
      changes: string[];
    };
    const missionId = body.mission.id;
    expect(body.tasks[0]!.state).toBe("RUNNING");
    expect(body.tasks[0]!.requiredCapabilityId).toBe("capital.summary");
    expect(body.changes.join("\n")).toMatch(/RUNNING/);
    expect(body.changes.join("\n")).not.toMatch(/BUDGET_POLICY_DENIED/);

    // The attempt is DURABLE and its output is on the record — not on a provider.
    const record = psql(
      `select status || '|' || coalesce(output::text,'null') from "ai_execution_records" where "missionId" = '${missionId}'`,
    );
    const [status, outputJson] = record.split("|", 2);
    expect(status).toBe("SUCCEEDED");
    expect(outputJson).not.toBe("null");
    expect(JSON.parse(outputJson!)).toMatchObject({ currency: "EGP" });

    // Continue the mission over HTTP: observe → settle → REVIEW.
    const advanced = await call(`/api/ai-workforce/missions/${missionId}`, { method: "POST", auth: founder });
    expect(advanced.status).toBe(200);
    const advancedBody = advanced.body as {
      tasks: Array<{ state: string }>;
      reviews: Array<{ id: string; state: string }>;
    };
    expect(advancedBody.tasks[0]!.state).toBe("REVIEW");
    expect(advancedBody.reviews.some((review) => review.state === "PENDING")).toBe(true);
    expect(psql(`select status from "ai_execution_records" where "missionId" = '${missionId}'`)).toBe("SUCCEEDED");

    // THE ROW-LEVEL PROOF OF P1-7: no second lifecycle was introduced.
    const after = jobEngineCounts();
    expect(after).toEqual(before);
  }, 60_000);

  it("returns the SAME mission for an idempotent retry, and creates no second execution", async () => {
    const first = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: deterministicBody("http-retry"),
      auth: founder,
    });
    expect(first.status).toBe(201);
    const missionId = (first.body as { mission: { id: string } }).mission.id;
    const executions = psql(`select count(*) from "ai_execution_records" where "missionId" = '${missionId}'`);

    const retry = await call("/api/ai-workforce/missions", {
      method: "POST",
      body: deterministicBody("http-retry"),
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
      body: deterministicBody("http-lifecycle"),
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

  /* ═══════════════════════════════════════════════════════
     CROSS-BUSINESS — genuine business-scoped sessions
     ═══════════════════════════════════════════════════════ */

  describeIfBusiness("STEP 5 — business scope over real signed sessions", () => {
    /**
     * A NON-super-admin session whose only business reach is the one named.
     *
     * It still carries `canAccessOfficeFinanceFull`, because the route-prefix
     * middleware deliberately limits `/api/ai-workforce` to office-finance or
     * super-admin sessions — that is the legacy posture, and it is NOT the same
     * axis as business scope: the session reaches the module, but only for the
     * business(es) its flags grant.
     */
    const scoped = (sub: string, flags: { nexup?: boolean; rebound?: boolean }) =>
      mintSession({
        sub,
        name: `Scoped ${sub}`,
        role: "ADMIN",
        businessId: "scoped",
        canAccessNexup: flags.nexup === true,
        canAccessRebound: flags.rebound === true,
        canAccessAbomazen: false,
        canAccessOfficeFinanceFull: true,
      });

    let cookieA = "";
    let cookieB = "";
    let missionA = "";
    let missionB = "";
    let reviewB = "";

    const cross = { auth: () => ({ cookie: cookieA, label: "business-a" }) };

    beforeAll(async () => {
      // A reaches nexup only; B reaches rebound only. Their USER ids differ and B
      // resolves to a NAMED human actor that is not the Founder.
      cookieA = await scoped("proof-user-1", { nexup: true });
      cookieB = await scoped("proof-user-2", { rebound: true });

      const a = await call("/api/ai-workforce/missions", {
        method: "POST",
        body: deterministicBody("xbiz-a", { businessId: "nexup" }),
        auth: { cookie: cookieA, label: "business-a" },
      });
      if (a.status !== 201) throw new Error(`mission A was not created (${a.status}): ${a.text}`);
      missionA = (a.body as { mission: { id: string } }).mission.id;

      const b = await call("/api/ai-workforce/missions", {
        method: "POST",
        body: deterministicBody("xbiz-b", { businessId: "rebound" }),
        auth: { cookie: cookieB, label: "business-b" },
      });
      if (b.status !== 201) throw new Error(`mission B was not created (${b.status}): ${b.text}`);
      missionB = (b.body as { mission: { id: string } }).mission.id;

      // Continue mission B to a pending human decision the B session may take.
      const advanced = await call(`/api/ai-workforce/missions/${missionB}`, {
        method: "POST",
        auth: { cookie: cookieB, label: "business-b" },
      });
      expect(advanced.status).toBe(200);
      reviewB = (advanced.body as { reviews: Array<{ id: string; state: string }> }).reviews.find(
        (row) => row.state === "PENDING",
      )!.id;
    }, 90_000);

    it("persists the CANONICAL Business.id and keeps the user/actor vocabularies apart", () => {
      // The request named the SLUG; the row must hold the registry ID.
      expect(psql(`select "businessId" from "ai_missions" where id = '${missionA}'`)).toBe(NEXUP_BUSINESS_ID);
      expect(psql(`select "businessId" from "ai_missions" where id = '${missionA}'`)).not.toBe("nexup");
      // The mission's identity fields are the resolved ACTOR id…
      expect(psql(`select "createdBy" from "ai_missions" where id = '${missionA}'`)).toBe("actor_founder");
      expect(psql(`select "owner" from "ai_missions" where id = '${missionA}'`)).toBe("actor_founder");
      // …while the USER id lives only on the command intent ledger.
      expect(
        psql(`select "requestedBy" from "ai_command_intents" where "missionId" = '${missionA}'`),
      ).toBe("proof-user-1");
    });

    it("reads its own business's mission", async () => {
      const read = await call(`/api/ai-workforce/missions/${missionA}`, { auth: { cookie: cookieA, label: "a" } });
      expect(read.status).toBe(200);
      expect((read.body as { mission: { id: string; businessId?: string } }).mission.id).toBe(missionA);
      expect((read.body as { mission: { businessId?: string } }).mission.businessId).toBe(NEXUP_BUSINESS_ID);
    });

    it("hides a cross-business mission behind the SAME 404-alike as a missing one", async () => {
      const denied = await call(`/api/ai-workforce/missions/${missionB}`, { auth: cross.auth() });
      const absent = await call("/api/ai-workforce/missions/mission_absent_from_this_proof", {
        auth: cross.auth(),
      });

      expect(denied.status).toBe(404);
      expect(absent.status).toBe(404);
      // Indistinguishable: the same error code for "not yours" and "not there".
      expect((denied.body as { error: string }).error).toBe("MISSION_NOT_FOUND");
      expect((denied.body as { error: string }).error).toBe((absent.body as { error: string }).error);
    });

    it("refuses to advance/drain another business's mission (404-alike)", async () => {
      const denied = await call(`/api/ai-workforce/missions/${missionB}`, {
        method: "POST",
        auth: cross.auth(),
      });
      expect(denied.status).toBe(404);
      expect((denied.body as { error: string }).error).toBe("MISSION_NOT_FOUND");
      // B's mission is untouched by A's refused attempt: the setup advanced it
      // to WAITING (its task parked in REVIEW) and the refusal changed nothing.
      expect(psql(`select state from "ai_missions" where id = '${missionB}'`)).toBe("WAITING");
    });

    it("hides a cross-business review behind the same 404-alike as a missing one", async () => {
      const denied = await call("/api/ai-workforce/decisions", {
        method: "POST",
        body: { reviewId: reviewB, decision: "APPROVED" },
        auth: cross.auth(),
      });
      const absent = await call("/api/ai-workforce/decisions", {
        method: "POST",
        body: { reviewId: "review_absent_from_this_proof", decision: "APPROVED" },
        auth: cross.auth(),
      });
      expect(denied.status).toBe(404);
      expect(absent.status).toBe(404);
      expect((denied.body as { error: string }).error).toBe("APPROVAL_NOT_FOUND");
      expect((denied.body as { error: string }).error).toBe((absent.body as { error: string }).error);
      // The review is still PENDING — the refused attempt decided nothing.
      expect(psql(`select state from "ai_task_reviews" where id = '${reviewB}'`)).toBe("PENDING");
    });

    it("records a same-business decision as the RESOLVED human actor, not actor_founder", async () => {
      const decided = await call("/api/ai-workforce/decisions", {
        method: "POST",
        body: { reviewId: reviewB, decision: "APPROVED", note: "decided inside the business" },
        auth: { cookie: cookieB, label: "business-b" },
      });
      expect(decided.status).toBe(200);

      const actor = psql(`select coalesce("decidedBy",'none') from "ai_task_reviews" where id = '${reviewB}'`);
      expect(actor).toBe(PROOF_HUMAN_ACTOR_ID);
      // The defect being designed away: this is NOT the old constant.
      expect(actor).not.toBe("actor_founder");
    });

    it("refuses payload actor/owner/business widening", async () => {
      // A names a business it does not reach → refused (404-alike).
      const widenBusiness = await call("/api/ai-workforce/missions", {
        method: "POST",
        body: commandBody("xbiz-widen-biz", { businessId: "rebound" }),
        auth: cross.auth(),
      });
      expect(widenBusiness.status).toBe(404);
      expect((widenBusiness.body as { error: string }).error).toBe("BUSINESS_SCOPE_DENIED");

      // B names a different owner → refused (403); identity is server-derived.
      const widenOwner = await call("/api/ai-workforce/missions", {
        method: "POST",
        body: commandBody("xbiz-widen-owner", { businessId: "rebound", owner: "actor_founder" }),
        auth: { cookie: cookieB, label: "business-b" },
      });
      expect(widenOwner.status).toBe(403);
      expect((widenOwner.body as { error: string }).error).toBe("PERMISSION_DENIED");

      // A payload userId/actorId is IGNORED; the row keeps the session's actor.
      const ignored = await call("/api/ai-workforce/missions", {
        method: "POST",
        body: commandBody("xbiz-ignored-identity", {
          businessId: "nexup",
          userId: "someone_else",
          actorId: "actor_root",
        }),
        auth: cross.auth(),
      });
      expect(ignored.status).toBe(201);
      const id = (ignored.body as { mission: { id: string } }).mission.id;
      expect(psql(`select "createdBy" from "ai_missions" where id = '${id}'`)).toBe("actor_founder");
      expect(psql(`select "owner" from "ai_missions" where id = '${id}'`)).toBe("actor_founder");
    });
  });

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
