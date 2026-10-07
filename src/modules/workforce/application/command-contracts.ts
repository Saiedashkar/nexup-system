import { createHash } from "node:crypto";

import { AiWorkforceError } from "@/modules/ai-workforce/core/errors";
import type { JsonObject } from "@/modules/ai-workforce/core/types";

import { MISSION_PRIORITIES, type MissionPriority } from "../missions/mission-contracts";
import type { MissionTaskCreateInput } from "../missions/task-contracts";

/**
 * The COMMAND — the application's front door to the mission lifecycle.
 *
 * A Command is what a human (or a supervised agent) actually issues:
 *
 *   Command → Mission → Task → Actor → Capability authorisation → Runtime
 *           → Execution → Result → Review → (human) → completed Mission
 *
 * Two things make this a real application boundary rather than a helper around
 * the orchestrator:
 *
 *   1. IDENTITY. Every command carries an `idempotencyKey` and a `scope`. A
 *      retry of the same request must land on the same Mission; a new request
 *      must create a new one. Without an identity there is no way to tell the
 *      two apart, so the key is REQUIRED — a caller that cannot name its
 *      request twice does not get to submit one.
 *   2. VALIDATION AT THE EDGE. `parseMissionCommand` is the only way a raw
 *      payload becomes a command. Nothing downstream has to guess whether a
 *      field was a string, an array or a lie, and the plan can never contain two
 *      tasks with the same title (the plan links tasks by title).
 *
 * Nothing here executes anything, imports Prisma, or knows a provider.
 */

/** A plan is bounded: a Command that needs more than this is not one command. */
export const MAX_COMMAND_TASKS = 50;
export const MAX_COMMAND_KEY_LENGTH = 200;

export type CommandTaskInput = {
  /** Human-readable name; the plan links dependencies by this title. */
  title: string;
  /** What the task must achieve. */
  objective: string;
  /** Shorthand for `input.instruction` — the bounded prompt handed to the actor. */
  instruction?: string;
  input?: JsonObject;
  /** Titles of tasks in the same plan that must COMPLETE first. */
  dependsOn?: readonly string[];
  /** Optional routing override; the application composition routes by default. */
  assignedActorId?: string;
  requiredCapabilityId?: string;
  requiredCapabilityVersion?: string;
  maxAttempts?: number;
};

export type MissionCommand = {
  /** The caller's retry token. Opaque, required, and never model output. */
  idempotencyKey: string;
  /** Which namespace the key belongs to (e.g. a business or workspace ref). */
  scope: string;
  title: string;
  goal: string;
  /** The human or actor submitting this command. */
  requestedBy: string;
  /** Who is accountable for the mission; defaults to the requester. */
  owner?: string | null;
  priority?: MissionPriority;
  businessId?: string;
  workspaceRef?: string;
  projectRef?: string;
  clientRef?: string;
  tasks: readonly CommandTaskInput[];
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function required(value: unknown, message: string, details?: JsonObject): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AiWorkforceError("INVALID_INPUT", message, details);
  }
  return value.trim();
}

function optionalText(value: unknown, message: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return required(value, message);
}

function positiveInteger(value: unknown, message: string, details?: JsonObject): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AiWorkforceError("INVALID_INPUT", message, details);
  }
  return value;
}

function parseTask(raw: unknown, index: number): CommandTaskInput {
  if (!isPlainObject(raw)) {
    throw new AiWorkforceError("INVALID_INPUT", `Task ${index + 1} must be an object`, { index });
  }
  if (raw.input !== undefined && !isPlainObject(raw.input)) {
    throw new AiWorkforceError("INVALID_INPUT", `Task ${index + 1}: input must be an object`, { index });
  }
  const dependsOn =
    raw.dependsOn === undefined
      ? undefined
      : Array.isArray(raw.dependsOn) && raw.dependsOn.every((entry) => typeof entry === "string")
        ? (raw.dependsOn as string[])
        : (() => {
            throw new AiWorkforceError("INVALID_INPUT", `Task ${index + 1}: dependsOn must be an array of titles`, { index });
          })();

  const task: CommandTaskInput = {
    title: required(raw.title, `Task ${index + 1} requires a title`, { index }),
    objective: required(raw.objective, `Task ${index + 1} requires an objective`, { index }),
  };

  const instruction = optionalText(raw.instruction, `Task ${index + 1}: instruction must be a string`);
  if (instruction !== undefined) task.instruction = instruction;
  if (raw.input !== undefined) task.input = raw.input as JsonObject;
  if (dependsOn !== undefined) task.dependsOn = dependsOn;

  const assignedActorId = optionalText(raw.assignedActorId, `Task ${index + 1}: assignedActorId must be a string`);
  if (assignedActorId !== undefined) task.assignedActorId = assignedActorId;

  const capabilityId = optionalText(raw.requiredCapabilityId, `Task ${index + 1}: requiredCapabilityId must be a string`);
  if (capabilityId !== undefined) task.requiredCapabilityId = capabilityId;

  const capabilityVersion = optionalText(
    raw.requiredCapabilityVersion,
    `Task ${index + 1}: requiredCapabilityVersion must be a string`,
  );
  if (capabilityVersion !== undefined) task.requiredCapabilityVersion = capabilityVersion;

  if (raw.maxAttempts !== undefined) {
    task.maxAttempts = positiveInteger(raw.maxAttempts, `Task ${index + 1}: maxAttempts must be a positive integer`, { index });
  }
  return task;
}

/**
 * The ONLY way a raw payload becomes a command.
 *
 * @throws INVALID_INPUT for anything malformed. A refusal happens here, before
 *         the idempotency ledger is touched, so a bad request cannot burn a key.
 */
export function parseMissionCommand(raw: unknown): MissionCommand {
  if (!isPlainObject(raw)) {
    throw new AiWorkforceError("INVALID_INPUT", "A command must be a JSON object");
  }

  const idempotencyKey = required(raw.idempotencyKey, "A command requires an idempotencyKey");
  if (idempotencyKey.length > MAX_COMMAND_KEY_LENGTH) {
    throw new AiWorkforceError("INVALID_INPUT", `idempotencyKey must be at most ${MAX_COMMAND_KEY_LENGTH} characters`, {
      length: idempotencyKey.length,
    });
  }

  const scope = required(raw.scope, "A command requires a scope");
  if (scope.length > MAX_COMMAND_KEY_LENGTH) {
    throw new AiWorkforceError("INVALID_INPUT", `scope must be at most ${MAX_COMMAND_KEY_LENGTH} characters`, {
      length: scope.length,
    });
  }

  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    throw new AiWorkforceError("INVALID_INPUT", "A command requires at least one task");
  }
  if (raw.tasks.length > MAX_COMMAND_TASKS) {
    throw new AiWorkforceError("INVALID_INPUT", `A command may carry at most ${MAX_COMMAND_TASKS} tasks`, {
      tasks: raw.tasks.length,
    });
  }

  const tasks = raw.tasks.map((task, index) => parseTask(task, index));

  // The plan links tasks by TITLE, so a duplicate title would silently collapse
  // two tasks into one. Refuse it here rather than losing work quietly.
  const titles = new Set<string>();
  for (const task of tasks) {
    if (titles.has(task.title)) {
      throw new AiWorkforceError("INVALID_INPUT", `Duplicate task title "${task.title}"`, { title: task.title });
    }
    titles.add(task.title);
  }
  // ...and a dependency that names a task the plan does not contain can never be
  // satisfied, so it would park the mission forever.
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!titles.has(dependency)) {
        throw new AiWorkforceError(
          "INVALID_INPUT",
          `Task "${task.title}" depends on "${dependency}", which is not in this plan`,
          { title: task.title, dependency },
        );
      }
    }
  }

  const command: MissionCommand = {
    idempotencyKey,
    scope,
    title: required(raw.title, "A command requires a title"),
    goal: required(raw.goal, "A command requires a goal"),
    requestedBy: required(raw.requestedBy, "A command requires requestedBy"),
    tasks,
  };

  const owner = optionalText(raw.owner, "owner must be a string or null");
  if (owner !== undefined) command.owner = owner;

  if (raw.priority !== undefined) {
    if (!MISSION_PRIORITIES.includes(raw.priority as MissionPriority)) {
      throw new AiWorkforceError("INVALID_INPUT", `priority must be one of ${MISSION_PRIORITIES.join(", ")}`, {
        priority: raw.priority as string,
      });
    }
    command.priority = raw.priority as MissionPriority;
  }

  for (const field of ["businessId", "workspaceRef", "projectRef", "clientRef"] as const) {
    const value = optionalText(raw[field], `${field} must be a string`);
    if (value !== undefined) command[field] = value;
  }

  return command;
}

/** Deterministic JSON: object keys sorted, so two equal payloads hash equally. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/**
 * The command's payload fingerprint.
 *
 * The key itself is deliberately NOT part of the fingerprint: the whole point is
 * that a caller may reuse the key for the SAME work, and must be refused when it
 * reuses it for different work.
 */
export function commandFingerprint(command: MissionCommand): string {
  const canonical = {
    title: command.title,
    goal: command.goal,
    requestedBy: command.requestedBy,
    owner: command.owner ?? null,
    priority: command.priority ?? "NORMAL",
    businessId: command.businessId ?? null,
    workspaceRef: command.workspaceRef ?? null,
    projectRef: command.projectRef ?? null,
    clientRef: command.clientRef ?? null,
    tasks: command.tasks.map((task) => ({
      title: task.title,
      objective: task.objective,
      instruction: task.instruction ?? null,
      input: task.input ?? {},
      dependsOn: [...(task.dependsOn ?? [])],
      assignedActorId: task.assignedActorId ?? null,
      requiredCapabilityId: task.requiredCapabilityId ?? null,
      requiredCapabilityVersion: task.requiredCapabilityVersion ?? null,
      maxAttempts: task.maxAttempts ?? null,
    })),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

/**
 * Where an unrouted command task goes.
 *
 * The application composition supplies this from `bootstrapStrategyAnalyst`, so
 * a Command that names no actor still reaches a REAL registered actor, its
 * capability assignment and its runtime binding — and is still refused by the
 * dispatcher if that assignment is missing.
 */
export type CommandTaskRouter = (task: CommandTaskInput) => {
  assignedActorId: string | null;
  requiredCapabilityId: string | null;
  requiredCapabilityVersion?: string;
};

/** Turns the command's plan into the orchestrator's task registrations. */
export function toMissionTaskInputs(
  command: MissionCommand,
  route: CommandTaskRouter,
): MissionTaskCreateInput[] {
  return command.tasks.map((task) => {
    const routed = route(task);
    const input: MissionTaskCreateInput = {
      title: task.title,
      objective: task.objective,
      input: { ...(task.input ?? {}), ...(task.instruction ? { instruction: task.instruction } : {}) },
    };
    if (routed.assignedActorId) input.assignedActorId = routed.assignedActorId;
    if (routed.requiredCapabilityId) input.requiredCapabilityId = routed.requiredCapabilityId;
    if (routed.requiredCapabilityVersion) input.requiredCapabilityVersion = routed.requiredCapabilityVersion;
    if (task.dependsOn) input.dependsOn = [...task.dependsOn];
    if (task.maxAttempts !== undefined) input.maxAttempts = task.maxAttempts;
    return input;
  });
}
