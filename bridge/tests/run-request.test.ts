import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/api/errors";
import {
  CORRELATION_FIELDS,
  MAX_CORRELATION_FIELD_LENGTH,
  SUBMIT_FIELDS,
  parseRunSubmission,
} from "../src/api/run-request";
import { wireBodyFromAppClient } from "./helpers";

/**
 * Strict schema for `POST /v1/runs`.
 *
 * The bridge defines a fixed set of named fields. Anything else is a caller
 * mistake or an attempt to reach a capability the bridge deliberately does not
 * expose (there is no generic method/RPC field), so it is REFUSED rather than
 * ignored — an ignored field is indistinguishable from a working one at the
 * call site, which is how a run could be believed to have used a method it
 * never used.
 */

const MAX_TIMEOUT_MS = 120_000;
const LIMITS = { maxTimeoutMs: MAX_TIMEOUT_MS };
const correlation = { actorId: "actor_1", traceId: "trace_1" };

/** Runs the parser and returns the BridgeError it refused with. */
function refusal(body: unknown): BridgeError {
  try {
    parseRunSubmission(body, LIMITS);
  } catch (error) {
    if (error instanceof BridgeError) return error;
    throw error;
  }
  throw new Error("expected parseRunSubmission to refuse this body");
}

describe("run submission — accepted shapes", () => {
  it("accepts the minimal payload the app-side client sends", async () => {
    const body = await wireBodyFromAppClient({ instruction: "summarize", correlation });
    const submission = parseRunSubmission(body, LIMITS);
    expect(submission.instruction).toBe("summarize");
    expect(submission.correlation).toEqual({ actorId: "actor_1", traceId: "trace_1" });
    expect(submission.contextJson).toBeUndefined();
    expect(submission.timeoutMs).toBeUndefined();
  });

  it("accepts the full payload the app-side client can send", async () => {
    const body = await wireBodyFromAppClient({
      instruction: "summarize",
      contextJson: '{"clients":1}',
      correlation: { ...correlation, jobId: "job_1", missionId: "mis_1" },
      timeoutMs: 5_000,
    });
    const submission = parseRunSubmission(body, LIMITS);
    expect(submission).toMatchObject({
      instruction: "summarize",
      contextJson: '{"clients":1}',
      correlation: { actorId: "actor_1", traceId: "trace_1", jobId: "job_1", missionId: "mis_1" },
      timeoutMs: 5_000,
    });
  });

  it("defines exactly the fields the app client puts on the wire, so a payload change fails loudly", async () => {
    const body = await wireBodyFromAppClient({
      instruction: "summarize",
      contextJson: "{}",
      correlation: { ...correlation, jobId: "job_1", missionId: "mis_1" },
      timeoutMs: 5_000,
    });
    expect(Object.keys(body).sort()).toEqual([...SUBMIT_FIELDS].sort());
    expect(Object.keys(body.correlation as Record<string, unknown>).sort()).toEqual([...CORRELATION_FIELDS].sort());
  });
});

describe("run submission — refusal", () => {
  it("refuses an undefined top-level field rather than ignoring it", () => {
    const error = refusal({ instruction: "hi", correlation, method: "llm.oneshot" });
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.httpStatus).toBe(400);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("method");
  });

  it("refuses every undefined top-level field", () => {
    for (const field of ["method", "prompt", "maxTokens", "tools", "sessionId", "scope", "profileName"]) {
      const error = refusal({ instruction: "hi", correlation, [field]: "x" });
      expect(error.code, `field "${field}" was not refused`).toBe("BAD_REQUEST");
      expect(error.message, `field "${field}" was not named`).toContain(field);
    }
  });

  it("refuses an undefined field nested inside the correlation", () => {
    const error = refusal({ instruction: "hi", correlation: { ...correlation, scope: "everything" } });
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("scope");
  });

  it("keeps a caller-supplied profile a 403, not an unknown-field rejection", () => {
    const error = refusal({ instruction: "hi", correlation, profile: "default" });
    expect(error.code).toBe("FORBIDDEN_PROFILE");
    expect(error.httpStatus).toBe(403);
  });

  it("refuses a correlation that is not an object", () => {
    for (const value of ["actor_1", 7, true, [correlation], null]) {
      const error = refusal({ instruction: "hi", correlation: value });
      expect(error.code, `correlation ${JSON.stringify(value)} was not refused`).toBe("BAD_REQUEST");
    }
  });
});

describe("run submission — named fields keep their existing semantics", () => {
  it("requires a non-blank instruction", () => {
    for (const value of [undefined, "", "   ", 42, null]) {
      expect(refusal({ correlation, instruction: value }).code).toBe("BAD_REQUEST");
    }
  });

  it("requires a correlation actorId and traceId", () => {
    expect(refusal({ instruction: "hi", correlation: { traceId: "t" } }).code).toBe("BAD_REQUEST");
    expect(refusal({ instruction: "hi", correlation: { actorId: "a" } }).code).toBe("BAD_REQUEST");
  });

  it("caps the correlation fields and the timeout", () => {
    const submission = parseRunSubmission(
      {
        instruction: "hi",
        correlation: { actorId: "a".repeat(500), traceId: "t".repeat(500), jobId: "j".repeat(500) },
        timeoutMs: MAX_TIMEOUT_MS * 10,
      },
      LIMITS,
    );
    expect(submission.correlation.actorId).toHaveLength(MAX_CORRELATION_FIELD_LENGTH);
    expect(submission.correlation.traceId).toHaveLength(MAX_CORRELATION_FIELD_LENGTH);
    expect(submission.correlation.jobId).toHaveLength(MAX_CORRELATION_FIELD_LENGTH);
    expect(submission.timeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  it("drops a malformed optional field rather than refusing the run", () => {
    const submission = parseRunSubmission(
      { instruction: "hi", correlation, contextJson: "   ", timeoutMs: "soon" },
      LIMITS,
    );
    expect(submission.contextJson).toBeUndefined();
    expect(submission.timeoutMs).toBeUndefined();
  });

  it("refuses a body that is not a JSON object", () => {
    for (const value of [null, "hi", 7, [1, 2]]) {
      const error = refusal(value);
      expect(error.code, `body ${JSON.stringify(value)} was not refused`).toBe("BAD_REQUEST");
      // The shape guard must answer, not a downstream "instruction is required".
      expect(error.message).toContain("JSON object");
    }
  });
});
