import fs from "node:fs";

import { createSequentialIdFactory, sequentialClock } from "@/modules/ai-workforce/core/ids";
import { createWorkforcePrismaClient, type WorkforcePrismaHandle } from "@/modules/ai-workforce/persistence/prisma-client";
import { createHermesRuntime, type HermesRuntimeConfig } from "@/modules/workforce";
import { createWorkforceApplication, type WorkforceApplication } from "@/modules/workforce/application";
import { DeterministicHermesTransport } from "@/modules/workforce/runtimes/hermes/testing/deterministic-transport";

/**
 * Shared plumbing for the restart-proof CHILD PROCESSES.
 *
 * These files are not ordinary tests: each one is a whole process that boots the
 * real application composition, does exactly one thing, and exits. Only two
 * things are shared between them, and both are deliberate:
 *
 *   - the DATABASE (that is the point of the proof);
 *   - a deterministic transport (so the proof spends no provider turn).
 */

export const FOUNDER = "actor_founder";
export const RESTART_KEY = "restart-proof-1";

export function databaseUrl(): string {
  const url = process.env.APP_PROOF_DATABASE_URL;
  if (!url) throw new Error("APP_PROOF_DATABASE_URL must be set");
  return url;
}

export function missionIdFromEnv(): string {
  const id = process.env.APP_PROOF_MISSION_ID;
  if (!id) throw new Error("APP_PROOF_MISSION_ID must be set");
  return id;
}

export function writeReceipt(receipt: Record<string, unknown>): void {
  const file = process.env.APP_PROOF_RECEIPT;
  if (!file) throw new Error("APP_PROOF_RECEIPT must be set");
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
}

export function readReceipt(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function hermesConfig(): HermesRuntimeConfig {
  return {
    runtimeId: "runtime_hermes_saeed",
    displayName: "Hermes Agent Runtime",
    transport: "BRIDGE",
    profile: "saieed",
    bridgeEndpoint: "https://bridge.invalid",
    bridgeKeyId: "nexup-vercel",
    bridgeSecretPresent: true,
    timeoutMs: 5_000,
    maxOutputBytes: 8_192,
    capabilities: { submit: true, status: true, health: true, cancel: true, resume: false },
    authTokenPresent: false,
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  };
}

/** The Command both processes agree on. Same key, same body, same fingerprint. */
export function restartCommand(key: string = RESTART_KEY) {
  return {
    idempotencyKey: key,
    scope: "proof:restart",
    title: "Restart proof mission",
    goal: "prove the application lifecycle survives a process restart",
    requestedBy: FOUNDER,
    owner: FOUNDER,
    tasks: [
      {
        title: "restart-proof-task",
        objective: "produce a brief",
        instruction: "Return exactly: NEXUP_RESTART_PROOF_OK",
      },
    ],
  };
}

export type BootedProcess = {
  application: WorkforceApplication;
  handle: WorkforcePrismaHandle;
  /** The transport this process bound, so a proof can COUNT what it did. */
  transport: DeterministicHermesTransport;
  disconnect: () => Promise<void>;
};

/**
 * Boots the application composition for a child process.
 *
 * `statusSequence` is how a FRESH transport answers a status readback for a
 * handle it never started — which is exactly the situation a restarted process
 * is in: the handle came from the database, the run belongs to an earlier
 * process, and the runtime port must be told what the provider says. With
 * `["succeeded"]` the provider reports the run finished on the first read.
 */
export type BootOptions = {
  statusSequence?: readonly string[];
  /**
   * How long the deterministic provider keeps its run alive before completing.
   * A non-zero value is what makes an execution genuinely IN FLIGHT: with the
   * default 0 the run completes inside `startRun`, so the work is already over
   * before the process can die.
   */
  holdCompletionMs?: number;
  /**
   * Runs the REMOTE side still knows about although this process never started
   * them — a bridge that kept working while the NEXUP process was down. This is
   * how a re-adoption proof says what the provider reports.
   */
  knownRuns?: ConstructorParameters<typeof DeterministicHermesTransport>[0]["knownRuns"];
  /**
   * Ids the remote does NOT know. The transport answers 404, exactly like the
   * bridge for a run it cannot find, so "unverifiable" is exercised for real
   * rather than as the fallback of a canned sequence.
   */
  unknownRunIds?: readonly string[];
};

export async function bootProcess(prefix: string, options: BootOptions = {}): Promise<BootedProcess> {
  const handle = createWorkforcePrismaClient(databaseUrl());
  // The prefix carries the PID: two runs of the same STATION must not mint the
  // same ids, or the failure would be a primary-key collision rather than the
  // restart behaviour under test. (Production uses random ids; this is only the
  // sequential test factory.)
  const ids = createSequentialIdFactory(`${prefix}-${process.pid}`);
  const now = sequentialClock("2026-08-03T00:00:00.000Z", 1000);
  const transport = new DeterministicHermesTransport({
    ...(options.statusSequence ? { statusSequence: options.statusSequence } : {}),
    ...(options.holdCompletionMs ? { holdCompletionMs: options.holdCompletionMs } : {}),
    ...(options.knownRuns ? { knownRuns: options.knownRuns } : {}),
    ...(options.unknownRunIds ? { unknownRunIds: options.unknownRunIds } : {}),
  });
  const runtime = createHermesRuntime(hermesConfig(), { transport, ids, now, allowTestTransport: true });

  const application = await createWorkforceApplication(handle, { ids, now, runtime });

  return {
    application,
    handle,
    transport,
    disconnect: () => handle.disconnect(),
  };
}
